# Static container release contract

The Dockerfile packages an already-built static release. It does not run Node,
Python, Vite or a survey import on the serving host. The same image has a serving
mode and a disk-staging mode. Kubernetes uses containerd, so production does not
require a Docker daemon.

## Build order

Run `node scripts/wire-release-base.mjs`, format the changed App.tsx and commit
the reviewed source/configuration first. The helper is idempotent and changes
only the three reviewed data fetches. The default Vite base `/` still supports
normal development. A delivery build pins all requests to its source commit.

From a clean committed repository, in PowerShell:

```powershell
$SourceCommit = (git rev-parse HEAD).Trim()
$AppRelease = 'app-' + $SourceCommit
$NginxBase = (Get-Content ops/containers/base-image.lock.json -Raw | ConvertFrom-Json).image
node scripts/publish_snapshot.mjs
npm run check
npm exec -- vite build --base=/app-releases/$AppRelease/
node scripts/write_third_party_notices.mjs
node scripts/prepare-release.mjs
node --test tests/deployment/runtime-helpers.test.mjs
```

Run the project tests and production-browser checks for this exact artifact
before distributing it. `prepare-release.mjs` checks clean Git identity and
the built URL prefix, generates gzip files off the host, hashes every ordinary
payload file and creates `dist/release-meta.json`. It is not a substitute for
tests and cannot prove manually fabricated files came from Vite.

For an x86-64 Linux target:

```powershell
docker build --platform linux/amd64 --build-arg "NGINX_BASE=$NginxBase" --build-arg "SOURCE_COMMIT=$SourceCommit" --build-arg "APP_RELEASE=$AppRelease" --file ops/containers/Dockerfile --tag japan-price-basket:local .
docker run --detach --name japan-price-basket-local --read-only --cap-drop ALL --security-opt no-new-privileges --tmpfs /tmp:rw,noexec,nosuid,size=64m --publish 127.0.0.1:8080:8080 --stop-timeout 35 japan-price-basket:local
docker logs japan-price-basket-local
curl.exe --fail http://127.0.0.1:8080/readyz
curl.exe --fail http://127.0.0.1:8080/release.json
```

Use `linux/arm64` instead if `uname -m` on the target is `aarch64`. The verified
base lock records both architectures. Replacing a base requires reviewing its
maintainer, registry digest, architecture, scan and resulting application tests.
The base is pinned, while the added Alpine jq package is resolved at build time;
the final application image digest and SBOM identify the actual result.

## Runtime modes

| Command | Use | Writable mounts |
| --- | --- | --- |
| `serve` | Default local test, verified files from this image | `/tmp` |
| `serve`, `SERVE_MODE=production` | Serve root HTML from this image and retained immutable files from the PVC | `/tmp`; `/srv/releases` read-only |
| `stage` | Verify and atomically add this exact release to shared storage | `/tmp`; `/srv/releases` read-write |

Production serving and staging require all three environment variables:

- `EXPECTED_APP_RELEASE`: `app-` followed by the full 40-character source commit.
- `EXPECTED_DATASET`: the reviewed `rps-YYYY-MM-<12 hex>` identifier.
- `EXPECTED_IMAGE`: the published `ghcr.io/...@sha256:<64 hex>` image digest.

An image cannot embed its own final digest. Deployment configuration supplies
that digest, and the completion receipt and `/release.json` retain it. Verify
the Pod image/imageID independently; a matching environment value alone does
not prove which image the runtime pulled.

## Shared storage and compatibility

Staging validates metadata, bounded safe paths, byte sizes and SHA-256 hashes.
It takes a directory lock, streams ordinary files into content-addressed blobs,
hardlinks those bytes into a temporary release directory, renames the complete
directory into place and publishes the exact completion receipt last. Metadata
is also hashed. Identical bytes are shared across releases. Partial state,
corruption, a different image for an existing application release or a stale
lock is rejected. Nothing fetches upstream prices or overwrites old releases.

The layout is:

```text
/srv/releases/
  .blobs/<SHA-256>
  app-releases/app-<commit>/index.html
  app-releases/app-<commit>/assets/...
  app-releases/app-<commit>/data/current.json
  app-releases/app-<commit>/data/<dataset>/manifest.json
  app-releases/app-<commit>/data/<dataset>/cities/...
  app-releases/app-<commit>/release-meta.json
  receipts/app-<commit>.json
```

Both old and new web Pods serve all retained `/app-releases/` paths. An old tab
therefore keeps its old JavaScript and compatible data when it selects another
city. Root HTML belongs to the currently serving image. The readiness check
requires the exact receipt, metadata and retained file sizes for that image;
staging already checked full hashes. Public metadata does not contain secrets.

`/livez` tests the Nginx process. `/readyz` is created only after release checks
pass. `/release.json` reports source, app, dataset, policy, cutoff and expected
image. Missing assets and JSON return 404; `/data/current.json` at the origin
root deliberately returns 404 so an unpinned browser request is exposed. HTML
revalidates, successful immutable paths cache, failures do not cache as immutable,
and gzip negotiation retains the uncompressed bytes for browser SHA checks.

Do not delete locks or partial directories by guessing. First stop promotions,
inspect the staging Job, prove no process still holds the operation and identify
the specific partial state. Restore from retained evidence or use a new reviewed
source commit. An interrupted directory publication without a receipt does not
authorize serving. Release pruning is deliberately not automated by this kit;
protect current/previous releases, the retention window and any rollback target,
and account for shared hardlinks before deleting blobs.

## Verification limits

`node --test tests/deployment/runtime-helpers.test.mjs` validates release pinning,
dirty-tree refusal, pointer traversal, inventory identity and wiring idempotence
using explicitly synthetic non-price bytes. The separate
`tests/deployment/stage-release.test.mjs` exercises disk staging when bash and jq
are available; Windows needs approved tool paths. These tests do not demonstrate
Nginx, Docker, Kubernetes, HTTPS or service continuity. Run the supplied container,
Kubernetes and old-tab acceptance checks before production acceptance.
