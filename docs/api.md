# API reference

Interactive docs (Swagger/OpenAPI): import-service at `/docs` (default http://localhost:3000/docs),
query-service at `/docs` (default http://localhost:8000/docs). This page is the curl-first
version for quick reference and copy-paste.

## import-service (default: http://localhost:3000)

### `POST /imports`

Upload a CSV, pivot it into records, store it. Multipart form field name is `file`.

```bash
curl -X POST -F "file=@data/emissions.csv" http://localhost:3000/imports
```

```json
{
  "id": "4c60f0d3-f6e2-48ec-8a0c-f5ab8d710e66",
  "filename": "emissions.csv",
  "status": "COMPLETED",
  "totalRows": 4848,
  "validRows": 2526,
  "duplicateRows": 2310,
  "invalidRows": 12,
  "errorSummary": [
    { "row": 2002, "key": "AUS|Other|Industrial process", "reason": "Duplicate row with conflicting values; kept first occurrence" }
  ],
  "aggregates": {
    "recordCount": 398970,
    "countries": 210,
    "sectors": 16,
    "year": { "min": 1850, "max": 2014 },
    "value": { "min": -428, "max": 38000, "avg": 39.5 }
  },
  "startedAt": "2026-07-18T13:42:01.375Z",
  "finishedAt": "2026-07-18T13:42:47.541Z"
}
```

Status codes:

| Code | Meaning |
|---|---|
| 201 | New import completed |
| 200 | This exact file (by SHA-256) was already imported — returns the original summary, `duplicateOfExistingImport: true`, nothing re-ingested |
| 400 | File missing/empty, not a `.csv`, or fails to parse (missing/unexpected columns) |
| 409 | This exact file is currently being imported by a concurrent request |

Row-level problems (a handful of bad rows in an otherwise-valid file) do **not** fail the
request — they're reported in `errorSummary`/`invalidRows`/`duplicateRows` instead. See
[architecture.md](architecture.md#the-dataset-has-real-messiness-and-we-chose-not-to-hide-it)
for why.

### `GET /imports/:id`

```bash
curl http://localhost:3000/imports/4c60f0d3-f6e2-48ec-8a0c-f5ab8d710e66
```

Same shape as the `POST /imports` response. `404` if the id doesn't exist.

### `GET /status`

```bash
curl http://localhost:3000/status
```

```json
{
  "totalRecords": 398970,
  "lastImport": {
    "id": "4c60f0d3-f6e2-48ec-8a0c-f5ab8d710e66",
    "filename": "emissions.csv",
    "status": "COMPLETED",
    "startedAt": "2026-07-18T13:42:01.375Z",
    "finishedAt": "2026-07-18T13:42:47.541Z"
  },
  "schemaVersion": "20260718120000_init"
}
```

## query-service (default: http://localhost:8000)

### `GET /emissions`

Filter by any column, exact match or comparison operator, plus pagination and sorting.

```bash
# Exact match
curl "http://localhost:8000/emissions?country=ESP&sector=Energy"

# Range filter: field__op, op in {eq,ne,gt,gte,lt,lte}
curl "http://localhost:8000/emissions?year__gte=2000&year__lte=2010"

# Sort + paginate
curl "http://localhost:8000/emissions?country=ESP&sort_by=year&order=desc&page=1&page_size=20"
```

```json
{
  "data": [
    { "id": "...", "country": "ESP", "sector": "Total including LULUCF", "parentSector": null, "year": 2014, "value": 203.0, "importId": "..." }
  ],
  "meta": { "total": 165, "page": 1, "page_size": 20, "total_pages": 9 }
}
```

Filterable/sortable fields: `country`, `sector`, `parentSector`, `year`, `value` (plus `id`,
`createdAt` for sorting only). Filtering or sorting on anything else, or an unknown operator
suffix, is a `400` with a message naming the bad field/operator — never a silently-ignored
param and never a raw SQL/500 error.

Rate limited (default 60 requests/minute/IP, configurable via `RATE_LIMIT`) — exceeding it
returns `429`.

### `GET /emissions/{id}`

```bash
curl http://localhost:8000/emissions/eaa89965-9647-46a7-9c64-c96b4486d174
```

`404` if the id doesn't exist.

### `GET /status`

Same shape as import-service's `/status` (see above) — computed independently from
query-service's own database connection, so it stays available even if import-service is down.

### `GET /health`

```bash
curl http://localhost:8000/health
# {"status": "ok"}
```

Liveness check, no database dependency, unrated-limited — meant for orchestration health checks.
