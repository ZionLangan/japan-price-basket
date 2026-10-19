"""Check the supplied Flux artifact's startup budget and integrity receipt."""
import hashlib
import json
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


class FluxInstallTests(unittest.TestCase):
    def test_both_controllers_allow_startup_before_liveness_can_restart_them(self):
        text = (ROOT / "ops/flux/install.yaml").read_text(encoding="utf-8")
        deployments = {}
        for document in text.split("\n---\n"):
            if re.search(r"(?m)^kind: Deployment$", document):
                name = re.search(r"(?m)^  name: (.+)$", document)[1]
                deployments[name] = document
        self.assertEqual(set(deployments), {"source-controller", "kustomize-controller"})
        for name, document in deployments.items():
            with self.subTest(controller=name):
                # Inspect only the named probe blocks in this pinned artifact;
                # Kubernetes server validation remains the schema/admission gate.
                startup = re.search(r"(?m)^        startupProbe:\n((?: {10}.+\n)+)", document)
                self.assertIsNotNone(startup, "A slow initial start must not consume liveness retries")
                startup = startup[1]
                self.assertRegex(startup, r"(?m)^            path: /healthz$")
                self.assertRegex(startup, r"(?m)^            port: healthz$")
                settings = {key: int(value) for key, value in re.findall(
                    r"(?m)^          (timeoutSeconds|periodSeconds|failureThreshold): (\d+)$", startup,
                )}
                self.assertEqual(settings["timeoutSeconds"], 2)
                self.assertGreaterEqual(settings["periodSeconds"] * settings["failureThreshold"], 120)
                self.assertLessEqual(settings["periodSeconds"] * settings["failureThreshold"], 180)
                liveness = re.search(r"(?m)^        livenessProbe:\n((?: {10}.+\n)+)", document)[1]
                self.assertRegex(liveness, r"(?m)^          timeoutSeconds: 2$")
                self.assertRegex(document, r"(?m)^        - containerPort: 9440\n          name: healthz$")

    def test_install_bytes_match_the_reviewed_lock(self):
        install = (ROOT / "ops/flux/install.yaml").read_bytes()
        lock = json.loads((ROOT / "ops/flux/version.lock.json").read_text(encoding="utf-8"))
        self.assertEqual(hashlib.sha256(install).hexdigest(), lock["installSha256"])


if __name__ == "__main__":
    unittest.main()
