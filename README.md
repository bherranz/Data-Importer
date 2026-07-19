# Data Importer - Emissions Data Ingestion & Query System

A CSV import pipeline and a read-optimized query API over historical greenhouse gas emissions
data (Climate Watch / CAIT format).

- **import-service** (NestJS + Prisma + TypeScript, port 3000) - accepts a CSV upload, validates
  and pivots it into per-year records, stores it, computes aggregates.
- **query-service** (Python + FastAPI + SQLAlchemy, port 8000) - filter, sort, and paginate the
  imported data; fast reads, no writes.

Design rationale, trade-offs, and the data quality issues found in the real dataset are written
up in [docs/architecture.md](docs/architecture.md). Full endpoint reference with curl examples
is in [docs/api.md](docs/api.md). Measured throughput/query numbers are in
[docs/performance.md](docs/performance.md).

## Quickstart

Requires Docker and Docker Compose.

```bash
cp .env.example .env
docker compose up --build
```

This starts Postgres, applies the database schema (via a one-shot `migrate` service), then
starts both APIs:

- import-service: http://localhost:3000 (Swagger UI at `/docs`)
- query-service: http://localhost:8000 (Swagger UI at `/docs`)

Load the dataset:

```bash
curl -X POST -F "file=@data/emissions.csv" http://localhost:3000/imports
```

Takes about 45 seconds for the full file (~400K records after pivoting; see
[docs/performance.md](docs/performance.md)). Then query it:

```bash
curl "http://localhost:8000/emissions?country=ESP&sort_by=year&order=desc&page_size=10"
```

## Environment variables

Copy `.env.example` to `.env` at the repo root; docker-compose reads from it. Each service also
has its own `.env.example` for running outside Docker.

| Variable | Used by | Default | Purpose |
|---|---|---|---|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | db | `importer` / `importer` / `emissions` | Postgres credentials |
| `DATABASE_URL` | import-service, migrate | `postgresql://importer:importer@db:5432/emissions?schema=public` | Prisma connection string |
| `IMPORT_SERVICE_PORT` | import-service | `3000` | HTTP port |
| `MAX_UPLOAD_SIZE_BYTES` | import-service | `52428800` (50MB) | Multer upload size limit |
| `IMPORT_BATCH_SIZE` | import-service | `1000` | Rows per `createMany` batch during ingest |
| `QUERY_SERVICE_PORT` | query-service | `8000` | HTTP port |
| `QUERY_RATE_LIMIT` | query-service | `60/minute` | Rate limit for `/emissions`, per client IP |

## Running tests

```bash
# import-service: unit tests (no DB) + e2e tests (needs Postgres)
cd services/import-service
npm install
npm test
docker compose up -d db
npx prisma migrate deploy
npm run test:e2e

# query-service: unit tests (no DB) + integration tests (needs Postgres, same schema)
cd services/query-service
python -m venv .venv && .venv/Scripts/activate  # or source .venv/bin/activate on Linux/Mac
pip install -r requirements-dev.txt
pytest
```

Both suites also run in CI (`.github/workflows/ci.yml`) on every push/PR, against a fresh
Postgres service container.

## Project structure

```
.
├── data/emissions.csv          # the dataset (Climate Watch historical GHG emissions)
├── docker-compose.yml          # postgres + migrate (one-shot) + both services
├── docs/
│   ├── architecture.md         # data model, design decisions, trade-offs
│   ├── api.md                  # endpoint reference with curl examples
│   └── performance.md          # measured import/query throughput, EXPLAIN ANALYZE
└── services/
    ├── import-service/         # NestJS + Prisma + TypeScript
    │   ├── prisma/schema.prisma
    │   ├── src/imports/        # upload, CSV parsing/pivoting, aggregation
    │   ├── src/status/         # GET /status
    │   └── test/                # e2e tests (Supertest)
    └── query-service/          # Python + FastAPI + SQLAlchemy
        ├── app/db/models.py    # read-only mirror of the Prisma-owned schema
        ├── app/repositories/   # filter whitelist + query building
        ├── app/api/            # routes
        └── tests/               # unit + integration tests (pytest)
```

## What's implemented

Required:

- CSV upload, parse, validate, store in Postgres, post-import aggregation (count, min/max/avg)
- Query API: filter by any field, pagination, sorting, fast reads (sub-millisecond on indexed
  queries against the full ~400K-row dataset -- see [docs/performance.md](docs/performance.md))
- Docker + docker-compose for the full stack
- Unit + integration/e2e tests for both services
- ESLint (import-service) / ruff + black (query-service)
- CI pipeline: lint + build + test on every push/PR
- README + architecture/API/performance docs

Optional goals:

- Two languages/frameworks (NestJS for import, FastAPI for query)
- Rate limiter on the query service
- Profiling / performance notes (measured, not estimated -- see [docs/performance.md](docs/performance.md))
- `/status` metadata endpoint (both services)
- Documentation beyond the quickstart (this README + 3 docs pages)
- Extras not explicitly requested: SHA-256 checksum dedup for whole-file re-imports, explicit
  handling of duplicate/conflicting rows found in the real dataset (see
  [docs/architecture.md](docs/architecture.md)), structured JSON logging in both services

## License

MIT
