# Operations

The website is delivered as static files. Node and Python are build and data
tools; neither runs on the public serving host. `ops/containers/` supplies the
non-root Nginx runtime; `scripts/render_deployment.py` generates Kubernetes
configuration from reviewed release metadata. `ops/flux/` supplies a pinned
two-controller installation. Infrastructure installation and production
acceptance are operator actions, separate from supplying these files.

## Build, verify and package

Use the Node and Python versions recorded in `.nvmrc` and `.python-version`,
with locked dependencies. See [Development](DEVELOPMENT.md) for environment
setup and the complete contribution checks.

```sh
npm ci
npm run format:check
npm test
npm run build
npm run test:e2e
python scripts/package_static_artifact.py
```

The build publishes approved data, checks TypeScript, builds with Vite and
generates `dist/THIRD_PARTY_NOTICES.txt`. It does not acquire new survey data.
Run ingestion checks when changing source handling or review mappings.
Install the configured Playwright browsers before the first browser test run.

Packaging requires a clean Git commit and an existing tested `dist/`. It writes
an ignored ZIP and companion manifest under `data/releases/`, recording the
source commit, dataset, policy, included observation cutoff, per-file hashes
and ZIP hash. Packaging does not itself rebuild or test the directory. Verify
that its contents came from the intended commit before distributing it.

For local inspection:

```sh
npm run preview -- --port 4173 --strictPort
```

Vite preview is a verification tool, not the production server. Ordinary local
builds serve `dist/` at the origin root. Container delivery instead builds Vite
with `/japan-basket/app-releases/app-<fullSourceCommit>/` as its base and records the exact
tested payload using `scripts/prepare-release.mjs`. Do not rebuild after testing
and call the result the same artifact. Retain runtime license notices and data
attribution with every distributed artifact.

## Static serving contract

| Resource                              | Required behavior                                                                                         |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Entry HTML and release status         | Revalidate; do not cache as immutable.                                                                    |
| Immutable app-release assets and data | Correct MIME types and immutable caching only when published bytes cannot change.                         |
| JSON, JavaScript and CSS              | Gzip where negotiated, with `Vary: Accept-Encoding`; support clients that request uncompressed responses. |
| Missing assets or JSON                | Real 404 response, never an HTML fallback.                                                                |
| City data                             | Exact manifest bytes so browser SHA-256 checks succeed.                                                   |
| Public origin                         | HTTPS, with verified certificate renewal and appropriately scoped access.                                 |

The application uses anchor navigation and needs no client-router fallback.
Production entry HTML is served at `/japan-basket/`, with release status at
`/japan-basket/release.json`. Immutable assets and city data stay within
`/japan-basket/app-releases/`. The exact-host ingress routes only the
`/japan-basket` path prefix, preserving `/` for another service. No root route is
created for the basket; an unassigned root returns the ingress controller's 404.
`/japan-basket` redirects to its trailing-slash form. Liveness and readiness
remain internal `/livez` and `/readyz` endpoints.
`ops/nginx-static.conf.example` illustrates routes and cache behavior; it is not
a complete TLS or security configuration. Nginx location-level `add_header`
directives replace inherited ones: repeat the selected security headers or use
a shared include. Do not add source credentials, tracking or cookie-setting
middleware to the serving layer.

## Container and orchestration

Build and test a non-root static Nginx OCI image on a runner. Record its source
commit, dataset, policy, observation cutoff, payload hashes and base/image
digests; publish provenance, an SBOM and scan results alongside the image. A
deployment references an immutable digest, not a mutable `latest` tag.

The Nginx 1.30.6 base is digest-pinned in `ops/containers/base-image.lock.json`.
It uses the `nginx/nginx-unprivileged` Docker Hub namespace selected by the
[upstream project](https://github.com/nginx/docker-nginx-unprivileged) for this
release. Nginx 1.30.6 includes the
[October 2026 security fixes](https://nginx.org/en/security_advisories.html).
The container removes inherited `curl` and `libcurl`, which serving and staging
do not use, and fails its build if either remains after package installation.
CI HTTP smoke checks use the runner's curl.
The Dockerfile requires patched Alpine package floors: zlib `1.3.2-r1`
(CVE-2026-85091), libexpat `2.9.0-r0` (CVE-2026-77214), and libx11
`1.8.14-r0` (CVE-2026-88806), and libxpm `3.5.20-r0` (CVE-2026-94287).
These constraints replace older inherited
packages and fail the build if the configured repositories cannot supply them.
Rebuild, test and scan the resulting image after any base or package change;
the high/critical vulnerability gate still applies to the whole final image.

K3s runs images through bundled containerd; a production Docker daemon is not
needed. The selected design uses two web replicas, bundled ingress, persistent
release storage and only Flux source-controller and kustomize-controller.
K3s demonstrates Kubernetes delivery and recovery; the static application does
not intrinsically require a cluster. Capacity must be measured during image
pull, staging, rollout and rollback, including terminating pods and disk
retention. Keep builds and the large source archive off the serving host.

On small AlmaLinux hosts, check usable memory and the crash-kernel reservation
before sizing the workload:

```sh
free -m
cat /sys/kernel/kexec_crash_size
cat /proc/cmdline
systemctl is-enabled kdump
```

Reserved crash-kernel memory is unavailable to normal workloads. Reclaiming it
disables kernel crash-dump capture and requires a deliberate diagnostic tradeoff,
saved original settings, reboot verification and a check after kernel updates.
Keep that host-policy record off-host; the cluster backup does not archive the
bootloader or kdump configuration. Repeat full-stack capacity measurements after
any change, preserving the 20% available-memory gate and SELinux enforcement.

Preserve SELinux enforcement on compatible hosts and expose only public HTTP(S)
and restricted administration access. Keep Kubernetes APIs private. Application
and staging workloads require non-root execution, dropped capabilities, no
privilege escalation, no unnecessary API-token mount and bounded resources.
Use restricted Pod Security Admission and namespace-scoped reconciliation RBAC;
bootstrap security policy and storage separately from application promotion.

## Compatible application updates

1. Pin each frontend release to its compatible immutable dataset manifest.
2. Stage the desired image's prepared assets and data into shared persistent
   storage. Validate hashes and atomically publish add-only paths; reject any
   existing path containing different bytes.
3. Serve retained paths read-only from every old and new web pod. Activate new
   HTML only after staging that exact release succeeds.
4. Use readiness and startup checks that verify the desired release, graceful
   shutdown, `maxUnavailable: 0`, `maxSurge: 1` and a rollout deadline.
5. Retain old assets and datasets for at least 90 days and at least the current
   and previous deployable release. Bounded garbage collection must exclude
   active and rollback targets; after retention expires old tabs may need refresh.

Prove this protocol with continuous requests during successful and failed
rollouts, old-tab city switching, fresh visits and rollback. Record sample size,
duration and failures. Two replicas cannot protect against a single host's
failure, reboot, ingress interruption or cluster maintenance.

## CI/CD and rollback

The `delivery.yml` GitHub Actions workflow validates source, data contracts and
browser behavior, hands off the tested static artifact, and tests/scans/publishes
the same image. It emits `candidate.json` with source, app, dataset and immutable
image identities. Image publication and production promotion are separate. Keep public PR jobs read-only and free of production credentials;
pin external actions and grant package-write permission only to trusted image
publication. Verify anonymous pulls if using public GHCR.

Promote tested image digests through reviewed manifest changes.
`scripts/copy-deployment-release.mjs` preserves add-only release directories and
updates the reviewed selector. Flux pulls protected public configuration and
impersonates namespace-scoped application service accounts. Its trusted
controller infrastructure retains the upstream cluster-admin installation role. Exact-release staging and
web reconciliation need separate dependencies and health checks; readiness of
an earlier staging Job must not authorize a newer release. Serialize promotions
and verify the expected application/dataset metadata over public HTTPS after
deployment. An image push or merged PR does not establish delivery success.

Failed readiness must leave ready old pods serving. Rollback is explicit: suspend
reconciliation if necessary, restore a retained release/digest in configuration,
reconcile and repeat smoke checks. Back up manifests, release bytes, cluster
state and TLS state outside the host; test restoration and keep credentials out
of source control. [K3s backup](https://docs.k3s.io/datastore/backup-restore)
documents datastore-specific procedures.

The complete deployment configuration is generated for each candidate; never
copy an example digest into production. Bootstrap namespace policy, storage
ownership and TLS separately. Two web replicas use `maxUnavailable: 0` and
`maxSurge: 1`; startup and readiness validate the desired staged receipt.
`scripts/verify-live-release.mjs` checks serving identity and actual data bytes.
`scripts/measure-requests.mjs` records bounded update/rollback request evidence.

`scripts/backup-k3s-host.sh` performs planned-maintenance SQLite/local-volume
backup, refusing staging writers and preserving original replica counts.
Encrypt and retain its private archive off-host. `scripts/restore-k3s-host.sh`
uses the accompanying archive validator and supports a fresh replacement host
only, preserving the recorded node identity and leaving Flux paused for initial
acceptance. These helpers do not establish a tested restore on their own.

## Manual historical correction review

Correction audits require the retained accepted native staging archive
`data/staging/food-history-complete.json`, its matching
`food-history-complete.sources.json` manifest and original cached evidence under
`data/raw/recent/`. These operator files are excluded from Git. A clean checkout
can build the approved fixture without them, but cannot audit corrections.
Preserve the accepted baseline, prior fixture, mappings and release artifact.

Refresh a window of at most 24 months using a **new** output directory. The dates
below are an example within the reviewed archive, not a rolling date command:

```sh
python scripts/refresh_historical_prices.py refresh --refresh --manifest data/staging/food-history-complete.sources.json --start 2024-09 --end 2026-08 --output data/staging/correction-review-001
```

This refreshes known official URLs rather than discovering new reports. It first
verifies and reparses retained evidence, then downloads each distinct URL once.
Immutable content and receipt histories preserve old and new hashes. Failed or
oversized downloads leave the previous receipt/evidence intact. A later failure
can leave successful downloads in the cache, but does not replace the accepted
baseline, fixture or hosted release.

The bundle contains `before.json`, unapproved `candidate.json` and `report.json`.
Inspect source and parser hashes, definitions, native units, geographic scopes,
missing symbols, locators and prices against the original workbooks. Revisions
of at least 30% are flagged for attention; they are not automatically removed.
Changed quote units require explicit review instead of a misleading percentage.
Zero changed native months normally means retaining the receipt and keeping the
published dataset. Source-byte changes still require inspection. Unknown formats,
duplicate rows or missing provenance must fail closed.

After inspecting the report, combine into a separate unapproved full archive:

```sh
python scripts/refresh_historical_prices.py combine --baseline data/staging/food-history-complete.json --candidate data/staging/correction-review-001/candidate.json --report data/staging/correction-review-001/report.json --output data/staging/food-history-candidate.json
python scripts/build_food_expansion_review.py --staging data/staging/food-history-candidate.json --check
python scripts/build_remaining_food_review.py --staging data/staging/food-history-candidate.json --check
python scripts/build_retired_food_review.py --staging data/staging/food-history-candidate.json --check
python scripts/review_recent_prices.py --staging data/staging/food-history-candidate.json --expansion data/food-expansion-review.json --expansion data/remaining-food-review.json --expansion data/retired-food-review.json
```

Combine validates candidate hashes and before/after fingerprints, replaces only
changed months and preserves the original baseline. Its companion
`food-history-candidate.sources.json` remains unapproved; retain it for subsequent
audits if accepted. The review commands check committed mappings and produce a
review report without exporting an approved fixture. Legitimate mapping changes
need dated evidence and explicit review; a successful parse is not approval.

Record the reviewer, correction reason and report reference. After approval,
rerun the same normalization command with `--export-reviewed`, reconcile native
cells using `python scripts/verify_archive_cells.py`, run the contribution checks,
build and inspect both languages. Preserve the former fixture and correction
bundle. Commit the reviewed mappings and bounded approved build input, then
package the clean commit. Do not commit raw caches or full staging archives.

## New observations and automation

`python scripts/import_recent_prices.py --start YYYY-MM --end YYYY-MM --refresh`
rechecks the original pilot acquisition, which selects only 20 source codes.
It must not be presented as a full-catalog update command. Full-catalog native
staging uses `scripts/stage_food_history.py` plus its supplementary acquisition
and merge adapters.

A new complete month needs discovery of official price/specification sources,
roster and definition review, an extended approved window and a new source
manifest. Existing review generators reject dates beyond their audited cutoff.
Known-URL refresh cannot discover a source moved to a new table or URL.
Automation must preserve receipts, quarantine unexpected revisions and retain
reviewed promotion. Source retrieval, observation cutoff, review approval and
web deployment are different events. See [Data](DATA.md) for interpretation.
