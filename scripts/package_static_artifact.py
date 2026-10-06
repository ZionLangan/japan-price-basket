"""Package a reviewed clean-commit static build, with file hashes and a rollback ZIP."""

import hashlib
import json
import subprocess
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def package():
    status = subprocess.check_output(["git", "status", "--porcelain"], cwd=ROOT, text=True)
    if status.strip():
        raise SystemExit("Commit the reviewed source before packaging a release")
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    dist = ROOT / "dist"
    pointer = json.loads((dist / "data/current.json").read_text(encoding="utf-8"))
    manifest = json.loads((dist / "data" / pointer["manifest"]).read_text(encoding="utf-8"))
    entries = []
    for file in sorted(dist.rglob("*")):
        if file.is_symlink():
            raise SystemExit("Do not package symlinks")
        if file.is_file():
            data = file.read_bytes()
            entries.append({"path": file.relative_to(dist).as_posix(), "bytes": len(data),
                            "sha256": hashlib.sha256(data).hexdigest()})
    folder = ROOT / "data/releases"
    folder.mkdir(parents=True, exist_ok=True)
    name = f"japan-inflation-{commit[:12]}-{manifest['releaseId']}"
    archive = folder / f"{name}.zip"
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as output:
        for entry in entries:
            info = zipfile.ZipInfo(entry["path"], date_time=(2020, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            output.writestr(info, (dist / entry["path"]).read_bytes())
    report = {"commit": commit, "dataset": manifest["releaseId"], "policyVersion": manifest["policyVersion"],
              "sourceCutoff": manifest["end"], "files": entries, "archive": archive.name,
              "archiveSha256": hashlib.sha256(archive.read_bytes()).hexdigest()}
    (folder / f"{name}.manifest.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"{archive}\n{len(entries)} files; {archive.stat().st_size} bytes")


if __name__ == "__main__":
    package()
