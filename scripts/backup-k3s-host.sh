#!/usr/bin/env bash
# Offline SQLite/PVC backup for this single-node kit. This deliberately schedules downtime.
# The archive contains secrets. Never place it in Git or an unprotected cloud folder.
set -Eeuo pipefail
umask 077
[[ $EUID -eq 0 ]] || { echo 'Run: sudo bash scripts/backup-k3s-host.sh' >&2; exit 1; }
command -v jq >/dev/null || { echo 'Install jq first: sudo dnf install jq' >&2; exit 1; }
[[ -f /var/lib/rancher/k3s/server/db/state.db ]] || { echo 'This helper supports the default SQLite datastore only, not etcd or external databases.' >&2; exit 1; }
systemctl is-active --quiet k3s || { echo 'Start K3s and verify the cluster before taking this backup.' >&2; exit 1; }
k() { /usr/local/bin/k3s kubectl "$@"; }
stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_dir="/var/backups/japan-price-basket/$stamp"
[[ ! -e "$backup_dir" ]] || { echo 'Backup directory already exists; wait a second and retry.' >&2; exit 1; }
mkdir -p -m 0700 "$backup_dir"
chmod 0700 /var/backups/japan-price-basket "$backup_dir"
k get nodes -o yaml > "$backup_dir/nodes.yaml"
k get nodes -o json > "$backup_dir/nodes.json"
k get deployments -A -o json > "$backup_dir/deployments-before.json"
k -n japan-price-basket get kustomizations,gitrepositories 2>/dev/null > "$backup_dir/flux-summary.txt" || true
k -n japan-price-basket get deploy,svc,ingress,pvc,job,kustomizations,gitrepositories -o yaml > "$backup_dir/application-objects.yaml"
k get pv -o json > "$backup_dir/persistent-volumes.json"
/usr/local/bin/k3s --version > "$backup_dir/k3s-version.txt"
cp /etc/os-release "$backup_dir/os-release.txt"
unfinished_jobs() {
  # Missing status.active does not mean a queued/starting Job is quiescent.
  k -n japan-price-basket get jobs -o json | jq '[.items[] | select(((.status.conditions // []) | any((.type == "Complete" or .type == "Failed") and .status == "True")) | not)] | length'
}
if [[ $(unfinished_jobs) -ne 0 ]]; then
  echo 'A staging Job is active, queued or not terminal. Let it finish before backup; no workloads have been stopped.' >&2
  exit 1
fi
claim_path() {
  local ns=$1 claim=$2 pv path canonical
  pv=$(k -n "$ns" get pvc "$claim" -o jsonpath='{.spec.volumeName}')
  [[ -n "$pv" ]] || { echo "PVC $ns/$claim is not bound" >&2; return 1; }
  path=$(k get pv "$pv" -o json | jq -r '.spec.hostPath.path // .spec.local.path // empty')
  [[ -n "$path" && -d "$path" ]] || { echo "Unsupported/missing local PV path for $claim" >&2; return 1; }
  canonical=$(readlink -f -- "$path")
  case "$canonical" in /var/lib/rancher/k3s/storage/*) ;; *) echo "PV path is outside the expected K3s storage root: $canonical" >&2; return 1 ;; esac
  printf '%s\n' "$canonical"
}
release_path=$(claim_path japan-price-basket release-store)
tls_path=''
if k -n kube-system get pvc traefik-acme >/dev/null 2>&1; then tls_path=$(claim_path kube-system traefik-acme); fi
printf 'release_path=%s\ntls_path=%s\n' "$release_path" "$tls_path" > "$backup_dir/storage-paths.txt"
recovery_needed=false
restore_running_state() {
  local exit_status=$?
  trap - EXIT
  if [[ "$recovery_needed" == true ]]; then
    echo 'Restarting K3s and restoring the original Deployment replica counts.'
    systemctl start k3s || exit_status=1
    if k wait --for=condition=Ready node --all --timeout=180s; then
      while IFS=$'\t' read -r ns name replicas; do
        k -n "$ns" scale "deployment/$name" --replicas="$replicas" || exit_status=1
      done < <(jq -r '.items[] | select((.metadata.namespace == "flux-system" and (.metadata.name == "source-controller" or .metadata.name == "kustomize-controller")) or (.metadata.namespace == "japan-price-basket" and .metadata.name == "web") or (.metadata.namespace == "kube-system" and .metadata.name == "traefik")) | [.metadata.namespace,.metadata.name,(.spec.replicas // 1)] | @tsv' "$backup_dir/deployments-before.json")
    else
      echo "K3s did not recover. Original replica counts: $backup_dir/deployments-before.json" >&2
      exit_status=1
    fi
  fi
  exit "$exit_status"
}
trap restore_running_state EXIT
recovery_needed=true
# Stop reconciliation first, so Flux cannot undo the deliberate maintenance scale-down.
for controller in source-controller kustomize-controller; do
  if k -n flux-system get "deployment/$controller" >/dev/null 2>&1; then
    k -n flux-system scale "deployment/$controller" --replicas=0
    k -n flux-system wait --for=delete pod -l "app=$controller" --timeout=120s
  fi
done
if [[ -e "$release_path/.stage-lock" || -L "$release_path/.stage-lock" ]]; then
  echo 'The release store has a staging lock. Investigate running/queued staging or a stale lock; this backup never deletes the lock.' >&2
  exit 1
fi
if [[ $(unfinished_jobs) -ne 0 ]]; then
  echo 'A staging Job is not terminal after controller pause. Let it finish and retry.' >&2
  exit 1
fi
k -n japan-price-basket scale deployment/web --replicas=0
k -n japan-price-basket wait --for=delete pod -l app.kubernetes.io/name=japan-price-basket,app.kubernetes.io/component=web --timeout=120s
if k -n kube-system get deployment/traefik >/dev/null 2>&1; then
  k -n kube-system scale deployment/traefik --replicas=0
  k -n kube-system wait --for=delete pod -l app.kubernetes.io/name=traefik --timeout=120s
fi
systemctl stop k3s
systemctl is-active --quiet k3s && { echo 'K3s did not stop.' >&2; exit 1; }
if [[ -e "$release_path/.stage-lock" || -L "$release_path/.stage-lock" ]]; then
  echo 'A staging lock appeared before archiving. Abort and investigate; the restart trap restores services without deleting it.' >&2
  exit 1
fi
paths=(var/lib/rancher/k3s/server/db var/lib/rancher/k3s/server/token etc/rancher/k3s "${release_path#/}")
[[ -z "$tls_path" ]] || paths+=("${tls_path#/}")
for extra in etc/rancher/node var/lib/rancher/k3s/server/tls var/lib/rancher/k3s/server/cred var/lib/rancher/k3s/server/manifests/traefik-config.yaml; do
  [[ ! -e /$extra ]] || paths+=("$extra")
done
# Include only named recovery metadata, never the whole output directory or the
# archive being written. These records retain node/PV identity and original counts.
for record in nodes.yaml nodes.json deployments-before.json flux-summary.txt application-objects.yaml persistent-volumes.json k3s-version.txt os-release.txt storage-paths.txt; do
  paths+=("${backup_dir#/}/$record")
done
tar --create --gzip --selinux --xattrs --acls --numeric-owner --file "$backup_dir/private-host-backup.tar.gz" --directory / "${paths[@]}"
chmod 0600 "$backup_dir/private-host-backup.tar.gz"
tar --list --gzip --file "$backup_dir/private-host-backup.tar.gz" > "$backup_dir/archive-members.txt"
(cd "$backup_dir" && sha256sum private-host-backup.tar.gz > private-host-backup.tar.gz.sha256)
date -u +%FT%TZ > "$backup_dir/completed-utc.txt"
echo "Backup complete: $backup_dir"
echo 'The EXIT trap now restarts services. Inspect readiness after they return.'
echo 'Encrypt and copy the backup off the host. A file on this same disk is not disaster recovery.'
