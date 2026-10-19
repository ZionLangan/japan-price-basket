# Kubernetes files

Generate complete deployment files with `python scripts/render_deployment.py`.
The renderer needs a verified image digest and prepared application/dataset IDs;
it deliberately does not ship an applyable deployment containing fake values.
Only an operator applies `bootstrap/`. Reviewed application promotion copies
generated `production/` into `ops/kubernetes/production/` in the Git repository.
Validate and apply `bootstrap/namespace.yaml` first. A server dry-run does not
persist that namespace for the remaining namespaced documents in a combined
bootstrap file. Once it exists with restricted labels, validate and apply the
complete `bootstrap/bootstrap.yaml`.

Run the lab first using a localhost port-forward. Domain and certificate files
are required only for production mode. TLS starts against Let's Encrypt's
staging service. Staging certificates are deliberately not browser trusted.
The complete configuration was schema checked and Helm rendered locally using
both upstream chart `40.1.0` and the actual K3s packaged chart
`40.1.5+up40.1.0`. Actual cluster server dry-run, certificate issuance and
traffic continuity are separate acceptance checks described in the guide.

Both lab and production images serve the application at `/japan-basket/`.
The production ingress matches the supplied host and only the `/japan-basket`
path prefix, forwarding it unchanged. It does not claim the origin root or use
a default backend. Another Kubernetes service can later own `/` independently.
The immutable asset namespace is `/japan-basket/app-releases/app-<commit>/`;
node-local release storage retains its existing `app-releases/` layout.

The baseline is K3s `v1.36.5+k3s1`, Kubernetes `v1.36`, with bundled Traefik
`3.7.13`, chart `40.1.5+up40.1.0`. These were checked against the official
stable channel and release assets on 2026-10-12. Recheck release requirements
before upgrading; do not replace the version with `latest` without review.

Two web replicas share one retained node-local PVC, mounted read-only by web
pods. A release-specific Job publishes prepared immutable files before a web
rollout. K3s local-path provisioning does not provide a hard 10 GiB filesystem
quota merely because the PVC requests 10 GiB; measure real disk use.
The local-path provisioner normally uses hostPath, for which `fsGroup` does not
guarantee an ownership change. Bootstrap therefore includes non-root read-only
binding Jobs. After they complete, an operator runs the supplied
`tighten-local-volumes.sh` through sudo. It reads the exact Bound PV paths,
verifies that they resolve under `/var/lib/rancher/k3s/storage/`, and changes
only their root ownership/mode: release store `101:101 0750`, ACME store
`65532:65532 0700`. It does not recurse or modify payload bytes. Custom storage
paths require an explicit reviewed adaptation; never work around refusal by
blindly changing `/var/lib` ownership. Then run the real staging Job.

The staging Job and Flux staging Kustomization have unique full-commit names.
No Job TTL is set: removing an actively reconciled Job can cause recreation.
Old stage Kustomizations/Jobs are deliberately retained, requiring bounded
operator cleanup after the 90-day/current-and-previous retention policy.

`production/kustomization.yaml` lists **only** `orchestration.yaml`. Never delete
that root file or replace it with recursive deployment discovery: doing so can
bypass the staging dependency. The parent has only Kustomization permissions;
its children impersonate a separate workload-only service account.

Traefik is one ACME writer with `Recreate`, a retained certificate PVC, and
non-root UID/GID/fsGroup 65532. HTTP-01 requires public port 80 and correct DNS.
Changing ingress configuration or restarting this single Traefik can interrupt
traffic. That is separate from normal application rolling updates.

Official references:

- https://docs.k3s.io/installation/requirements
- https://docs.k3s.io/installation/configuration
- https://docs.k3s.io/advanced#selinux-support
- https://docs.k3s.io/networking/networking-services
- https://github.com/k3s-io/k3s/releases/tag/v1.36.5%2Bk3s1
- https://raw.githubusercontent.com/k3s-io/k3s/v1.36.5%2Bk3s1/manifests/traefik.yaml
- https://github.com/traefik/traefik-helm-chart/blob/v40.1.0/traefik/values.yaml
- https://github.com/k3s-io/k3s-charts/blob/main/assets/traefik/traefik-40.1.5%2Bup40.1.0.tgz
- https://fluxcd.io/flux/components/kustomize/kustomizations/
- https://fluxcd.io/flux/components/source/gitrepositories/
- https://docs.k3s.io/datastore/backup-restore
