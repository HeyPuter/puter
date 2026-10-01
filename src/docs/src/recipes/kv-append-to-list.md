---
title: Append to a List
description: "Learn how to add items to a list that only grows, such as a log, a chat transcript or an activity feed, with one Puter.js key-value call."
tags: [kv, data-modeling]
order: 10
draft: true
---

Some lists only ever grow: an activity log, a chat transcript, a history feed.
Items are written once and never changed, and the list is read whole with one
[`puter.kv.get()`](/KV/get/). The [key-value store](/KV/) appends to a stored
array for you, so you never read the list just to add to it.
[Store data](/recipes/store-data/) covers the basic reads and writes.

If items get edited or deleted later, keep them in an object keyed by id
instead, as in [Store a Small List](/recipes/store-small-list/).

## Append an Item

To add an item to the end of the list, use the
[`puter.kv.add()`](/KV/add/) method and wrap the item in an array:

```js
await puter.kv.add('log', [{ at: Date.now(), event: 'opened' }]);
```

A key that doesn't exist yet is created as an array, so there is nothing to set
up first. The call returns the whole updated list.

## Why Not Use get() and set()

Reading the list, pushing an item and writing it back loses items. Two tabs can
both read the same list, and whichever writes second drops the other's item:

```js
// Don't do this
const log = await puter.kv.get('log') ?? [];
log.push({ at: Date.now(), event: 'opened' });
await puter.kv.set('log', log);
```

[`puter.kv.add()`](/KV/add/) appends inside the database in a single write, so
two calls at the same moment always add both items. It is also one call
instead of two.

## Append Several Items

An array argument is spread: each element is appended on its own. This adds
two entries, not one nested array:

```js
await puter.kv.add('log', [
    { at: Date.now(), event: 'edited' },
    { at: Date.now(), event: 'saved' },
]);
```

## Always Wrap Objects in an Array

A bare object is not an item. [`puter.kv.add()`](/KV/add/) reads each of its
keys as a path inside the stored value:

```js
// Wrong: reads `at` and `event` as paths, and a list has neither
await puter.kv.add('log', { at: Date.now(), event: 'closed' });

// Right: one item, appended to the list
await puter.kv.add('log', [{ at: Date.now(), event: 'closed' }]);
```

The wrong form rejects with `invalid_path` and leaves the list as it
was. Wrapping every item in an array is the one rule that always works.

## Append to a List Inside an Object

The object form is useful when the list sits inside a record. Name the path to
the list, and pass the items to append there:

```js
await puter.kv.set('profile', { name: 'Ada', tags: ['alpha'] });

await puter.kv.add('profile', { tags: ['beta', 'gamma'] });
// { name: 'Ada', tags: ['alpha', 'beta', 'gamma'] }
```

Paths use dot notation, so `{ 'settings.labels': ['urgent'] }` appends to
`settings.labels`. Missing objects along the path are created for you, and the
rest of the record is left alone.

## Read the List

To show the list, read it with [`puter.kv.get()`](/KV/get/). A list that was
never written comes back as `null`, so default it to an empty array:

```js
const log = await puter.kv.get('log') ?? [];
```

## Notes

- A value is capped at **400 KB**, and a list that grows forever reaches it.
  Put the period in the key, such as `log:2026-09`, so each month starts a new
  list, or give each item its own key as in [Store a Large
  Collection](/recipes/store-large-collection/).
- [`puter.kv.add()`](/KV/add/) returns the whole updated list, so appends to a
  long list get slower as it grows. Another reason to roll over to a new key.
- Each call counts toward the key-value rate limit of **400 calls per 10
  seconds** (200 for guest accounts). See [Rate Limits and
  Quotas](/rate-limits-and-quotas/).
- A list whose TTL ran out starts fresh: the next
  [`puter.kv.add()`](/KV/add/) creates a new list.
  [Store Temporary Data](/recipes/store-temporary-data/) covers TTLs.
- To count things, use a counter instead. [Add
  Counters](/recipes/add-counters/) shows how.
