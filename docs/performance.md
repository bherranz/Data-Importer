# Performance notes

Numbers below are measured, not estimated — against the real `data/emissions.csv`
(4,848 source rows, pivoted into 398,970 `emission_records`) on a local Postgres 16 container.
Reproduce with the commands shown; nothing here is exotic tooling.

## Import throughput

```
POST /imports (full emissions.csv, 4,848 rows -> 398,970 records)
real 0m46.3s
```

That's ~46s end-to-end for a single HTTP request, including CSV parsing, the wide→long pivot,
~400 sequential `createMany` batches of 1,000 rows, and the post-import aggregation query. At
~8,600 records/sec sustained, that comfortably fits the brief's "users may be willing to wait a
few seconds... depending on size" for this dataset, and scales roughly linearly with row count
since batches are processed sequentially, not in parallel.

**Where the time goes, and what we didn't do:** batches are awaited one at a time
(`services/import-service/src/imports/imports.service.ts`) rather than fired concurrently. That's
a deliberate ceiling on connection pool usage, not an oversight — see
[architecture.md](architecture.md#import-pipeline-design). Two straightforward levers if a much
larger file needed to import faster: raise `IMPORT_BATCH_SIZE` (fewer, larger round trips — we
picked 1,000 as a conservative default, not a measured optimum), or switch the insert path from
`createMany` to Postgres `COPY`, which is typically 3-5x faster than batched `INSERT` for
bulk-loading but would mean bypassing Prisma for that one write path.

## Query performance

Indexes exist on every column the API allows filtering or sorting by:
`country`, `sector`, `year`, and the composite `(country, year)` for the common
"one country over a range of years" access pattern. `EXPLAIN ANALYZE` against the full dataset:

```sql
-- GET /emissions?country=ESP&sort_by=year&order=asc&page_size=50
EXPLAIN ANALYZE SELECT * FROM emission_records
  WHERE country = 'ESP' ORDER BY year ASC LIMIT 50;
--  Index Scan using emission_records_country_year_idx
--  Execution Time: 0.162 ms

-- GET /emissions?country=ESP&year__gte=2000&sort_by=year&order=desc&page_size=50
EXPLAIN ANALYZE SELECT * FROM emission_records
  WHERE country = 'ESP' AND year >= 2000 ORDER BY year DESC LIMIT 50;
--  Index Scan Backward using emission_records_country_year_idx
--  Execution Time: 0.392 ms
```

Sub-millisecond for both, on the full 398,970-row table, entirely from the composite index —
this is the "GET must be fast" requirement holding up in practice, not just in intent.

### The one query that doesn't scale for free: total counts

`GET /emissions` returns `meta.total` for pagination, which means a `COUNT(*)` runs on every
request (filtered or not):

```sql
EXPLAIN ANALYZE SELECT COUNT(*) FROM emission_records;
--  Execution Time: 32.074 ms   (parallel sequential-ish scan, no WHERE to use an index)

EXPLAIN ANALYZE SELECT COUNT(*) FROM emission_records WHERE country = 'ESP';
--  Execution Time: 0.284 ms   (index-only scan, WHERE clause makes this cheap)
```

A *filtered* count is cheap (index-only scan). An *unfiltered* count of the whole table costs
~32ms at this size and grows roughly linearly with row count — a known Postgres characteristic
(no maintained row-count metadata for MVCC reasons), not specific to this schema. At 400K rows
this is a non-issue; at tens of millions it would be worth switching unfiltered counts to
Postgres's planner estimate (`reltuples` in `pg_class`, or `EXPLAIN` row estimates) rather than
an exact count, since pagination UIs rarely need an exact number when there's no filter narrowing
the result set. We left it as an exact count here because correctness felt more important than a
optimization for a case (no filters, on this dataset size) that isn't actually slow yet.

## Storage cost of the indexes

```
total_size | table_size | indexes_size
165 MB     | 64 MB      | 101 MB
```

The four indexes cost more disk than the table they index (101 MB vs 64 MB) for ~400K rows.
That's the direct trade-off for the sub-millisecond filtered reads above: this system is
optimized for the brief's stated access pattern ("write once, read many"), so paying index
maintenance cost on the rare write in exchange for fast reads is the right side of that trade.

## Reproducing these numbers

```bash
docker compose up -d db
time curl -s -X POST -F "file=@data/emissions.csv" http://localhost:3000/imports > /dev/null

docker compose exec db psql -U importer -d emissions -c \
  "EXPLAIN ANALYZE SELECT * FROM emission_records WHERE country = 'ESP' ORDER BY year LIMIT 50;"

docker compose exec db psql -U importer -d emissions -c \
  "SELECT pg_size_pretty(pg_total_relation_size('emission_records')) AS total_size,
          pg_size_pretty(pg_relation_size('emission_records')) AS table_size,
          pg_size_pretty(pg_indexes_size('emission_records')) AS indexes_size;"
```
