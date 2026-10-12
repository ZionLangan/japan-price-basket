#!/usr/bin/env bash
# Fresh replacement host only. Never overwrites or merges an initialized cluster.
# Install the exact recorded K3s version with INSTALL_K3S_SKIP_START=true first.
set -Eeuo pipefail
umask 077
[[ $EUID -eq 0 ]] || { echo 'Run this helper with sudo on the replacement host.' >&2; exit 1; }
archive=''; expected_sha=''; confirmed=false; resume_flux=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --archive) [[ $# -ge 2 ]] || exit 2; archive=$2; shift 2 ;;
    --sha256) [[ $# -ge 2 ]] || exit 2; expected_sha=$2; shift 2 ;;
    --confirm-replacement-host) confirmed=true; shift ;;
    --resume-flux) resume_flux=true; shift ;;
    *) echo 'Usage: sudo bash restore-k3s-host.sh --archive FILE --sha256 SHA --confirm-replacement-host [--resume-flux]' >&2; exit 2 ;;
  esac
done
[[ "$confirmed" == true && -f "$archive" && ! -L "$archive" && "$expected_sha" =~ ^[a-fA-F0-9]{64}$ ]] || { echo 'Supply a regular decrypted backup, trusted checksum and explicit replacement-host confirmation.' >&2; exit 2; }
for tool in python3 jq tar hostnamectl systemctl getenforce; do command -v "$tool" >/dev/null || { echo "Install required tool: $tool" >&2; exit 1; }; done
[[ $(getenforce) == Enforcing ]] || { echo 'Preserve SELinux Enforcing and install the matching K3s SELinux policy before restoring.' >&2; exit 1; }
[[ -x /usr/local/bin/k3s ]] || { echo 'Install the matching K3s version with INSTALL_K3S_SKIP_START=true.' >&2; exit 1; }
systemctl is-active --quiet k3s && { echo 'K3s is running. This helper supports only an uninitialized replacement host; stop and check your target.' >&2; exit 1; }
actual_sha=$(sha256sum -- "$archive" | awk '{print $1}')
[[ "$actual_sha" == "${expected_sha,,}" ]] || { echo 'Backup SHA-256 mismatch.' >&2; exit 1; }
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
[[ -f "$script_dir/inspect-restore-archive.py" ]] || { echo 'Copy inspect-restore-archive.py beside this helper.' >&2; exit 1; }
work=$(mktemp -d /var/tmp/jpb-restore-validation.XXXXXX)
chmod 0700 "$work"
echo "Validation/recovery evidence remains in $work; no directory is automatically deleted."
python3 "$script_dir/inspect-restore-archive.py" --archive "$archive" --output "$work/validated.json" --check-target
node_name=$(jq -r .nodeName "$work/validated.json")
echo "Restoring the recorded single-node identity: $node_name"
hostnamectl set-hostname "$node_name"
# All members, link targets and nonempty target roots were checked before extraction.
# Preserve exact numeric ownership/modes, saved SELinux labels and ACL/xattr metadata.
tar --extract --gzip --selinux --xattrs --acls --numeric-owner --same-owner --same-permissions --keep-old-files --file "$archive" --directory /
printf 'extracted\n' > "$work/state"
# Keep Kubernetes node identity stable even if cloud-init later changes the OS
# hostname. Drop-ins are supported by this guide's pinned K3s version.
node_config=/etc/rancher/k3s/config.yaml.d/99-jpb-restore-node-name.yaml
mkdir -p -m 0700 /etc/rancher/k3s/config.yaml.d
expected_config=$(printf 'node-name: "%s"' "$node_name")
if [[ -e "$node_config" || -L "$node_config" ]]; then
  [[ -f "$node_config" && ! -L "$node_config" && $(cat "$node_config") == "$expected_config" ]] || { echo 'A conflicting node-identity drop-in exists; investigate without overwriting it.' >&2; exit 1; }
else
  (set -o noclobber; printf '%s\n' "$expected_config" > "$node_config")
  chmod 0600 "$node_config"
fi
systemctl start k3s
k() { /usr/local/bin/k3s kubectl "$@"; }
k wait --for=condition=Ready "node/$node_name" --timeout=300s
while IFS=$'\t' read -r ns name count; do
  if [[ "$ns" == flux-system && "$resume_flux" != true ]]; then
    k -n "$ns" scale "deployment/$name" --replicas=0
    continue
  fi
  k -n "$ns" scale "deployment/$name" --replicas="$count"
done < <(jq -r '.replicas[] | [.namespace,.name,.replicas] | @tsv' "$work/validated.json")
k -n japan-price-basket rollout status deployment/web --timeout=600s
if jq -e '.replicas[] | select(.namespace=="kube-system" and .name=="traefik")' "$work/validated.json" >/dev/null; then
  k -n kube-system rollout status deployment/traefik --timeout=300s
fi
printf 'restarted\n' > "$work/state"
echo 'Restore reached Kubernetes readiness. Verify retained release/image/dataset, serving bytes and SELinux events through an SSH tunnel before moving production IP/DNS.'
if [[ "$resume_flux" != true ]]; then
  echo "Flux stays paused for isolated verification. Original counts are in $work/validated.json; explicitly restore those counts after checking protected Git."
fi
