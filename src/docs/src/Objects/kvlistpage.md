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
