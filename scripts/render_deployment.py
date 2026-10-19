#!/usr/bin/env python3
"""Render copyable Kubernetes manifests from validated, non-secret inputs.

No network access, kubectl invocation, Git mutation or deployment occurs here.
Requires only Python's standard library. JSON strings are also YAML scalars.
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

NAMESPACE = "japan-price-basket"
K3S_VERSION = "v1.36.5+k3s1"
PSA_VERSION = "v1.36"
TRAEFIK_CHART = "40.1.5+up40.1.0"
PUBLIC_BASE_PATH = "/japan-basket/"


def scalar(value):
    return json.dumps(value, ensure_ascii=False)


def yaml_lines(value, depth=0):
    indent = "  " * depth
    if isinstance(value, dict):
        for key, item in value.items():
            if isinstance(item, (dict, list)) and item:
                yield f"{indent}{key}:"
                yield from yaml_lines(item, depth + 1)
            elif isinstance(item, str) and "\n" in item:
                yield f"{indent}{key}: |-"
                for line in item.rstrip("\n").split("\n"):
                    yield "  " * (depth + 1) + line
            else:
                yield f"{indent}{key}: {scalar(item)}"
    elif isinstance(value, list):
        for item in value:
            if isinstance(item, (dict, list)) and item:
                yield f"{indent}-"
                yield from yaml_lines(item, depth + 1)
            else:
                yield f"{indent}- {scalar(item)}"


def write_yaml(path, *documents):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n---\n".join("\n".join(yaml_lines(doc)) for doc in documents) + "\n", encoding="utf-8", newline="\n")


def metadata(name, namespace=NAMESPACE):
    return {"name": name, "namespace": namespace}


def kustomization(resources):
    return {"apiVersion": "kustomize.config.k8s.io/v1beta1", "kind": "Kustomization", "resources": resources}


def role(name, rules):
    return {"apiVersion": "rbac.authorization.k8s.io/v1", "kind": "Role", "metadata": metadata(name), "rules": rules}


def service_account(name):
    return {"apiVersion": "v1", "kind": "ServiceAccount", "metadata": metadata(name), "automountServiceAccountToken": False}


def binding(name):
    return {"apiVersion": "rbac.authorization.k8s.io/v1", "kind": "RoleBinding", "metadata": metadata(name), "roleRef": {"apiGroup": "rbac.authorization.k8s.io", "kind": "Role", "name": name}, "subjects": [{"kind": "ServiceAccount", "name": name, "namespace": NAMESPACE}]}


def pvc(name, namespace, size):
    return {"apiVersion": "v1", "kind": "PersistentVolumeClaim", "metadata": metadata(name, namespace), "spec": {"storageClassName": "jpb-releases-local", "accessModes": ["ReadWriteOnce"], "resources": {"requests": {"storage": size}}}}


def render(args):
    if not re.fullmatch(r"ghcr\.io/zionlangan/japan-price-basket@sha256:[a-f0-9]{64}", args.image):
        raise ValueError("--image must be this project's GHCR URL followed by a real immutable SHA-256 digest")
    if not re.fullmatch(r"app-[a-f0-9]{40}", args.app_release):
        raise ValueError("--app-release must be app- plus the full 40-character Git commit")
    if not re.fullmatch(r"rps-20[0-9]{2}-(0[1-9]|1[0-2])-[a-f0-9]{12}", args.dataset):
        raise ValueError("--dataset must be the actual dataset ID from the prepared release manifest")
    domain = (args.domain or "").strip().lower()
    if args.mode == "production":
        if not re.fullmatch(r"(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}", domain):
            raise ValueError("Production requires a real DNS domain, without https://, paths or a port")
        if domain.endswith((".example", ".invalid", ".localhost", ".test")) or domain in ("example.com", "example.net", "example.org"):
            raise ValueError("Replace the example domain with a domain you control before rendering production")
        if not args.acme_email or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", args.acme_email):
            raise ValueError("Production requires a real --acme-email for certificate notices")
    elif args.domain or args.acme_email:
        raise ValueError("Lab mode uses localhost port-forwarding; omit domain and email")

    output = Path(args.output).resolve()
    if output.exists() and not output.is_dir():
        raise ValueError(f"Output must be a new directory, not an existing file: {output}")
    if output.exists() and any(output.iterdir()):
        raise ValueError(f"Refusing to overwrite nonempty output: {output}. Use a new review directory.")
    commit = args.app_release.removeprefix("app-")
    stage_name = "stage-" + commit
    job_name = "jpb-stage-" + commit
    release_path = f"./ops/kubernetes/production/releases/{args.app_release}"
    labels = {"app.kubernetes.io/name": "japan-price-basket", "app.kubernetes.io/component": "web"}
    release_labels = {**labels, "jpb.example/app-release": args.app_release}
    stage_labels = {**release_labels, "app.kubernetes.io/component": "stage"}
    annotations = {"jpb.example/image": args.image, "jpb.example/dataset": args.dataset}

    namespace = {"apiVersion": "v1", "kind": "Namespace", "metadata": {"name": NAMESPACE, "labels": {"pod-security.kubernetes.io/enforce": "restricted", "pod-security.kubernetes.io/enforce-version": PSA_VERSION, "pod-security.kubernetes.io/audit": "restricted", "pod-security.kubernetes.io/audit-version": PSA_VERSION, "pod-security.kubernetes.io/warn": "restricted", "pod-security.kubernetes.io/warn-version": PSA_VERSION}}}
    storage = {"apiVersion": "storage.k8s.io/v1", "kind": "StorageClass", "metadata": {"name": "jpb-releases-local"}, "provisioner": "rancher.io/local-path", "reclaimPolicy": "Retain", "volumeBindingMode": "WaitForFirstConsumer", "allowVolumeExpansion": False}
    verbs = ["get", "list", "watch", "create", "update", "patch", "delete"]
    app_rules = [{"apiGroups": ["apps"], "resources": ["deployments", "replicasets"], "verbs": verbs}, {"apiGroups": [""], "resources": ["services"], "verbs": verbs}, {"apiGroups": ["batch"], "resources": ["jobs"], "verbs": verbs}, {"apiGroups": ["networking.k8s.io"], "resources": ["ingresses"], "verbs": verbs}]
    config_rules = [{"apiGroups": ["kustomize.toolkit.fluxcd.io"], "resources": ["kustomizations"], "verbs": verbs}]
    bootstrap = [namespace, storage, pvc("release-store", NAMESPACE, "10Gi"), service_account("no-permissions"), service_account("web"), service_account("app-reconciler"), service_account("config-manager"), role("app-reconciler", app_rules), role("config-manager", config_rules), binding("app-reconciler"), binding("config-manager")]
    if args.mode == "production":
        bootstrap.append(pvc("traefik-acme", "kube-system", "128Mi"))

    def bind_job(name, namespace, claim, uid):
        # A non-root, read-only first consumer triggers local-path provisioning.
        # Operator ownership tightening occurs after binding and before staging.
        return {"apiVersion": "batch/v1", "kind": "Job", "metadata": metadata(name, namespace), "spec": {"activeDeadlineSeconds": 900, "backoffLimit": 0, "template": {"spec": {"automountServiceAccountToken": False, "restartPolicy": "Never", "securityContext": {"runAsNonRoot": True, "runAsUser": uid, "runAsGroup": uid, "seccompProfile": {"type": "RuntimeDefault"}}, "containers": [{"name": "check", "image": args.image, "imagePullPolicy": "IfNotPresent", "args": ["/bin/sh", "-ec", "id\nls -ld /srv/releases\ntest -d /srv/releases"], "securityContext": {"allowPrivilegeEscalation": False, "readOnlyRootFilesystem": True, "capabilities": {"drop": ["ALL"]}}, "resources": {"requests": {"cpu": "10m", "memory": "32Mi"}, "limits": {"cpu": "100m", "memory": "64Mi"}}, "volumeMounts": [{"name": "check", "mountPath": "/srv/releases", "readOnly": True}]}], "volumes": [{"name": "check", "persistentVolumeClaim": {"claimName": claim}}]}}}}

    bootstrap.append(bind_job("jpb-bind-release-" + commit, NAMESPACE, "release-store", 101))
    if args.mode == "production":
        bootstrap.append(bind_job("jpb-bind-acme-" + commit, "kube-system", "traefik-acme", 65532))
    # A server dry-run does not persist a Namespace for later documents in the
    # same request sequence. Bootstrap this restricted namespace explicitly.
    write_yaml(output / "bootstrap/namespace.yaml", namespace)
    write_yaml(output / "bootstrap/bootstrap.yaml", *bootstrap)

    env = [{"name": "EXPECTED_APP_RELEASE", "value": args.app_release}, {"name": "EXPECTED_DATASET", "value": args.dataset}, {"name": "EXPECTED_IMAGE", "value": args.image}]
    security = {"allowPrivilegeEscalation": False, "readOnlyRootFilesystem": True, "capabilities": {"drop": ["ALL"]}}
    pod_security = {"runAsNonRoot": True, "runAsUser": 101, "runAsGroup": 101, "fsGroup": 101, "fsGroupChangePolicy": "OnRootMismatch", "seccompProfile": {"type": "RuntimeDefault"}}
    volume = {"name": "releases", "persistentVolumeClaim": {"claimName": "release-store"}}
    tmp = {"name": "tmp", "emptyDir": {"sizeLimit": "64Mi"}}
    stage_container = {"name": "stage", "image": args.image, "imagePullPolicy": "IfNotPresent", "args": ["stage"], "env": env, "securityContext": security, "resources": {"requests": {"cpu": "50m", "memory": "64Mi"}, "limits": {"cpu": "500m", "memory": "256Mi"}}, "volumeMounts": [{"name": "releases", "mountPath": "/srv/releases"}, {"name": "tmp", "mountPath": "/tmp"}]}
    job = {"apiVersion": "batch/v1", "kind": "Job", "metadata": {**metadata(job_name), "labels": stage_labels, "annotations": annotations}, "spec": {"activeDeadlineSeconds": 900, "backoffLimit": 1, "template": {"metadata": {"labels": stage_labels}, "spec": {"serviceAccountName": "web", "automountServiceAccountToken": False, "restartPolicy": "Never", "securityContext": pod_security, "containers": [stage_container], "volumes": [volume, tmp]}}}}
    write_yaml(output / f"production/releases/{args.app_release}/stage/job.yaml", job)
    write_yaml(output / f"production/releases/{args.app_release}/stage/kustomization.yaml", kustomization(["job.yaml"]))

    def probe(path, **extra):
        return {"httpGet": {"path": path, "port": "http"}, "timeoutSeconds": 2, **extra}
    web_container = {"name": "web", "image": args.image, "imagePullPolicy": "IfNotPresent", "args": ["serve"], "env": [*env, {"name": "SERVE_MODE", "value": "production"}], "ports": [{"name": "http", "containerPort": 8080}], "securityContext": security, "resources": {"requests": {"cpu": "25m", "memory": "32Mi"}, "limits": {"cpu": "250m", "memory": "128Mi"}}, "startupProbe": probe("/readyz", periodSeconds=2, failureThreshold=60), "readinessProbe": probe("/readyz", periodSeconds=3, failureThreshold=2), "livenessProbe": probe("/livez", periodSeconds=10, failureThreshold=3), "lifecycle": {"preStop": {"exec": {"command": ["/bin/sh", "-c", "rm -f /tmp/ready; sleep 5; nginx -s quit"]}}}, "volumeMounts": [{"name": "releases", "mountPath": "/srv/releases", "readOnly": True}, {"name": "tmp", "mountPath": "/tmp"}]}
    deployment = {"apiVersion": "apps/v1", "kind": "Deployment", "metadata": {**metadata("web"), "annotations": annotations}, "spec": {"replicas": 2, "revisionHistoryLimit": 3, "minReadySeconds": 5, "progressDeadlineSeconds": 180, "strategy": {"type": "RollingUpdate", "rollingUpdate": {"maxUnavailable": 0, "maxSurge": 1}}, "selector": {"matchLabels": labels}, "template": {"metadata": {"labels": release_labels, "annotations": annotations}, "spec": {"serviceAccountName": "web", "automountServiceAccountToken": False, "terminationGracePeriodSeconds": 30, "securityContext": pod_security, "containers": [web_container], "volumes": [volume, tmp]}}}}
    service = {"apiVersion": "v1", "kind": "Service", "metadata": metadata("web"), "spec": {"type": "ClusterIP", "selector": labels, "ports": [{"name": "http", "port": 80, "targetPort": "http"}]}}
    write_yaml(output / f"production/releases/{args.app_release}/web/deployment.yaml", deployment)
    write_yaml(output / f"production/releases/{args.app_release}/web/service.yaml", service)
    web_resources = ["deployment.yaml", "service.yaml"]
    if args.mode == "production":
        # Preserve the application prefix at Nginx and leave the host root free
        # for another service. Prefix matching also accepts the mount without /.
        ingress = {"apiVersion": "networking.k8s.io/v1", "kind": "Ingress", "metadata": {**metadata("web"), "annotations": {"traefik.ingress.kubernetes.io/router.entrypoints": "websecure", "traefik.ingress.kubernetes.io/router.tls": "true", "traefik.ingress.kubernetes.io/router.tls.certresolver": "letsencrypt"}}, "spec": {"ingressClassName": "traefik", "tls": [{"hosts": [domain]}], "rules": [{"host": domain, "http": {"paths": [{"path": PUBLIC_BASE_PATH.rstrip("/"), "pathType": "Prefix", "backend": {"service": {"name": "web", "port": {"number": 80}}}}]}}]}}
        write_yaml(output / f"production/releases/{args.app_release}/web/ingress.yaml", ingress)
        web_resources.append("ingress.yaml")
        ca = "https://acme-staging-v02.api.letsencrypt.org/directory" if args.tls_environment == "staging" else "https://acme-v02.api.letsencrypt.org/directory"
        # Separate files keep staging and production accounts/certificates apart.
        values = {"deployment": {"replicas": 1}, "updateStrategy": {"type": "Recreate"}, "persistence": {"enabled": True, "existingClaim": "traefik-acme", "path": "/data"}, "podSecurityContext": {"runAsNonRoot": True, "runAsUser": 65532, "runAsGroup": 65532, "fsGroup": 65532, "fsGroupChangePolicy": "OnRootMismatch", "seccompProfile": {"type": "RuntimeDefault"}}, "securityContext": {"allowPrivilegeEscalation": False, "readOnlyRootFilesystem": True, "capabilities": {"drop": ["ALL"]}}, "resources": {"requests": {"cpu": "50m", "memory": "64Mi"}, "limits": {"cpu": "500m", "memory": "256Mi"}}, "ports": {"web": {"http": {"redirections": {"entryPoint": {"to": "websecure", "scheme": "https", "permanent": True}}}}, "websecure": {"http": {"tls": {"enabled": True, "certResolver": "letsencrypt"}}}}, "certificatesResolvers": {"letsencrypt": {"acme": {"email": args.acme_email, "storage": f"/data/acme-{args.tls_environment}.json", "caServer": ca, "httpChallenge": {"entryPoint": "web"}}}}}
        # Traefik otherwise matches character prefixes, including /japan-basketball.
        values["providers"] = {"kubernetesIngress": {"strictPrefixMatching": True}}
        helm_config = {"apiVersion": "helm.cattle.io/v1", "kind": "HelmChartConfig", "metadata": metadata("traefik", "kube-system"), "spec": {"valuesContent": "\n".join(yaml_lines(values)) + "\n"}}
        write_yaml(output / "bootstrap/traefik-config.yaml", helm_config)
        write_yaml(output / "bootstrap/traefik-values.yaml", values)

    write_yaml(output / f"production/releases/{args.app_release}/web/kustomization.yaml", kustomization(web_resources))
    stage_flux = {"apiVersion": "kustomize.toolkit.fluxcd.io/v1", "kind": "Kustomization", "metadata": metadata(stage_name), "spec": {"interval": "5m", "retryInterval": "30s", "timeout": "16m", "sourceRef": {"kind": "GitRepository", "name": "app-source"}, "path": release_path + "/stage", "prune": False, "serviceAccountName": "app-reconciler", "healthChecks": [{"apiVersion": "batch/v1", "kind": "Job", "name": job_name, "namespace": NAMESPACE}]}}
    web_flux = {"apiVersion": "kustomize.toolkit.fluxcd.io/v1", "kind": "Kustomization", "metadata": metadata("jpb-web"), "spec": {"interval": "5m", "retryInterval": "30s", "timeout": "5m", "sourceRef": {"kind": "GitRepository", "name": "app-source"}, "path": release_path + "/web", "prune": True, "serviceAccountName": "app-reconciler", "dependsOn": [{"name": stage_name}], "healthChecks": [{"apiVersion": "apps/v1", "kind": "Deployment", "name": "web", "namespace": NAMESPACE}]}}
    write_yaml(output / "production/orchestration.yaml", stage_flux, web_flux)
    # Crucial: explicit root resources prevent recursive discovery of web YAML.
    write_yaml(output / "production/kustomization.yaml", kustomization(["orchestration.yaml"]))
    source = {"apiVersion": "source.toolkit.fluxcd.io/v1", "kind": "GitRepository", "metadata": metadata("app-source"), "spec": {"interval": "1m", "timeout": "90s", "url": "https://github.com/ZionLangan/japan-price-basket.git", "ref": {"branch": "main"}, "sparseCheckout": ["ops/kubernetes/production"]}}
    parent_flux = {"apiVersion": "kustomize.toolkit.fluxcd.io/v1", "kind": "Kustomization", "metadata": metadata("app-config"), "spec": {"interval": "1m", "retryInterval": "30s", "timeout": "2m", "sourceRef": {"kind": "GitRepository", "name": "app-source"}, "path": "./ops/kubernetes/production", "prune": False, "serviceAccountName": "config-manager"}}
    write_yaml(output / "flux/app-source.yaml", source)
    write_yaml(output / "flux/app-config.yaml", parent_flux)
    descriptor = {"schemaVersion": 1, "appRelease": args.app_release, "image": args.image, "dataset": args.dataset, "sourceCommit": commit, "publicBasePath": PUBLIC_BASE_PATH, "mode": args.mode, "domain": domain if args.mode == "production" else None, "tlsEnvironment": args.tls_environment if args.mode == "production" else None, "baselineK3sVersion": K3S_VERSION, "traefikChart": TRAEFIK_CHART}
    descriptor_path = output / f"production/releases/{args.app_release}/release.json"
    descriptor_path.write_text(json.dumps(descriptor, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps({"output": str(output), "appRelease": args.app_release, "stageJob": job_name, "stageKustomization": stage_name, "mode": args.mode}, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", required=True)
    parser.add_argument("--app-release", required=True)
    parser.add_argument("--dataset", required=True)
    parser.add_argument("--mode", choices=["lab", "production"], default="lab")
    parser.add_argument("--domain")
    parser.add_argument("--acme-email")
    parser.add_argument("--tls-environment", choices=["staging", "production"], default="staging")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    try:
        render(args)
    except ValueError as error:
        parser.error(str(error))


if __name__ == "__main__":
    main()
