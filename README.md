# Japan Price Basket

Explore how the cost of a fixed grocery basket changes across Japanese cities
and over time. Japan Price Basket combines official monthly survey prices with
bilingual product search, editable quantities and interactive charts.

## Features

- English and Japanese interfaces, product names and search aliases.
- City selection, monthly date controls and an editable 16-food staples basket,
  including rice, bread, eggs, meat and vegetables.
- Basket costs, product histories, item breakdowns and price indices, with
  equivalent tables.
- Explicit observed and estimated states, dated quantity conversions and an
  observed-only comparison option.
- Local basket persistence without accounts, cookies or analytics.

The bundled dataset covers **January 2000–August 2026**, with all 81 currently
published city scopes and separate historical geographies. Individual products
have different periods of usable coverage; search checks compatibility with the
selected city, dates and estimate mode. The included month is the latest reviewed
observation in this snapshot, rather than today's supermarket price.

Results measure nominal costs for selected fixed quantities. They are not the
official Consumer Price Index or a complete household food budget. See
[Data and methodology](docs/DATA.md) for sources, estimates and limitations.

## Run locally

Use Node **24.15.0**, recorded in `.nvmrc`:

```sh
npm ci
npm run build
npm run preview -- --port 4173 --strictPort
```

Open [localhost:4173](http://127.0.0.1:4173/). A clean checkout builds from the
approved compressed snapshot without an e-Stat account or API credential. Data
publication needs several GB of available RAM; the public host serves only the
generated files. For development and browser-test setup, see
[Development](docs/DEVELOPMENT.md).

## Architecture

The application is React and TypeScript, built with Vite. Framework-independent
schemas and decimal calculations live in `packages/domain`. Python tooling
acquires and reconciles official source files; a Node publisher verifies the
approved snapshot and produces versioned manifests and per-city data files.

Visitors load only their selected city's data and calculate results in the
browser. Upstream acquisition and review happen separately from web requests.
The deployed application requires no database, application API or source secret.

| Path               | Contents                                                               |
| ------------------ | ---------------------------------------------------------------------- |
| `apps/web/`        | Bilingual interface, charts and browser persistence.                   |
| `packages/domain/` | Data contracts, eligibility, quantities and calculations.              |
| `scripts/`         | Source acquisition, reconciliation, publication and packaging.         |
| `data/`            | Review mappings, a bounded approved snapshot and fixed audit evidence. |
| `tests/`           | Domain, ingestion, integrity and browser-flow tests.                   |
| `ops/`             | Container runtime, Kubernetes rendering and pinned Flux installation. |

Raw archives, generated releases, build output and local working notes are
excluded from version control. The original endpoint demonstration remains in
`demo/` as a separate source-format reference.

## Documentation

- [Data and methodology](docs/DATA.md): survey coverage, continuity, quantities,
  estimates and default-basket evidence.
- [Architecture](docs/ARCHITECTURE.md): system boundaries, publication, validation
  and browser behavior.
- [Development](docs/DEVELOPMENT.md): environment setup, reproducible builds and
  verification commands.
- [Operations](docs/OPERATIONS.md): artifact packaging, serving requirements,
  historical corrections and immutable container delivery.
- [Contributing](CONTRIBUTING.md): review and repository conventions.

GitHub Actions checks ingestion, formatting, calculations, builds and browser
flows. The delivery workflow packages and tests a static Nginx image for GHCR.
K3s uses containerd; minimal Flux reconciles reviewed release configuration.
Image publication and production promotion are separate. Automated acquisition
remains separate from reviewed data publication.

## License and attribution

Application code and documentation use the [MIT license](LICENSE). Government
data and third-party dependencies retain their own terms and notices. See
[Data attribution](DATA_ATTRIBUTION.md); builds include `THIRD_PARTY_NOTICES.txt`.
