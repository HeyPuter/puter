---
title: Managing a collection of key-value entries
description: Give each record its own key under a shared prefix, so single records are written, changed and expired directly while the collection is read back a slice at a time.
tags: [kv, data-modeling, performance]
order: 30
---

**Use this when** the collection is too big for one entry, past **400 KB**, or
records need to expire on their own schedule, or reads want one slice at a time
rather than everything at once.

## Design the key

Each record is its own entry, so the key is what organises the collection. Build
it so the field you filter on comes first:

```js
// todo:<category>:<id>
await puter.kv.set(`todo:${category}:${id}`, { text: 'Buy milk', done: false });
```

Pick a field that actually partitions the data, such as a category, a project or
a status. The store is already scoped to one user, so a user id in the key adds a
level that never varies.

Everything else in this recipe follows from that layout: a full key addresses one
record, and a prefix addresses a slice.

## Work on one record

Because each record has its own key, every single-record operation is a direct
call with no read of the rest:

```js
const key = `todo:${category}:${id}`;

await puter.kv.update(key, { done: true });        // change one field
await puter.kv.set(key, { text: 'Buy oat milk', done: false });   // replace
await puter.kv.del(key);                           // delete
await puter.kv.expire(key, 60 * 60 * 24);          // expires on its own, 24h
```

Per-record expiry is the thing this shape gives you that the single-entry ones
cannot: a TTL applies to a whole key, so records sharing one entry can only
expire together.

## Read the collection

[`puter.kv.list()`](/KV/list/) reads back a slice, with values:

```js
const rows = await puter.kv.list(`todo:${category}:`, true);
// [ { key: 'todo:home:a', value: { text: 'Buy milk',     done: false } },
//   { key: 'todo:home:b', value: { text: 'Water plants', done: true  } } ]
```

Records come back sorted lexicographically by key.

## Page through it

Pass `limit` to get a page plus a `cursor`, and keep going until a page comes
back without one:

```js
let cursor;
do {
    const page = await puter.kv.list({
        pattern: `todo:${category}:`,
        returnValues: true,
        limit: 100,
        cursor,
    });
    render(page.items);
    cursor = page.cursor;
} while ( cursor );
```

`for await` does the same thing with `stream: true`:

```js
for await ( const page of puter.kv.list({ pattern: `todo:${category}:`, returnValues: true, limit: 100, stream: true }) ) {
    render(page.items);
}
```

## What a prefix buys you

The pattern is **prefix-only**, with `*` allowed at the end and nowhere else. So
a key buys you exactly **one** filter dimension: whichever field you put first.

```js
puter.kv.list('todo:home:', true);     // every todo in the home category
puter.kv.list('todo:home:*', true);    // the same thing
```

Filtering on a second field, done vs. not done for example, means listing the
prefix and filtering the results client-side:

```js
const rows = await puter.kv.list(`todo:${category}:`, true);
const open = rows.filter(r => ! r.value.done);
```

Only the leading field is selectable, so give that position to whichever one you
read by most often. If that is status rather than category, key on
`todo:<done>:<id>` instead and let category become the client-side filter. This
is key-prefix partitioning, not a query engine, and there is no secondary
index.

## Notes

- Every page is metered, and a bare `list()` with no pattern reads the entire
  store. Always pass a `pattern`, a `limit`, or both.
- Results sort lexicographically by key, so zero-pad numbers
  (`todo:home:000042`) if you want them to sort numerically.
- `includeTotal` costs a full count and grows with the store, so request it once
  on the first page rather than in a hot path. To find out only whether more
  pages exist, check for `cursor`.
- Listing is the expensive operation here. If showing the whole collection is what
  your app does most and it fits in 400 KB, [keying the items by id](/recipes/kv-edit-items-by-id/)
  makes that a single `get()` instead of a scan.
