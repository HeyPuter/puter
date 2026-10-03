---
title: Keep an Index in Sync
description: "Learn how to look up records by more than one field in the Puter.js key-value database, and keep those extra keys correct as records are created, changed and deleted."
tags: [kv, data-modeling, performance]
order: 37
---

In a SQL database, you add an index on a column and the database keeps it up to
date for you. [`puter.kv`](/KV/) only finds records by key or by the start of a
key, so to look records up by another field you write a second key yourself, as
[Query a Collection](/recipes/query-collection/#query-by-another-field) shows.
That second key is your index, and keeping it correct is your code's job. This
recipe shows how, using orders that you look up by status and by customer.

| Key | Holds |
| --- | --- |
| `order:<id>` | The full order. This is the record |
| `order-by-status:<status>:<id>` | A short copy of the order, for listing orders by status |
| `order-by-customer:<customer>:<id>` | The same copy, for listing a customer's orders |
| `order-counts` | How many orders have each status |

Each index key holds a short copy of the fields a list shows, so a list loads
with one call and doesn't need to read every order.

## Create a Record

Two small helpers say which index keys an order has and what goes in them:

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

To create an order, write the record and its index keys with one call to
[`puter.kv.set()`](/KV/set/), passing an array of `{ key, value }` items. This
is a batch write: all the keys go in one request instead of one request each:

```js
async function createOrder (order) {
    await puter.kv.set([
        { key: `order:${ order.id }`, value: order },
        ...indexKeys(order).map((key) => ({ key, value: summary(order) })),
    ]);
    await puter.kv.incr('order-counts', { [order.status]: 1 });
}
```

The last line adds 1 to the count for the order's status. [Add
Counters](/recipes/add-counters/#count-several-things-in-one-key) explains
counts kept in one object.

## Read Through an Index

To list orders by status, read the keys that start with that status:

```js
const { items, cursor } = await puter.kv.list({
    pattern: 'order-by-status:open:',
    returnValues: true,
    limit: 50,
});
// items: [{ key: 'order-by-status:open:o1', value: { id: 'o1', status: 'open', … } }, …]
```

To show one order in full, read its record with
[`puter.kv.get()`](/KV/get/):

```js
const order = await puter.kv.get(`order:${ id }`);
```

## Change a Record

When a field that is part of an index key changes, such as the status, the
index key changes too. Write the new keys first, then delete the old ones that
are no longer used:

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

A few things to note:

- Every index key is written again, not just the changed ones, because each one
  holds a copy of the order. A changed `total` has to reach every copy.
- New keys are written before old keys are deleted. If the page closes in
  between, you are left with an extra index key, not a missing one. An extra
  key is easy to spot and remove, as shown in [Check Results Against the
  Record](#check-results-against-the-record).
- The count moves from one status to the other in a single call, so the total
  never goes out of step.

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

The writes for one change are separate requests, and a batch write is not a
transaction, so if a call fails partway an index key can briefly point at the
wrong thing. When showing an index entry would do harm, such as an order listed
as open when it shipped, check it against the record before you trust it:

```js
const order = await puter.kv.get(`order:${ entry.value.id }`);

if ( order === null || order.status !== 'open' ) {
    await puter.kv.del(entry.key);   // out of date, remove it
}
```

## Count Records per Group

The `order-counts` key from the sections above answers "how many?" with one
small read:

```js
const counts = await puter.kv.get('order-counts') ?? {};
// { open: 12, shipped: 40 }
```

[`puter.kv.list()`](/KV/list/) can also count, with `includeTotal`:

```js
const { total } = await puter.kv.list({
    pattern: 'order-by-status:open:',
    limit: 1,
    includeTotal: true,
});
```

`includeTotal` counts the keys themselves, so it can't drift, but it gets slower
and costs more the more keys it counts. A counter key costs the same however many orders there
are, but can drift if a write fails. Use the counter for numbers you show often,
and `includeTotal` now and then to correct it:

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

Then list the keys that start with what the user typed so far:

```js
const { items } = await puter.kv.list({
    pattern: `contact-by-name:${ typed.toLowerCase() }`,
    returnValues: true,
    limit: 10,
});
// typed 'ali' → Alice, Alicia
```

The results come back in alphabetical order. This finds names that start with
the text, not names that contain it anywhere. To match any word in a name, write
one index key per word.

[`puter.kv.list()`](/KV/list/) has a lower [rate
limit](/rate-limits-and-quotas/#key-value-store) than the other calls, so don't
run it on every keystroke. Wait until the user stops typing for a moment, which
is often called debouncing.

## Rebuild the Index

If index keys get out of step, or you add a new index to records you already
have, rebuild it from the records. Read every order a page at a time, and write
its index keys back in one batch per page:

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

The pattern `order:` matches only records. `order-counts` and the index keys
start with `order-`, so they are left out.

Rebuilding adds missing index keys but doesn't remove stale ones. To also remove
those, go through the index keys and delete each one whose record is gone or no
longer matches:

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

This reads every record once for each of its index keys, so run it rarely, for
example from a "Repair" button or after you change how your keys are laid out.

## Notes

- A value used in a key, such as a status or customer name, shouldn't contain
  `:`, or one key could look like it starts with another. IDs from
  [`crypto.randomUUID()`](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID)
  are safe.
- When two tabs change the same order at the same moment, the last write wins,
  and its index keys can disagree with the other tab's. If that can happen in
  your app, run the rebuild now and then.
- Every index key is one more write on each change. Only index the fields you
  actually list or search by.
