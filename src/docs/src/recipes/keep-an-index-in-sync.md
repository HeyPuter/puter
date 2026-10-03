---
title: Keep an Index in Sync
description: "Learn how to look up records by more than one field in the Puter.js key-value database, and keep those extra keys up to date."
tags: [kv, data-modeling, performance]
order: 37
---

In a SQL database you can add an index to a column, and the database keeps it
up to date for you. [`puter.kv`](/KV/) only looks things up by key or key
prefix, so to find records by another field you write an extra key yourself, as
shown in [Query a Collection](/recipes/query-collection/#query-by-another-field).
That extra key is an index, and it's up to your code to keep it correct.

This recipe uses orders that can be looked up by status or by customer:

| Key | Holds |
| --- | --- |
| `order:<id>` | The full order |
| `order-by-status:<status>:<id>` | A short copy of the order, for listing by status |
| `order-by-customer:<customer>:<id>` | The same copy, for listing by customer |
| `order-counts` | How many orders have each status |

Each index key holds a short copy of the fields a list needs, so a list loads
in one call without reading every order.

## Create a Record

Two helpers decide which index keys an order has and what goes in them:

```js
const indexKeys = (order) => [
    `order-by-status:${ order.status }:${ order.id }`,
    `order-by-customer:${ order.customer }:${ order.id }`,
];

const summary = (order) => ({
    id: order.id,
    status: order.status,
    customer: order.customer,
    total: order.total,
});
```

To create an order, pass an array of `{ key, value }` items to
[`puter.kv.set()`](/KV/set/). This writes the record and its index keys in one
request:

```js
async function createOrder (order) {
    await puter.kv.set([
        { key: `order:${ order.id }`, value: order },
        ...indexKeys(order).map((key) => ({ key, value: summary(order) })),
    ]);
    await puter.kv.incr('order-counts', { [order.status]: 1 });
}
```

The last line adds 1 to the count for the order's status (see [Add
Counters](/recipes/add-counters/#count-several-things-in-one-key)).

## Read Through an Index

To list orders by status, list the keys that start with that status:

```js
const { items, cursor } = await puter.kv.list({
    pattern: 'order-by-status:open:',
    returnValues: true,
    limit: 50,
});
// [{ key: 'order-by-status:open:o1', value: { id: 'o1', status: 'open', ... } }, ...]
```

To show the full order, read the record with [`puter.kv.get()`](/KV/get/):

```js
const order = await puter.kv.get(`order:${ id }`);
```

## Change a Record

When a field that's part of an index key changes, like the status, the key
itself changes. Write the new keys first, then delete any old keys that aren't
used anymore:

```js
async function updateOrder (id, changes) {
    const before = await puter.kv.get(`order:${ id }`);
    const after = { ...before, ...changes };

    await puter.kv.set([
        { key: `order:${ id }`, value: after },
        ...indexKeys(after).map((key) => ({ key, value: summary(after) })),
    ]);

    const newKeys = indexKeys(after);
    for ( const key of indexKeys(before) ) {
        if ( ! newKeys.includes(key) ) {
            await puter.kv.del(key);
        }
    }

    if ( before.status !== after.status ) {
        await puter.kv.incr('order-counts', { [before.status]: -1, [after.status]: 1 });
    }
}
```

Every index key gets rewritten, not just the ones that changed, since each one
holds a copy of the order. A new `total` has to reach every copy.

Writing the new keys before deleting the old ones means that if something stops
halfway, you end up with an extra key rather than a missing one. Extra keys are
easy to clean up, as shown below.

The count moves from the old status to the new one in a single `incr()` call.

## Delete a Record

Delete the index keys first and the record last:

```js
async function deleteOrder (id) {
    const order = await puter.kv.get(`order:${ id }`);
    if ( order === null ) return;

    for ( const key of indexKeys(order) ) {
        await puter.kv.del(key);
    }
    await puter.kv.del(`order:${ id }`);
    await puter.kv.incr('order-counts', { [order.status]: -1 });
}
```

If it stops halfway, the record is still there, so calling `deleteOrder()` again
finishes the job.

## Check Results Against the Record

Each change takes several requests, so if one of them fails, an index key can
end up out of date. When that matters, like an order still showing as open
after it shipped, check the record before trusting the index:

```js
const order = await puter.kv.get(`order:${ entry.value.id }`);

if ( order === null || order.status !== 'open' ) {
    await puter.kv.del(entry.key);   // out of date, remove it
}
```

## Count Records per Group

The `order-counts` key gives you counts with one small read:

```js
const counts = await puter.kv.get('order-counts') ?? {};
// { open: 12, shipped: 40 }
```

You can also count with `includeTotal` on [`puter.kv.list()`](/KV/list/):

```js
const { total } = await puter.kv.list({
    pattern: 'order-by-status:open:',
    limit: 1,
    includeTotal: true,
});
```

`includeTotal` counts the actual keys, so it can't drift, but it gets slower
and more expensive as the number of keys grows. The counter costs the same no
matter how many orders there are, but it can drift if a write fails. Use the
counter for numbers you show often, and `includeTotal` once in a while to fix
it:

```js
await puter.kv.update('order-counts', { open: total });
```

## Search as the User Types

An index can also power a search box that suggests matches as the user types.
Put the lowercased name at the start of the key:

```js
await puter.kv.set(`contact-by-name:${ contact.name.toLowerCase() }:${ contact.id }`, {
    id: contact.id,
    name: contact.name,
});
```

Then list the keys that start with what's been typed so far:

```js
const { items } = await puter.kv.list({
    pattern: `contact-by-name:${ typed.toLowerCase() }`,
    returnValues: true,
    limit: 10,
});
// typing 'ali' finds Alice and Alicia
```

Results come back in alphabetical order. This only matches names that start
with the typed text. To match any word in a name, write one index key per word.

[`puter.kv.list()`](/KV/list/) has a lower [rate
limit](/rate-limits-and-quotas/#key-value-store) than other calls, so don't
call it on every keystroke. Wait until the user stops typing for a moment.

## Rebuild the Index

If index keys get out of sync, or you add a new index to existing records, you
can rebuild it from the records. This reads every order a page at a time and
writes its index keys back, one batch per page:

```js
const counts = {};

for await ( const page of puter.kv.list({ pattern: 'order:', returnValues: true, stream: true }) ) {
    const items = [];
    for ( const { value: order } of page.items ) {
        counts[order.status] = (counts[order.status] ?? 0) + 1;
        items.push(...indexKeys(order).map((key) => ({ key, value: summary(order) })));
    }
    if ( items.length > 0 ) {
        await puter.kv.set(items);
    }
}
await puter.kv.set('order-counts', counts);
```

The `order:` pattern only matches records. `order-counts` and the index keys
start with `order-`, so they aren't included.

Rebuilding adds missing index keys but doesn't remove old ones. To remove those
too, go through the index and delete any key whose record is gone or doesn't
match anymore:

```js
for await ( const page of puter.kv.list({ pattern: 'order-by-', returnValues: true, stream: true }) ) {
    for ( const { key, value } of page.items ) {
        const order = await puter.kv.get(`order:${ value.id }`);
        if ( order === null || ! indexKeys(order).includes(key) ) {
            await puter.kv.del(key);
        }
    }
}
```

This reads a record for every index key, so only run it once in a while, like
from a "Repair" button.

## Notes

- Values used in keys, like a status or customer name, shouldn't contain `:`,
  or one key could look like the start of another. IDs from
  [`crypto.randomUUID()`](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID)
  are safe.
- If two tabs change the same order at the same time, the last write wins and
  the index keys can end up out of sync. If that can happen in your app, run the
  rebuild now and then.
- Each index key adds a write to every change, so only index the fields you
  actually list or search by.
