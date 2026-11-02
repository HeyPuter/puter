---
title: KVListPage
description: A page of results from puter.kv.list().
---

A page of results from [`puter.kv.list()`](/KV/list/).

## Attributes

#### `items` (Array)

An array containing either:

- Strings (key names) when `returnValues` is `false`
- [`KVPair`](/Objects/kvpair) objects when `returnValues` is `true`

#### `cursor` (String) (optional)

Pass it as `cursor` to the next [`puter.kv.list()`](/KV/list/) call to get the next page. It's included only if there are more pages to load. A page can hold fewer than `limit` items while more pages exist, so keep going until a page has no `cursor`.

#### `total` (Number) (optional)

The number of items that match across all pages. Only included when the request set `includeTotal: true`. The count is metered, and its cost grows with the size of the store. Request it once, on the first page, and keep it out of hot paths. To find out whether more pages exist, check for `cursor` instead.
