# Development

Japan Price Basket builds a static React and TypeScript website from a reviewed
data fixture. Calculations run in the browser; saved selections use localStorage.
Local builds and routine tests do not need e-Stat credentials or an application
server.

## Requirements

- Node.js 24.22.1, pinned in `.nvmrc`, and npm.
- Python 3.12, pinned in `.python-version`, for ingestion checks and data tools.
- Several GB of available RAM for publication and testing. The approved archive
  expands to about 1.21 GB, and publication creates separate files for each city.

Build and process data on a development machine or CI runner. A production web
server serves the generated files without running Node.js or Python.

## Install and preview

Run these commands from the repository root:

```sh
node --version # must match .nvmrc
npm ci
npm run build
npm run preview -- --port 4173 --strictPort
```

Open [the local website](http://127.0.0.1:4173/). The build publishes the approved
fixture, checks TypeScript, compiles the application and writes runtime license
notices into `dist/`.

For application development with hot reload, first publish the data:

```sh
node scripts/publish_snapshot.mjs
npm run dev
```

Vite reports the development URL in the terminal. Re-run publication after an
approved fixture changes; hot reload does not import upstream survey data.

## Verification

Install Python dependencies in a virtual environment:

```sh
python -m venv .venv
```

Activate it with `source .venv/bin/activate` on Linux or macOS, or
`.venv\Scripts\Activate.ps1` in PowerShell. Then run:

```sh
python -m pip install -r requirements-import.txt
python scripts/check_repository.py
python scripts/build_staple_price_test.py
git diff --exit-code -- demo/staple-price-test.html demo/staple-price-test.json
python -m unittest discover -s tests -p 'test_*.py'
```

The reference demonstration must rebuild without an unexplained diff. Python
tests cover workbook parsing, geography, review boundaries and refresh safeguards.

Check application formatting, types and calculation contracts:

```sh
npm run format:check
npm run check
npm test
```

Browser tests run against the production build, so build before launching them.
On Linux, install the browser binaries and their system dependencies with:

```sh
npm run build
npm exec -- playwright install --with-deps chromium firefox webkit
npm run test:e2e
```

The system-dependency installation may require administrator privileges. On
Windows or macOS, install browser binaries with
`npm exec -- playwright install chromium firefox webkit`.

Playwright starts the preview server on port 4173. Outside CI it may reuse a
server already running there; stop an outdated preview before testing a new
build. Chromium runs the desktop and mobile suites. Firefox and WebKit run the
focused source, search, persistence and result-detail suites. Mobile emulation
does not replace testing on physical devices. Failed runs retain browser traces
in `test-results/`.

The [repository workflow](../.github/workflows/repository.yml) runs these checks
using the committed fixture and evidence, without fetching current survey prices.
Use focused tests during development and the full applicable checks before
release. `npm run format` formats authored application and test files.

## Repository layout

| Location                | Purpose                                                             |
| ----------------------- | ------------------------------------------------------------------- |
| `apps/web`              | React interface, translations, charts and browser persistence       |
| `packages/domain`       | Data contracts, quantity conversion and basket calculations         |
| `scripts`               | Acquisition, review, publication, packaging and validation tools    |
| `data/*.json`           | Reviewed catalog, continuity and geography decisions                |
| `data/fixtures`         | Approved compressed dataset and its manifest                        |
| `data/audit/2026-10-05` | Fixed source evidence used by offline checks                        |
| `demo`                  | Reproducible endpoint comparison example                            |
| `tests`                 | Domain, ingestion, storage and browser tests                        |
| `ops`                   | Web-server configuration                                            |
| `docs`                  | Architecture, methodology, development and operations documentation |

`data/raw/`, `data/staging/`, `data/releases/`, `apps/web/public/data/`, `dist/`
and local test reports are generated or operator-managed files and are ignored.
Use `.local/` for working notes and local tooling. Read [DATA.md](DATA.md) before
acquiring or approving data. Editing the approved fixture directly bypasses review
and can invalidate its manifest hashes.

## Release artifacts

After reviewing and committing the source, build and verify the website, then
package it from a clean working tree:

```sh
npm run build
python scripts/package_static_artifact.py
```

The packaging command writes a ZIP and a manifest containing the source commit,
dataset ID, policy version, cutoff and file hashes under `data/releases/`. It
refuses to package an uncommitted working tree. Retain runtime license notices
and verify the artifact before delivery. See [OPERATIONS.md](OPERATIONS.md) for
hosting, immutable releases and rollback.
