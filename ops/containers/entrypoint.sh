#!/bin/sh
set -eu
case "${1:-serve}" in
    stage) exec /usr/local/bin/stage-release.sh ;;
    serve-production) SERVE_MODE=production ;;
    serve) ;;
    *) exec "$@" ;;
esac
. /usr/local/bin/release-common.sh
rm -f /tmp/ready
link_release_root() {
    if [ -L /tmp/release-root ]; then
        [ "$(readlink /tmp/release-root)" = "$1" ] || fail 'temporary release alias points elsewhere'
    else
        [ ! -e /tmp/release-root ] || fail 'temporary release alias is not a symlink'
        ln -s "$1" /tmp/release-root
    fi
}
validate_meta /opt/site/release-meta.json
trap 'rm -f "$INVENTORY"' EXIT
if [ "${SERVE_MODE:-local}" = production ]; then
    match_expected
    validate_receipt "/srv/releases/receipts/$APP_RELEASE.json"
    TARGET="/srv/releases/app-releases/$APP_RELEASE"
    assert_regular "$TARGET/release-meta.json"
    [ "$(hash_file "$TARGET/release-meta.json")" = "$META_HASH" ] || fail 'staged metadata differs from this image'
    # Hashes were verified by staging. Startup checks retained file sizes and type.
    verify_inventory_files "$TARGET" no
    link_release_root /srv/releases/app-releases
    IMAGE="$EXPECTED_IMAGE"
elif [ "${SERVE_MODE:-local}" = local ]; then
    verify_inventory_files /opt/site yes
    link_release_root /opt/app-releases
    IMAGE=local-unpublished
else
    fail 'SERVE_MODE must be local or production'
fi
jq --arg image "$IMAGE" '{schemaVersion,sourceCommit,appRelease,dataset,policyVersion,sourceCutoff,payloadInventorySha256} + {image:$image}' "$META" > /tmp/release.json
printf 'ready\n' > /tmp/ready
rm -f "$INVENTORY"
trap - EXIT
# Nginx becomes PID 1, so the image SIGQUIT stop signal reaches its master.
exec nginx -g 'daemon off;'
