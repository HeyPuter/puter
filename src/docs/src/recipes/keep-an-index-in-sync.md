---
title: Keep an Index in Sync
description: "Learn how to look up records by more than one field with Puter.js, and keep every lookup correct as records change."
tags: [kv, data-modeling, performance]
order: 37
---

In a SQL database you can add an index to a column, and the database keeps it
up to date for you. [`puter.kv`](/KV/) only looks things up by key or key
prefix, so to find records by another field you write an extra key yourself, as
shown in [Query a Collection](/recipes/query-collection/#query-by-another-field).
That extra key is an index, and your code keeps it correct.

This recipe uses orders that can be listed by status or by customer:

| Key | Holds |
| --- | --- |
| `order:<id>` | The full order |
| `order-by-status:<status>:<id>` | A short copy of the order, for listing by status |
| `order-by-customer:<customer>:<id>` | The same copy, for listing by customer |
| `order-counts` | How many orders have each status |

Each index key holds a short copy of the fields a list shows, so a list loads in
one call without reading every order. Each index also adds a write to every
change, so index only the fields you list or search by.

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

Keep `:` out of the values you put in keys, like a status or a customer name, or
one key could look like the start of another. IDs from
[`crypto.randomUUID()`](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID)
are safe.

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

Each change takes several requests, so if one of them fails, an index key can
end up out of date. To show the full order, read the record with
[`puter.kv.get()`](/KV/get/), and check that the index entry still matches it.
An entry that doesn't is deleted:

```js
async function openOrder (entry) {
    const order = await puter.kv.get(`order:${ entry.value.id }`);

    if ( order === null || ! indexKeys(order).includes(entry.key) ) {
        await puter.kv.del(entry.key);   // out of date
        return null;
    }
    return order;
}

const order = await openOrder(items[0]);   // the entry the user clicked
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

Every index key is rewritten, not just the ones that changed, since each one
holds a copy of the order. A new `total` has to reach every copy.

Writing the new keys before deleting the old ones means that if something stops
halfway, you end up with an extra key rather than a missing one. The
`openOrder()` function catches it, and [Rebuild the Index](#rebuild-the-index)
removes it. If two tabs change the same order at the same time, the last write wins and
can leave an index key behind the same way.

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

## Count Records per Group

The `order-counts` key gives you every count with one small read:

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

The total counts the actual keys, so it can't drift, but it gets slower and
more expensive as the number of keys grows. The counter costs the same no matter
how many orders there are, but it can drift if a write fails. Use the counter
for numbers you show often, and the total once in a while to correct it:

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
const { items: matches } = await puter.kv.list({
    pattern: `contact-by-name:${ typed.toLowerCase() }`,
    returnValues: true,
    limit: 10,
});
// typing 'ali' finds Alice and Alicia
```

Results come back in alphabetical order. This only matches names that start
with the typed text. To match any word in a name, write one index key per word.

[`puter.kv.list()`](/KV/list/) has a lower [rate
limit](/rate-limits-and-quotas/#key-value-store) than other calls, so search
once the user pauses typing instead of on every keystroke.

## Rebuild the Index

If index keys get out of sync, or you add a new index to existing records,
rebuild it from the records. This reads the orders a page at a time and writes
each page's index keys in one batch:

```js
async function rebuildIndex () {
    const counts = {};

    for await ( const page of puter.kv.list({ pattern: 'order:', returnValues: true, limit: 400, stream: true }) ) {
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
}
```

A batch write takes at most [1,000 items](/rate-limits-and-quotas/#key-value-store),
so pages of 400 orders, with two index keys each, stay under it. The `order:`
pattern only matches records. The index keys and `order-counts` start with
`order-`, so they aren't included.

Rebuilding adds missing index keys but doesn't remove old ones. To remove those
too, go through the index and delete any key whose record is gone or doesn't
match anymore:

```js
async function pruneIndex () {
    for await ( const page of puter.kv.list({ pattern: 'order-by-', returnValues: true, stream: true }) ) {
        for ( const entry of page.items ) {
            await openOrder(entry);
        }
    }
}
```

This reads a record for every index key, so run it once in a while, like from a
"Repair" button.

## Full Code

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

async function createOrder (order) {
    await puter.kv.set([
        { key: `order:${ order.id }`, value: order },
        ...indexKeys(order).map((key) => ({ key, value: summary(order) })),
    ]);
    await puter.kv.incr('order-counts', { [order.status]: 1 });
}

async function openOrder (entry) {
    const order = await puter.kv.get(`order:${ entry.value.id }`);

    if ( order === null || ! indexKeys(order).includes(entry.key) ) {
        await puter.kv.del(entry.key);   // out of date
        return null;
    }
    return order;
}

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

async function deleteOrder (id) {
    const order = await puter.kv.get(`order:${ id }`);
    if ( order === null ) return;

    for ( const key of indexKeys(order) ) {
        await puter.kv.del(key);
    }
    await puter.kv.del(`order:${ id }`);
    await puter.kv.incr('order-counts', { [order.status]: -1 });
}

async function rebuildIndex () {
    const counts = {};

    for await ( const page of puter.kv.list({ pattern: 'order:', returnValues: true, limit: 400, stream: true }) ) {
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
}

async function pruneIndex () {
    for await ( const page of puter.kv.list({ pattern: 'order-by-', returnValues: true, stream: true }) ) {
        for ( const entry of page.items ) {
            await openOrder(entry);
        }
    }
}
```
