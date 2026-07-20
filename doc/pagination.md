# Pagination convention for list APIs

Every list endpoint follows one wire contract. This document is the source of
truth for adding pagination to a new or existing list surface.

## Wire contract

Requests accept:

| Param | Type | Meaning |
| --- | --- | --- |
| `limit` | number | Maximum items per page. Each endpoint documents its cap and default. |
| `cursor` | string \| null | Opaque continuation token. `null` (or any presence of the key) requests the first page. |
| `offset` | number | Skip N items. Legacy/discouraged — see below. Cannot be combined with `cursor`. |
| `includeTotal` | boolean | Adds `total` to the response. |

Paginated responses are an envelope:

```json
{ "items": [...], "cursor": "…", "total": 123 }
```

- `cursor` is present only while more pages exist. Clients iterate until it
  is absent.
- `total` is present only when the request set `includeTotal`.
- **Pages may be short.** Post-query filtering (TTL expiry, permission
  checks) can shrink a page below `limit` — or even to zero — while a
  `cursor` is still returned. Never use `items.length < limit` as an
  end-of-list signal.

New request params are camelCase (`includeTotal`, `fetchUntilFull`).
Pre-existing snake_case params stay for compatibility.

## Backward compatibility

Requests without pagination params keep returning the full result in the
legacy shape (bare array) forever — old clients never break.

The envelope trigger depends on the endpoint's history:

- Endpoints where `limit` pre-dates the convention (readdir, subdomain
  `select`) return the envelope only when the request contains `cursor`
  (including `null`) or `includeTotal`; `limit`/`offset`-only requests keep
  the bare array.
- Endpoints where every pagination param is new (kv `list`, workers
  `getFilePaths`) return the envelope when any pagination param is present.

## Cursors

Cursors are opaque base64-encoded JSON, produced and consumed only by the
backend (`src/backend/util/pagination.ts`). What a cursor wraps is an
implementation detail per store:

- DynamoDB-backed lists wrap `LastEvaluatedKey`.
- SQL-backed lists wrap a keyset position — `(sortValue, id)` of the last
  row — and the query seeks past it (`WHERE (col, id) > (?, ?) ORDER BY col,
  id`). Any SQL list gaining a cursor must have a deterministic `ORDER BY`
  ending in a unique tiebreaker (`id`).

Cursors that carry a sort also pin it: a request that passes a cursor plus a
conflicting sort is rejected with 400.

## Offset

SQL-backed endpoints support `offset` natively. DynamoDB-backed endpoints
(kv) emulate it by advancing past skipped items with `Select: COUNT` queries
— no item data is transferred, but read capacity is still consumed for
everything skipped, and the caller is metered for it. **Offset is supported
for parity, not recommended** — cost grows linearly with the offset, so it is
capped (kv: 5000). Use cursors.

## Totals (`includeTotal`)

- SQL: `SELECT COUNT(*)` with the same WHERE clause as the listing.
- DynamoDB: a `Select: COUNT` loop over the query (TTL-filtered), metered to
  the caller. Cost is proportional to the total item count — request the
  total on the first page only, not every page.
- Where visibility is decided per-actor after the query (protected apps in
  the catalog listing), `total` approximates the visible set: it counts
  non-protected plus caller-owned rows, and misses rows visible only through
  explicit permission grants.

## fetchUntilFull (kv only)

DynamoDB applies `Limit` before its filter expression, so TTL-filtered pages
are structurally short. `fetchUntilFull: true` makes the backend keep
fetching (bounded number of continuation queries) until the page holds
`limit` items or the keyset is exhausted. Requires `limit`. If the bound is
hit, the response simply carries a cursor — still convention-legal.

## Adding pagination to a new endpoint

1. Use `encodeCursor`/`decodeCursor`/`normalizeLimit`/`normalizeOffset` from
   `src/backend/util/pagination.ts`.
2. Push equality filters into the query so pages and counts operate on the
   true result set; only genuinely per-actor filtering may remain post-query
   (short-pages rule covers it).
3. Fetch `limit + 1` rows to detect whether a next page exists (SQL), or use
   `LastEvaluatedKey` (DynamoDB).
4. Keep the no-params request returning the legacy full result.
