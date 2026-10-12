#!/bin/sh
set -eu
. /usr/local/bin/release-common.sh
umask 022
validate_meta /opt/site/release-meta.json
match_expected
STORE=/srv/releases
[ -d "$STORE" ] && [ ! -L "$STORE" ] || fail 'mount the release PVC at /srv/releases'
# Provision PVC ownership once during bootstrap, never by a root application pod.
[ -w "$STORE" ] || fail 'UID/GID 101 must be able to write the staging PVC'
for directory in "$STORE/.blobs" "$STORE/app-releases" "$STORE/receipts"; do
    [ ! -L "$directory" ] || fail 'store directory must not be a symlink'
    mkdir -p "$directory"
done
LOCK="$STORE/.stage-lock"
mkdir "$LOCK" 2>/dev/null || fail 'another stage is running, or a stale lock needs operator investigation'
printf '%s\n' "$APP_RELEASE" > "$LOCK/app-release"
TEMP="$STORE/app-releases/.stage-$APP_RELEASE-$$"
TARGET="$STORE/app-releases/$APP_RELEASE"
RECEIPT="$STORE/receipts/$APP_RELEASE.json"
cleanup() {
    # Keep partial release files as evidence; remove only our private lock.
    rm -f "$INVENTORY" "$LOCK/app-release"
    rmdir "$LOCK" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
verify_inventory_files /opt/site yes
if [ -e "$TARGET" ] || [ -e "$RECEIPT" ]; then
    [ -d "$TARGET" ] && [ -f "$RECEIPT" ] || fail 'partial existing release: do not overwrite or invent a receipt'
    validate_receipt "$RECEIPT"
    assert_regular "$TARGET/release-meta.json"
    [ "$(hash_file "$TARGET/release-meta.json")" = "$META_HASH" ] || fail 'existing release metadata differs'
    verify_inventory_files "$TARGET" yes
    printf 'Already staged and verified: %s\n' "$APP_RELEASE"
    exit 0
fi
[ ! -e "$TEMP" ] || fail 'unexpected temporary directory already exists'
mkdir "$TEMP"
# Metadata itself is immutable and protected by the completion receipt.
printf '%s\t%s\t%s\n' "$META_HASH" "$(file_bytes "$META")" 'release-meta.json' >> "$INVENTORY"
while IFS="$(printf '\t')" read -r file_hash bytes path; do
    BLOB="$STORE/.blobs/$file_hash"
    if [ -e "$BLOB" ] || [ -L "$BLOB" ]; then
        assert_regular "$BLOB"
        [ "$(file_bytes "$BLOB")" = "$bytes" ] && [ "$(hash_file "$BLOB")" = "$file_hash" ] || fail 'existing content-addressed blob is corrupt'
    else
        BLOB_TEMP="$STORE/.blobs/.stage-$file_hash-$$"
        [ ! -e "$BLOB_TEMP" ] || fail 'temporary blob conflict'
        # Copy and checksum stream through disk; never load the archive into RAM.
        cp "/opt/site/$path" "$BLOB_TEMP"
        [ "$(file_bytes "$BLOB_TEMP")" = "$bytes" ] && [ "$(hash_file "$BLOB_TEMP")" = "$file_hash" ] || fail 'copied blob differs from prepared bytes'
        chmod 0444 "$BLOB_TEMP"
        mv "$BLOB_TEMP" "$BLOB"
    fi
    PARENT=${path%/*}
    [ "$PARENT" = "$path" ] || mkdir -p "$TEMP/$PARENT"
    ln "$BLOB" "$TEMP/$path"
done < "$INVENTORY"
# Add-only, same-filesystem rename publishes the complete immutable directory.
mv "$TEMP" "$TARGET"
RECEIPT_TEMP="$STORE/receipts/.stage-$APP_RELEASE-$$.json"
jq -n --arg app "$APP_RELEASE" --arg commit "$SOURCE_COMMIT" --arg dataset "$DATASET" \
  --arg image "$EXPECTED_IMAGE" --arg inventory "$INVENTORY_HASH" --arg metadata "$META_HASH" \
  --arg completed "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '{schemaVersion:1,appRelease:$app,sourceCommit:$commit,dataset:$dataset,image:$image,payloadInventorySha256:$inventory,metadataSha256:$metadata,completedAt:$completed}' > "$RECEIPT_TEMP"
chmod 0444 "$RECEIPT_TEMP"
mv "$RECEIPT_TEMP" "$RECEIPT"
printf 'Staged exact release: %s\n' "$APP_RELEASE"
