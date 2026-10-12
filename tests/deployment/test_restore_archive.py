"""Synthetic non-price archives: validate paths/identity without extracting to a host."""
import importlib.util
import io
import json
import tarfile
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("restore_archive", ROOT / "scripts/inspect-restore-archive.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class RestoreArchiveTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="jpb-restore-synthetic-")
        self.root = Path(self.temp.name).resolve()
        assert self.root.parent == Path(tempfile.gettempdir()).resolve()
        assert self.root.name.startswith("jpb-restore-synthetic-")
        self.archive = self.root / "synthetic-private-backup.tar.gz"
        self.meta = "var/backups/japan-price-basket/20261012T010203Z"
        self.store = "var/lib/rancher/k3s/storage/pvc-synthetic_japan-price-basket_release-store"
        self.records = {
            "nodes.yaml": "# Synthetic non-price test only\n",
            "nodes.json": json.dumps({"items": [{"metadata": {"name": "synthetic-node"}, "status": {"nodeInfo": {"architecture": "amd64"}}}]}),
            "deployments-before.json": json.dumps({"items": [{"metadata": {"namespace": "japan-price-basket", "name": "web"}, "spec": {"replicas": 2}}]}),
            "flux-summary.txt": "Synthetic only\n",
            "application-objects.yaml": "# Synthetic only\n",
            "persistent-volumes.json": "{}",
            "k3s-version.txt": "k3s version v1.36.5+k3s1 (synthetic)\n",
            "os-release.txt": 'ID="almalinux"\nVERSION_ID="9.6"\n',
            "storage-paths.txt": "release_path=/" + self.store + "\ntls_path=\n",
        }

    def tearDown(self):
        self.temp.cleanup()

    def build(self, extras=(), omit=()):
        payload = {
            "var/lib/rancher/k3s/server/db/state.db": b"Synthetic database bytes, not SQLite",
            "var/lib/rancher/k3s/server/token": b"Synthetic test token",
            "etc/rancher/node/password": b"Synthetic node password",
            self.store + "/.blobs/synthetic": b"Synthetic retained bytes, not prices",
        }
        payload.update({self.meta + "/" + name: text.encode() for name, text in self.records.items()})
        with tarfile.open(self.archive, "w:gz") as archive:
            for name, value in payload.items():
                if name in omit:
                    continue
                member = tarfile.TarInfo(name)
                member.size = len(value)
                member.mode = 0o600
                archive.addfile(member, io.BytesIO(value))
            for member in extras:
                member.mode = 0o600
                archive.addfile(member, io.BytesIO(b"") if member.isfile() else None)

    def test_valid_single_node_metadata(self):
        self.build()
        result = MODULE.inspect(self.archive)
        self.assertEqual(result["nodeName"], "synthetic-node")
        self.assertEqual(result["k3sVersion"], "v1.36.5+k3s1")
        self.assertEqual(result["replicas"], [{"namespace": "japan-price-basket", "name": "web", "replicas": 2}])

    def test_safe_hardlink_within_retained_store(self):
        link = tarfile.TarInfo(self.store + "/app-releases/synthetic/asset.txt")
        link.type = tarfile.LNKTYPE
        link.linkname = self.store + "/.blobs/synthetic"
        self.build([link])
        self.assertEqual(MODULE.inspect(self.archive)["members"], 14)

    def test_traversal_is_refused(self):
        self.build([tarfile.TarInfo("../../outside")])
        with self.assertRaises(ValueError):
            MODULE.inspect(self.archive)

    def test_absolute_member_is_refused(self):
        self.build([tarfile.TarInfo("/etc/passwd")])
        with self.assertRaises(ValueError):
            MODULE.inspect(self.archive)

    def test_symlink_is_refused(self):
        link = tarfile.TarInfo(self.store + "/symlink")
        link.type = tarfile.SYMTYPE
        link.linkname = "/etc/passwd"
        self.build([link])
        with self.assertRaises(ValueError):
            MODULE.inspect(self.archive)

    def test_hardlink_outside_approved_root_is_refused(self):
        link = tarfile.TarInfo(self.store + "/bad-link")
        link.type = tarfile.LNKTYPE
        link.linkname = "var/lib/rancher/k3s/server/token"
        self.build([link])
        with self.assertRaises(ValueError):
            MODULE.inspect(self.archive)

    def test_missing_original_node_password_is_refused(self):
        self.build(omit=["etc/rancher/node/password"])
        with self.assertRaises(ValueError):
            MODULE.inspect(self.archive)

    def test_staging_lock_is_refused(self):
        lock = tarfile.TarInfo(self.store + "/.stage-lock")
        lock.type = tarfile.DIRTYPE
        self.build([lock])
        with self.assertRaises(ValueError):
            MODULE.inspect(self.archive)

    def test_multiple_nodes_are_refused(self):
        self.records["nodes.json"] = json.dumps({"items": [{}, {}]})
        self.build()
        with self.assertRaises(ValueError):
            MODULE.inspect(self.archive)

    def test_unapproved_pvc_path_is_refused(self):
        self.records["storage-paths.txt"] = "release_path=/etc\ntls_path=\n"
        self.build()
        with self.assertRaises(ValueError):
            MODULE.inspect(self.archive)


if __name__ == "__main__":
    unittest.main()
