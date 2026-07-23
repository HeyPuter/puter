---
title: KVListPage
description: The KVListPage object containing paginated key-value list results.
---

The `KVListPage` object containing paginated results from [`puter.kv.list()`](/KV/list/).

## Attributes

#### `items` (Array)

An array containing either:

- Strings (key names) when `returnValues` is `false`
- [`KVPair`](/Objects/kvpair) objects when `returnValues` is `true`

#### `cursor` (String) (optional)

A pagination cursor to fetch the next page of results. Present only when there are more results to fetch. Pass this value to the next `puter.kv.list()` call to retrieve the next page.

A page may hold fewer than `limit` items while `cursor` is still present — always iterate until `cursor` is absent.

#### `total` (Number) (optional)

The total number of items matching the query across all pages. Present only when the request set `includeTotal: true`. Computing it is metered and its cost grows with the store — request it once (on the first page) and avoid it in hot paths. If you only need to know whether more pages exist, check for `cursor` instead.
