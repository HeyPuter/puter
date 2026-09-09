---
title: Filter records by status, owner or date
description: Pull out just the records a screen needs, like open orders, one customer's invoices or last month's logs, instead of reading the whole collection.
tags: [kv, data-modeling, performance]
order: 35
---

**Use this when** each record is [its own entry](/recipes/kv-prefix-listing/) and
a view wants a subset of them: pending orders, one customer's invoices, today's
log lines.

## The key is the filter

Selecting happens on key names, so a field you filter on belongs in the key, as
far left as the reads allow:

```js
// order:<status>:<id>
await puter.kv.set(`order:${status}:${id}`, order);
```

A subset is then one prefix listing, and the `true` brings the values back with
the keys, so a single round trip both selects and loads:

```js
const pending = await puter.kv.list('order:pending:', true);
// [ { key: 'order:pending:0001', value: { customer: 'alice', total: 48 } }, ... ]
```

## How a pattern matches

[`puter.kv.list()`](/KV/list/) matches on prefix only, and it matches bytes:

```js
await puter.kv.list('order:pending:');    // every pending order
await puter.kv.list('order:pending:*');   // the same set, the trailing * is optional
await puter.kv.list('order:pend');        // also matches, a prefix can stop mid-segment
await puter.kv.list('order:*:alice:');    // keys literally starting "order:*:alice:", the * is a character here
await puter.kv.list('ORDER:pending:');    // empty, matching is case-sensitive
```

Lowercase the segments you build keys from, and the case a value arrives in
stops mattering:

```js
await puter.kv.set(`order:${status.toLowerCase()}:${id}`, order);
```

## Filter on a second field

Extra segments extend the prefix, and every prefix of the key is a filter you
can read:

```js
// order:<status>:<customer>:<id>
await puter.kv.set(`order:${status}:${customer}:${id}`, order);

await puter.kv.list('order:pending:', true);          // by status
await puter.kv.list('order:pending:alice:', true);    // by status and customer
```

The segments read left to right, so this layout answers "pending", and "pending
for alice", while "everything for alice" needs its own key. Put the field every
view filters on first, and the one only some views add second.

## Give another field its own read path

A second key beside the record turns any field into a prefix:

```js
const order = { id, status, customer, total };

await puter.kv.set(`order:id:${id}`, order);                       // the record
await puter.kv.set(`order:by-customer:${customer}:${id}`, id);     // a pointer to it
```

Read the pointers, then load the records they name:

```js
const ids = await puter.kv.list(`order:by-customer:alice:`, true);
const orders = await Promise.all(ids.map(r => puter.kv.get(`order:id:${r.value}`)));
```

Pointers hold one id each, so an edit touches only the record, and both keys
move together when the record is created, deleted, or has its customer changed.
Storing the whole record under the second key instead saves the second round
trip and asks every write to update both copies, which is worth it for a list
view that reads far more often than it writes.

## Finish the filter in the browser

The prefix narrows the scan, and the fields left over are a `filter()` on what
came back:

```js
const rows = await puter.kv.list('order:pending:', true);
const large = rows.filter(r => r.value.total > 50);
```

This is the right tool once the prefix already cuts the set down to something
page-sized, which keeps rarely used filters out of the key layout.

## Dates filter by prefix

ISO 8601 timestamps sort chronologically as text, and their prefixes are
calendar ranges:

```js
await puter.kv.set(`log:${new Date().toISOString()}`, entry);
// log:2026-09-09T14:03:11.204Z

await puter.kv.list('log:2026-09-', true);      // September
await puter.kv.list('log:2026-09-09', true);    // one day
await puter.kv.list('log:2026-09-09T14', true); // one hour
```

Numbers sort as text too, so pad them to a fixed width (`order:id:000042`) to
keep `9` ahead of `10`. Listings run in ascending key order, so newest-first is
a `reverse()` on the page, or a key built from a counted-down timestamp such as
`String(1e13 - Date.now())`.

## Notes

- Every page of a listing is metered and a pattern-less `list()` reads the whole
  store, so pass a `pattern`, a `limit`, or both. [Managing a collection of
  key-value entries](/recipes/kv-prefix-listing/) covers paging with `limit`,
  `cursor` and `stream`.
- Sorting is by byte, so `Order:` sorts before `order:`, and a key mixing cases
  interleaves in ways a reader will not expect.
- Keys are capped at `puter.kv.MAX_KEY_SIZE` (1 KB), which is room for several
  segments plus an id.
- Prefixes are the whole query engine here: there are no secondary indexes and
  no server-side comparisons, so another read path is another key, written by
  your app.
- The store belongs to the signed-in user, so a user id in the key adds a
  segment that never varies. To filter across users, put the store [behind a
  worker](/recipes/worker-shared-kv-store/) and let the key carry the user id
  there.
