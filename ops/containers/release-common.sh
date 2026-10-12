#!/bin/sh
# Shared, bounded release validation. No Kubernetes API token is needed.
set -eu
fail() { printf 'release error: %s\n' "$*" >&2; exit 1; }
hash_file() { sha256sum "$1" | cut -d ' ' -f 1; }
file_bytes() { stat -c '%s' "$1"; }
assert_regular() {
    [ ! -L "$1" ] && [ -f "$1" ] || fail "not an ordinary file: $1"
}
validate_meta() {
    META="$1"
    assert_regular "$META"
    [ "$(file_bytes "$META")" -le 8388608 ] || fail 'metadata exceeds 8 MiB'
    jq -e '
      .schemaVersion == 1 and
      (.sourceCommit | type == "string" and test("^[a-f0-9]{40}$")) and
      .appRelease == ("app-" + .sourceCommit) and
      (.dataset | type == "string" and test("^rps-20[0-9]{2}-(0[1-9]|1[0-2])-[a-f0-9]{12}$")) and
      (.policyVersion | type == "string" and test("^[0-9]+\\.[0-9]+$")) and
      (.sourceCutoff | type == "string" and test("^20[0-9]{2}-(0[1-9]|1[0-2])$")) and
      (.payloadInventorySha256 | type == "string" and test("^[a-f0-9]{64}$")) and
      (.files | type == "array" and length >= 3 and length <= 10000) and
      all(.files[];
        (.path | type == "string" and length <= 240 and test("^[A-Za-z0-9][A-Za-z0-9._-]*(/[A-Za-z0-9][A-Za-z0-9._-]*)*$") and
          (split("/") | all(. != "." and . != ".."))) and
        .path != "release-meta.json" and
        (.sha256 | type == "string" and test("^[a-f0-9]{64}$")) and
        (.bytes | type == "number" and . == floor and . >= 0 and . <= 134217728)) and
      ([.files[].path] | length == (unique | length)) and
      ([.files[].bytes] | add <= 4294967296) and
      any(.files[]; .path == "index.html") and
      any(.files[]; .path == "data/current.json") and
      any(.files[]; .path == "THIRD_PARTY_NOTICES.txt")
    ' "$META" >/dev/null || fail 'invalid release metadata or inventory'
    APP_RELEASE=$(jq -r '.appRelease' "$META")
    DATASET=$(jq -r '.dataset' "$META")
    SOURCE_COMMIT=$(jq -r '.sourceCommit' "$META")
    INVENTORY_HASH=$(jq -r '.payloadInventorySha256' "$META")
    META_HASH=$(hash_file "$META")
    INVENTORY=/tmp/release-inventory.$$.tsv
    jq -r '.files[] | [.sha256, (.bytes | tostring), .path] | @tsv' "$META" > "$INVENTORY"
    [ "$(hash_file "$INVENTORY")" = "$INVENTORY_HASH" ] || fail 'inventory digest differs from metadata'
}
match_expected() {
    : "${EXPECTED_APP_RELEASE:?Set EXPECTED_APP_RELEASE}"
    : "${EXPECTED_DATASET:?Set EXPECTED_DATASET}"
    : "${EXPECTED_IMAGE:?Set EXPECTED_IMAGE to an immutable image reference}"
    [ "$APP_RELEASE" = "$EXPECTED_APP_RELEASE" ] || fail 'application release does not match expected release'
    [ "$DATASET" = "$EXPECTED_DATASET" ] || fail 'dataset does not match expected dataset'
    printf '%s\n' "$EXPECTED_IMAGE" | grep -Eq '^[a-z0-9][a-z0-9./_-]+@sha256:[a-f0-9]{64}$' || fail 'expected image must be an immutable registry digest'
}
validate_receipt() {
    RECEIPT="$1"
    assert_regular "$RECEIPT"
    [ "$(file_bytes "$RECEIPT")" -le 65536 ] || fail 'receipt exceeds 64 KiB'
    jq -e --arg app "$APP_RELEASE" --arg dataset "$DATASET" --arg image "$EXPECTED_IMAGE" \
      --arg inventory "$INVENTORY_HASH" --arg metadata "$META_HASH" --arg commit "$SOURCE_COMMIT" '
      .schemaVersion == 1 and .appRelease == $app and .sourceCommit == $commit and
      .dataset == $dataset and .image == $image and
      .payloadInventorySha256 == $inventory and .metadataSha256 == $metadata
    ' "$RECEIPT" >/dev/null || fail 'exact-release completion receipt does not match'
}
assert_no_symlinks() {
    [ -d "$1" ] && [ ! -L "$1" ] || fail "unsafe directory: $1"
    [ -z "$(find "$1" -type l -print -quit)" ] || fail "symlink found inside $1"
    [ -z "$(find "$1" ! -type d ! -type f -print -quit)" ] || fail "special file found inside $1"
}
verify_inventory_files() {
    DIRECTORY="$1"
    FULL_HASH="$2"
    assert_no_symlinks "$DIRECTORY"
    while IFS="$(printf '\t')" read -r file_hash bytes path; do
        assert_regular "$DIRECTORY/$path"
        [ "$(file_bytes "$DIRECTORY/$path")" = "$bytes" ] || fail "size mismatch: $path"
        if [ "$FULL_HASH" = yes ]; then
            [ "$(hash_file "$DIRECTORY/$path")" = "$file_hash" ] || fail "hash mismatch: $path"
        fi
    done < "$INVENTORY"
}
