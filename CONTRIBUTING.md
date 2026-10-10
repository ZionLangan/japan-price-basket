# Contributing

Keep changes focused, reproducible and supported by evidence. Start with the
[development guide](docs/DEVELOPMENT.md) for setup and verification, and the
[architecture](docs/ARCHITECTURE.md) for component boundaries.

## Changes and review

Create a short-lived branch from `main` and submit a pull request describing the
problem, resulting behavior and relevant checks. Use clear commit messages such
as `fix: preserve basket dates after reload` or `data: review revised rice units`.
Keep unrelated dependency updates, formatting and data changes separate.

Before committing, inspect the staged diff and check whitespace:

```sh
git diff --staged
git diff --cached --check
```

Pull requests must pass the applicable repository checks. Add regression tests
for changes to calculations, ingestion, persistence and user flows. UI changes
need English and Japanese checks, narrow-screen reflow and keyboard operation.
Documentation changes need accurate commands and working links, without an
unrelated full browser run.

## Source and dependencies

Use UTF-8 without a BOM and LF line endings for authored text. Follow
`.editorconfig` and `.gitattributes`: two-space indentation for TypeScript and
JSON, four spaces for Python. Preserve downloaded evidence bytes rather than
reformatting them.

Use the runtimes pinned in `.nvmrc` and `.python-version`, install JavaScript
dependencies with `npm ci`, and commit the lockfile with intentional dependency
changes. Review new dependencies for maintenance, licensing and bundle cost.
Pin GitHub Actions to verified full commit hashes and keep routine validation
permissions read-only. Do not require upstream API or deployment credentials
for tests or builds.

## Data changes

Follow the [data methodology](docs/DATA.md) and
[machine-readable policy](docs/data_policy.json). Preserve stable product IDs,
city identities, native prices, units, definitions, dates and source locators.
Keep actual observations distinct from derived estimates. Never invent prices,
substitute another city or silently connect an unresolved definition break.

Each data change must include source evidence, effective dates, quantity and
continuity decisions, and its effect on coverage. Fix parsing or review mappings
instead of editing raw evidence. Synthetic test data must be clearly labeled and
must not appear as public observations.

The committed approved fixture and fixed audit evidence support reproducible
offline checks. Bulk downloads, staging files and release payloads belong outside
ordinary commits. Preserve the `demo` endpoint example as a reference; it is not
a complete monthly archive.

## Releases and repository hygiene

Do not commit credentials, environment files, kubeconfigs, access logs, local
working notes or generated build output. Keep temporary plans and environment
details in ignored `.local/` files. Review explicit paths when staging changes;
ignore rules do not remove files that are already tracked.

Application code is [MIT licensed](LICENSE). Government data and third-party
dependencies retain their own [attribution and reuse terms](DATA_ATTRIBUTION.md).
Distributions must include the generated `THIRD_PARTY_NOTICES.txt`.

Record each release's source commit, dataset ID, policy version and data cutoff.
Deploy the tested immutable artifact and retain a previous release for rollback.
Follow [operations](docs/OPERATIONS.md) for delivery, capacity and continuity
requirements. Update durable documentation when behavior or operational
requirements change.
