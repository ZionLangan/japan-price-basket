#!/bin/bash
# Operator bootstrap only. This is never run inside an application pod.
# Native local-path hostPath volumes do not guarantee fsGroup ownership.
set -euo pipefail
if [[ $(id -u) != 0 ]]; then
    printf 'Run this reviewed operator helper through sudo bash.\n' >&2
    exit 1
fi
INCLUDE_ACME=false
if [[ ${1:-} == --include-acme && $# == 1 ]]; then
    INCLUDE_ACME=true
elif [[ $# != 0 ]]; then
    printf 'Usage: tighten-local-volumes.sh [--include-acme]\n' >&2
    exit 1
fi
STORAGE_ROOT=$(realpath -e -- /var/lib/rancher/k3s/storage)
set_owner() {
    local namespace=$1 claim=$2 uid=$3 mode=$4 pv path resolved actual_claim
    pv=$(k3s kubectl -n "$namespace" get pvc "$claim" -o jsonpath='{.spec.volumeName}')
    [[ -n "$pv" ]] || { printf 'PVC %s/%s is not Bound. Wait for its binder Job.\n' "$namespace" "$claim" >&2; exit 1; }
    actual_claim=$(k3s kubectl get pv "$pv" -o jsonpath='{.spec.claimRef.namespace}/{.spec.claimRef.name}')
    [[ "$actual_claim" == "$namespace/$claim" ]] || { printf 'PV claim identity differs; refusing.\n' >&2; exit 1; }
    path=$(k3s kubectl get pv "$pv" -o jsonpath='{.spec.hostPath.path}')
    if [[ -z "$path" ]]; then
        path=$(k3s kubectl get pv "$pv" -o jsonpath='{.spec.local.path}')
    fi
    [[ -n "$path" && -d "$path" && ! -L "$path" ]] || { printf 'Backing path is not an ordinary local directory; refusing.\n' >&2; exit 1; }
    resolved=$(realpath -e -- "$path")
    case "$resolved" in
        "$STORAGE_ROOT"/*) ;;
        *) printf 'Resolved path is outside %s; refusing: %s\n' "$STORAGE_ROOT" "$resolved" >&2; exit 1 ;;
    esac
    printf 'Verified Bound PVC %s/%s -> PV %s -> %s\n' "$namespace" "$claim" "$pv" "$resolved"
    # Change only the verified volume root, never recursive or computed parent paths.
    chown --no-dereference "$uid:$uid" -- "$resolved"
    chmod "$mode" -- "$resolved"
    stat -c 'Ownership/mode: %u:%g %a %n' -- "$resolved"
    ls -ldZ -- "$resolved"
}
set_owner japan-price-basket release-store 101 0750
if [[ "$INCLUDE_ACME" == true ]]; then
    set_owner kube-system traefik-acme 65532 0700
fi
