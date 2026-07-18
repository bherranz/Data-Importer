# Data Importer - Emissions Data Ingestion & Query System

Two-service system for importing and querying historical GHG emissions data (Climate Watch / CAIT format).

- **import-service** (NestJS + Prisma + TypeScript) - CSV upload, validation, and ingestion.
- **query-service** (Python + FastAPI + SQLAlchemy) - read-optimized REST API over the imported data.

> Documentation is being built up alongside the implementation. See [docs/architecture.md](docs/architecture.md) for design decisions and trade-offs (to be created).

## Quickstart

```bash
cp .env.example .env
docker compose up --build
```

- import-service: http://localhost:3000
- query-service: http://localhost:8000 (docs at `/docs`)

## Status

Work in progress
