#!/usr/bin/env python3
"""Validate this kit's private backup before any privileged archive extraction.

No source credentials are printed. Without --check-target this is read-only
archive validation, useful for labeled synthetic tests on a development PC.
"""
import argparse
import json
import os
import platform
import re
import shutil
import subprocess
import tarfile
from pathlib import Path, PurePosixPath

METADATA = {
    "nodes.yaml", "nodes.json", "deployments-before.json", "flux-summary.txt",
    "application-objects.yaml", "persistent-volumes.json", "k3s-version.txt",
    "os-release.txt", "storage-paths.txt",
}
STATE_ROOTS = [
    "var/lib/rancher/k3s/server/db", "var/lib/rancher/k3s/server/token",
    "var/lib/rancher/k3s/server/tls", "var/lib/rancher/k3s/server/cred",
    "etc/rancher/k3s", "etc/rancher/node",
]
TRAEFIK = "var/lib/rancher/k3s/server/manifests/traefik-config.yaml"


def fail(message):
    raise ValueError(message)


def safe_name(name):
    value = name.rstrip("/")
    if not value or not re.fullmatch(r"[A-Za-z0-9._/-]+", value):
        fail("Archive member has an unsafe name")
    if value.startswith("/") or str(PurePosixPath(value)) != value:
        fail("Archive paths must be canonical and relative")
    if any(part in (".", "..", ".stage-lock") for part in value.split("/")):
        fail("Archive has a traversal component or staging lock")
    return value


def under(name, root):
    return name == root or name.startswith(root + "/")


def os_fields(text):
    fields = {}
    for line in text.splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            key, value = line.split("=", 1)
            fields[key] = value.strip().strip('"').strip("'")
    return fields


def read_metadata(archive, members, name):
    member = members.get(name)
    if member is None or not member.isfile() or member.size > 4 * 1024 ** 2:
        fail("Missing, linked or oversized backup metadata: " + name)
    return archive.extractfile(member).read().decode("utf-8")


def inspect(archive_path, check_target=False):
    if archive_path.stat().st_size > 8 * 1024 ** 3:
        fail("Compressed backup exceeds the 8 GiB review limit")
    with tarfile.open(archive_path, "r:gz") as archive:
        members = {}
        total_bytes = 0
        metadata_roots = set()
        for member in archive:
            name = safe_name(member.name)
            if name in members:
                fail("Duplicate archive member: " + name)
            if not (member.isdir() or member.isfile() or member.islnk()):
                fail("Symlinks, devices and special files are forbidden: " + name)
            if member.isfile() and member.mode & 0o7000:
                fail("Special permission bits need operator review: " + name)
            if member.size < 0 or any(key.startswith("GNU.sparse") for key in member.pax_headers):
                fail("Negative sizes and sparse-file extensions are unsupported")
            members[name] = member
            total_bytes += member.size
            if len(members) > 200000 or total_bytes > 64 * 1024 ** 3:
                fail("Archive exceeds bounded member/payload limits")
            match = re.fullmatch(r"(var/backups/japan-price-basket/\d{8}T\d{6}Z)/([^/]+)", name)
            if match:
                if match[2] not in METADATA:
                    fail("Unexpected recovery metadata filename")
                metadata_roots.add(match[1])
        if len(metadata_roots) != 1:
            fail("Backup must contain exactly one timestamped recovery record")
        metadata_root = metadata_roots.pop()
        # Read in archive order, avoiding repeated backward seeks/redecompression
        # through a multi-GB gzip stream for each tiny metadata record.
        order = sorted(METADATA, key=lambda name: members.get(metadata_root + "/" + name).offset_data if members.get(metadata_root + "/" + name) else -1)
        records = {name: read_metadata(archive, members, metadata_root + "/" + name) for name in order}
        nodes = json.loads(records["nodes.json"])
        if len(nodes.get("items", [])) != 1:
            fail("Only a single-node backup is supported")
        node = nodes["items"][0]
        node_name = node["metadata"]["name"]
        if not re.fullmatch(r"[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?", node_name):
            fail("Recorded node name is invalid")
        architecture = node["status"]["nodeInfo"]["architecture"]
        if architecture not in ("amd64", "arm64"):
            fail("Unsupported backup architecture")
        version_match = re.search(r"k3s version (v\d+\.\d+\.\d+\+k3s\d+)", records["k3s-version.txt"])
        if not version_match:
            fail("Recorded K3s version is missing")
        source_os = os_fields(records["os-release.txt"])
        if source_os.get("ID") != "almalinux":
            fail("This guide's restore supports AlmaLinux only")
        storage = dict(line.split("=", 1) for line in records["storage-paths.txt"].splitlines() if line)
        release = storage.get("release_path", "")
        tls = storage.get("tls_path", "")
        local_roots = []
        for path in [release] + ([tls] if tls else []):
            relative = safe_name(path.lstrip("/"))
            if path != "/" + relative or not relative.startswith("var/lib/rancher/k3s/storage/") or len(relative.split("/")) != 6:
                fail("Invalid recorded local PVC path")
            local_roots.append(relative)
        if not release or (tls and tls == release):
            fail("Invalid release/TLS PVC identity")
        roots = STATE_ROOTS + local_roots + [metadata_root]
        for name, member in members.items():
            if not any(under(name, root) for root in roots) and name != TRAEFIK:
                fail("Archive member is outside approved restore roots: " + name)
            if name.startswith("var/lib/rancher/k3s/server/db/etcd/"):
                fail("This helper cannot restore etcd")
            if member.islnk():
                target = safe_name(member.linkname)
                if target not in members or not members[target].isfile():
                    fail("Hardlink must reference a regular archived file")
                if not any(under(name, root) and under(target, root) for root in roots):
                    fail("Hardlink crosses an approved restore root")
        for required in ["var/lib/rancher/k3s/server/db/state.db", "var/lib/rancher/k3s/server/token", "etc/rancher/node/password"]:
            if required not in members or not members[required].isfile():
                fail("Missing required original datastore/token/node identity")
        deployment_records = json.loads(records["deployments-before.json"])
        allowed = {("japan-price-basket", "web"), ("kube-system", "traefik"), ("flux-system", "source-controller"), ("flux-system", "kustomize-controller")}
        replicas = []
        seen = set()
        for item in deployment_records.get("items", []):
            pair = (item["metadata"]["namespace"], item["metadata"]["name"])
            if pair not in allowed:
                continue
            count = item.get("spec", {}).get("replicas", 1)
            if pair in seen or type(count) is not int or not 0 <= count <= 20:
                fail("Invalid duplicate or unbounded replica record")
            seen.add(pair)
            replicas.append({"namespace": pair[0], "name": pair[1], "replicas": count})
        if ("japan-price-basket", "web") not in seen:
            fail("Original web replica record is missing")
        result = {"schemaVersion": 1, "nodeName": node_name, "architecture": architecture,
                  "k3sVersion": version_match[1], "almaMajor": source_os.get("VERSION_ID", "").split(".")[0],
                  "metadataRoot": metadata_root, "releasePath": release, "tlsPath": tls,
                  "replicas": replicas, "totalFileBytes": total_bytes, "members": len(members)}
        if check_target:
            if not hasattr(os, "geteuid") or os.geteuid() != 0 or platform.system() != "Linux":
                fail("Target validation requires root on Linux")
            current_os = os_fields(Path("/etc/os-release").read_text())
            if current_os.get("ID") != "almalinux" or current_os.get("VERSION_ID", "").split(".")[0] != result["almaMajor"]:
                fail("Replacement host must use the same AlmaLinux major version")
            target_arch = {"x86_64": "amd64", "aarch64": "arm64"}.get(platform.machine())
            if target_arch != architecture:
                fail("Replacement architecture differs from the backup")
            target_version = subprocess.run(["/usr/local/bin/k3s", "--version"], check=True, capture_output=True, text=True).stdout
            if "k3s version " + result["k3sVersion"] + " " not in target_version:
                fail("Install the exact recorded K3s version with SKIP_START first")
            must_be_empty = ["var/lib/rancher/k3s/server", "var/lib/rancher/k3s/storage", "etc/rancher/k3s", "etc/rancher/node", metadata_root]
            for relative in must_be_empty:
                path = Path("/") / relative
                for parent in [path] + list(path.parents):
                    if parent.is_symlink():
                        fail("Target contains a symlink parent: " + str(parent))
                if path.exists() and (not path.is_dir() or any(path.iterdir())):
                    fail("Refusing to merge into a nonempty target: " + str(path))
            free = shutil.disk_usage("/var/lib").free
            if free < int(total_bytes * 1.2) + 512 * 1024 ** 2:
                fail("Insufficient free space for restore plus headroom")
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--check-target", action="store_true")
    args = parser.parse_args()
    result = inspect(args.archive, args.check_target)
    with args.output.open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(result, stream, indent=2)
        stream.write("\n")
    print("Validated archive:", result["members"], "members; node", result["nodeName"], "K3s", result["k3sVersion"])


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, OSError, tarfile.TarError, subprocess.SubprocessError) as error:
        raise SystemExit("Restore validation refused: " + str(error))
