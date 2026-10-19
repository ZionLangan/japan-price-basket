"""Synthetic deployment identities only; no cluster or public service is used."""
import argparse
import contextlib
import importlib.util
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("render_deployment", ROOT / "scripts/render_deployment.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class RenderDeploymentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="jpb-render-synthetic-")
        self.output = Path(self.temp.name) / "deployment"
        self.commit = "0" * 40
        self.release = "app-" + self.commit
        self.image = "ghcr.io/zionlangan/japan-price-basket@sha256:" + "1" * 64
        self.dataset = "rps-2026-08-000000000000"

    def tearDown(self):
        self.temp.cleanup()

    def render(self, mode="production"):
        args = argparse.Namespace(
            image=self.image, app_release=self.release, dataset=self.dataset,
            mode=mode, domain="basket.synthetic-site.jp" if mode == "production" else None,
            acme_email="operator@synthetic-site.jp" if mode == "production" else None,
            tls_environment="production", output=self.output,
        )
        with patch.object(MODULE, "write_yaml", wraps=MODULE.write_yaml) as writes:
            with contextlib.redirect_stdout(io.StringIO()):
                MODULE.render(args)
        documents = {}
        for call in writes.call_args_list:
            file, *values = call.args
            documents[file.relative_to(self.output).as_posix()] = values
        return documents

    def test_production_ingress_preserves_only_the_application_mount(self):
        documents = self.render()
        ingress_path = f"production/releases/{self.release}/web/ingress.yaml"
        ingress, = documents[ingress_path]
        spec = ingress["spec"]
        self.assertNotIn("defaultBackend", spec)
        self.assertEqual(spec["tls"], [{"hosts": ["basket.synthetic-site.jp"]}])
        self.assertEqual(spec["rules"], [{
            "host": "basket.synthetic-site.jp",
            "http": {"paths": [{
                "path": "/japan-basket", "pathType": "Prefix",
                "backend": {"service": {"name": "web", "port": {"number": 80}}},
            }]},
        }])
        self.assertEqual(ingress["metadata"]["annotations"], {
            "traefik.ingress.kubernetes.io/router.entrypoints": "websecure",
            "traefik.ingress.kubernetes.io/router.tls": "true",
            "traefik.ingress.kubernetes.io/router.tls.certresolver": "letsencrypt",
        })
        emitted = (self.output / ingress_path).read_text(encoding="utf-8")
        self.assertIn('path: "/japan-basket"\n', emitted)
        self.assertNotIn('path: "/"\n', emitted)

    def test_descriptor_records_mount_and_exact_candidate_identity(self):
        self.render()
        descriptor = json.loads((self.output / f"production/releases/{self.release}/release.json").read_text(encoding="utf-8"))
        self.assertEqual(descriptor["publicBasePath"], "/japan-basket/")
        self.assertEqual(descriptor["image"], self.image)
        self.assertEqual(descriptor["sourceCommit"], self.commit)
        self.assertEqual(descriptor["appRelease"], self.release)
        self.assertEqual(descriptor["dataset"], self.dataset)

    def test_lab_has_no_public_ingress_and_keeps_the_same_tunnel_mount(self):
        documents = self.render("lab")
        self.assertFalse(any(path.endswith("/ingress.yaml") for path in documents))
        resources, = documents[f"production/releases/{self.release}/web/kustomization.yaml"]
        self.assertEqual(resources["resources"], ["deployment.yaml", "service.yaml"])
        descriptor = json.loads((self.output / f"production/releases/{self.release}/release.json").read_text(encoding="utf-8"))
        self.assertEqual(descriptor["publicBasePath"], "/japan-basket/")
        self.assertIsNone(descriptor["domain"])

    def test_subpath_routing_preserves_exact_stage_dependency_and_probe_paths(self):
        documents = self.render()
        stage, web = documents["production/orchestration.yaml"]
        self.assertEqual(web["spec"]["dependsOn"], [{"name": "stage-" + self.commit}])
        self.assertEqual(stage["spec"]["healthChecks"], [{
            "apiVersion": "batch/v1", "kind": "Job",
            "name": "jpb-stage-" + self.commit, "namespace": "japan-price-basket",
        }])
        deployment, = documents[f"production/releases/{self.release}/web/deployment.yaml"]
        container = deployment["spec"]["template"]["spec"]["containers"][0]
        self.assertEqual(container["startupProbe"]["httpGet"]["path"], "/readyz")
        self.assertEqual(container["readinessProbe"]["httpGet"]["path"], "/readyz")
        self.assertEqual(container["livenessProbe"]["httpGet"]["path"], "/livez")


if __name__ == "__main__":
    unittest.main()
