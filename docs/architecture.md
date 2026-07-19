# Architecture & design decisions

This document explains the *why* behind the system's shape: the data model, who owns the
schema, how filtering works, and the trade-offs we made on purpose. For *how to run it* see
the root [README](../README.md); for endpoint-by-endpoint reference see [api.md](api.md).

## System overview

```
                 ┌──────────────┐        writes          ┌──────────────┐
  CSV upload ──▶│ import-service│ ────────────────────▶ │  PostgreSQL  │
                 │ (NestJS +    │                        │              │
                 │  Prisma)     │                        │  imports     │
                 └──────────────┘                        │  emission_   │
                                                         │  records     │
                 ┌──────────────┐        reads           │              │
   HTTP GET ───▶│ query-service │ ────────────────────▶ │              │
                 │ (FastAPI +   │                        └──────────────┘
                 │  SQLAlchemy) │
                 └──────────────┘
```

Two services, one database, one schema owner. import-service is the only thing that runs
migrations; query-service is a read-only consumer that mirrors the schema in hand-written
SQLAlchemy models.

## Why two languages

The brief calls this out explicitly as an optional goal, and it's also a reasonable model of a
real split: an ingestion pipeline (I/O-bound, benefits from a single ecosystem's ORM/migration
tooling) and a read API (benefits from being cheap to scale horizontally and independent of the
writer's release cycle). NestJS's module system maps cleanly onto "parse → validate → persist →
aggregate" as a pipeline; FastAPI's async story and Pydantic validation map cleanly onto "accept
untrusted query params → build a safe query → return fast."

The cost is real: two toolchains, two dependency files, two Dockerfiles, and a schema that has
to be kept in sync by hand (see below). For a single always-consistent team, one language would
be the pragmatic default, we picked two here because the brief asks for it and because it's a
more honest demonstration of API design decisions in two different idioms.

## Data model

### The source data isn't what a first glance suggests

`data/emissions.csv` looks like a typical tabular export, but it's **wide**, not long: one row
per (country, sector), and 165 columns, one per year from 1850 to 2014. Filtering "by year" or
sorting "by value" only makes sense once that's pivoted into one row per (country, sector,
year). The import pipeline does that pivot at ingest time; the database only ever stores the
long/tidy form.

```prisma
model EmissionRecord {
  id           String   @id @default(uuid())
  country      String   // ISO3-ish code as given in the source, e.g. "ESP"; also
                         // includes aggregate regions like "WORLD" and "EU28"
  sector       String
  parentSector String?  // null for top-level sectors
  year         Int
  value        Float
  importId     String
  import       Import   @relation(fields: [importId], references: [id], onDelete: Cascade)

  @@unique([importId, country, sector, year])
  @@index([country])
  @@index([sector])
  @@index([year])
  @@index([country, year])
}
```

`Import` is the audit/aggregation record for one uploaded file: row counts, an error sample,
and the post-import aggregates (count, min/max/avg, distinct countries/sectors) computed once
after ingest via a single raw SQL query rather than N application-level round trips.

### The dataset has real messiness, and we chose not to hide it

Running the parser against the real CSV surfaced two distinct anomalies, and we made a
deliberate, different call for each:

- **2,310 rows are byte-for-byte duplicates** of an earlier row (same country/sector/parent,
  identical values across all 165 years). These are silently skipped and counted as
  `duplicateRows`, re-ingesting the same observation twice would double-count it in every
  aggregate downstream, and there's no information lost by dropping the repeat.
- **12 rows share a (country, sector, parentSector) key with a previous row but disagree on the
  values.** Silently keeping the last one (which is what a naive `INSERT ... ON CONFLICT DO
  UPDATE` would do) would hide a real data quality problem. Instead we keep the first occurrence
  and record the conflict, row number, key, and reason, in `Import.errorSummary`, counted
  under `invalidRows`. The alternative (reject the whole file) felt disproportionate for 12 rows
  out of 4,848; the alternative (average them, pick the max) would be inventing data.

This is why `Import` tracks four counters (`totalRows`, `validRows`, `duplicateRows`,
`invalidRows`) instead of a single pass/fail, a large real-world file rarely fits a binary
outcome, and the counters plus `errorSummary` are what let a caller decide whether the import is
trustworthy enough to use.

### Column names look like TypeScript, not SQL, on purpose

Prisma writes column names exactly as declared (`parentSector`, not `parent_sector`), which
means they're case-sensitive and need quoting in raw SQL (`"parentSector"`). We kept Prisma's
defaults rather than adding `@map(...)` everywhere, since the two services already have to agree
on a schema by convention (see below), reducing the number of places that convention is
translated seemed better than a cosmetic snake_case column naming pass.

## Single schema owner, dual readers

Only import-service runs migrations (`prisma migrate deploy`, via the one-shot `migrate`
service in `docker-compose.yml`). query-service's SQLAlchemy models
(`services/query-service/app/db/models.py`) are **hand-maintained to match**, including mapping
the real Postgres `ImportStatus` enum type Prisma creates.

This is a trade-off we're making explicitly rather than accidentally:

- **Pro:** one migration history, one source of truth for `CREATE TABLE`/`CREATE INDEX`, no risk
  of two ORMs racing to alter the same table.
- **Con:** schema drift risk, if someone adds a column to `schema.prisma` and forgets to mirror
  it in `models.py`, query-service silently doesn't see the new column (SQLAlchemy only selects
  columns it knows about) rather than failing loudly.

At this scale (two services, one team) that risk is acceptable and the alternative, giving
query-service its own migration tooling against a table it doesn't own, is worse. In a larger
system this is exactly the kind of seam that gets replaced with a shared schema registry or
generated client models (e.g. generating the SQLAlchemy models from `schema.prisma` in CI, which
would be a reasonable next step rather than a wrong initial choice).

CI enforces one honest check on this: query-service's tests apply the exact SQL that Prisma's
migration produces (`services/import-service/prisma/migrations/*/migration.sql`) before running
against it, so a schema mismatch between the two service's expectations fails CI instead of
surfacing in production.

## Query API design

`GET /emissions` supports filtering on **any column**, not a hardcoded subset, via two query
param conventions:

- `?country=ESP` → equality
- `?year__gte=2000&year__lte=2010` → range/comparison, suffix in `{eq,ne,gt,gte,lt,lte}`

Both the field name and the operator are checked against a whitelist
(`services/query-service/app/repositories/filters.py`) before touching the database, this is
what stands in for an allowlist-based guard against building arbitrary SQL from user input, and
it's unit-tested independently of any database (`tests/test_filters.py`). An unknown field or
operator is a `400`, not a `500` or a silently-ignored filter.

Pagination is offset/limit (`page`, `page_size`) rather than cursor-based. Cursor pagination is
the better choice for very large result sets or infinite scroll, but offset pagination is what
the brief's "pagination and sorting" asks for in the simplest form, and it's what lets a client
jump to an arbitrary page, a reasonable trade for a dataset this size. Sorting always has a
secondary tiebreaker on `id`, since Postgres doesn't guarantee a stable order for ties on the
requested sort column, and an unstable order means offset pagination can skip or repeat rows
across pages.

## Import pipeline design

The CSV is parsed as a stream (`services/import-service/src/imports/csv/emissions-csv-parser.service.ts`)
using Node's `for await...of` over the parser, not `csv-parse`'s sync API, this bounds memory to
roughly one batch's worth of rows regardless of file size, which matters given the brief's "the
file could be a lot larger" note. Rows are pivoted and inserted in configurable batches
(`IMPORT_BATCH_SIZE`, default 1000) via `createMany`, awaited sequentially rather than fired
concurrently, so a large import can't open hundreds of simultaneous connections against Prisma's
pool.

Whole-file idempotency is handled separately from row-level dedup: the upload's SHA-256 checksum
is checked against previous imports before parsing starts, so re-uploading an identical file is
a fast no-op (returns the original summary, HTTP 200) instead of re-parsing and re-inserting
~400K rows. See [performance.md](performance.md) for what that costs when it *isn't* a no-op.
