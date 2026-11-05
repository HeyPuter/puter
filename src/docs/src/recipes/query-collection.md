---
title: Query a Collection
description: "Learn how to filter and sort records with Puter.js, so each view in your app loads only the records it shows."
tags: [kv, data-modeling, performance]
order: 35
---

Most views show part of a collection, such as the pending orders, one
customer's orders, or this month's log entries. [`puter.kv`](/KV/) looks records
up by key prefix, so the fields you filter on go in the key. This builds on
[Store a Large Collection](/recipes/store-large-collection/), where each record
has its own key.

## Put the Filter in the Key

To query by a field, put it in the key before the record's ID when you write the
record with the [`puter.kv.set()`](/KV/set/) method:

```js
// order:<status>:<id>
await puter.kv.set(`order:${ status }:${ id }`, order);
```

To read one slice, use the [`puter.kv.list()`](/KV/list/) method with that
prefix. Passing `true` as the second argument returns the values with the keys:

```js
const pending = await puter.kv.list('order:pending:', true);
// [{ key: 'order:pending:0001', value: { customer: 'alice', total: 48 } }, ...]
```

This short form returns every match in one array. For a slice that can grow
past a few hundred records, load it a page at a time with a `limit` and a
`cursor`, as in [Store a Large Collection](/recipes/store-large-collection/#load-a-page).

## How a Pattern Matches

The [`puter.kv.list()`](/KV/list/) method matches a prefix of the key, byte for
byte:

```js
await puter.kv.list('order:pending:');    // every pending order
await puter.kv.list('order:pending:*');   // the same, a trailing * is optional
await puter.kv.list('order:pend');        // also matches, a prefix can stop mid-segment
await puter.kv.list('order:*:alice:');    // a * before the end is a literal asterisk
await puter.kv.list('ORDER:pending:');    // empty, matching is case-sensitive
```

Lowercase the segments you build keys from, and the case a value arrives in
stops mattering:

```js
await puter.kv.set(`order:${ status.toLowerCase() }:${ id }`, order);
```

## Filter on a Second Field

Every prefix of a key is a filter you can read, so an extra segment adds a
filter:

```js
// order:<status>:<customer>:<id>
await puter.kv.set(`order:${ status }:${ customer }:${ id }`, order);

await puter.kv.list('order:pending:', true);          // by status
await puter.kv.list('order:pending:alice:', true);    // by status and customer
```

The segments read left to right, so this layout answers "pending" and "pending
for alice", while "everything for alice" needs its own key. Put the field every
view filters on first, and the one only some views add second.

## Query by Another Field

To filter by a field that isn't at the start of the key, write a second key that
starts with that field. Pass both to [`puter.kv.set()`](/KV/set/) as an array of
`{ key, value }` items to write them in one request:

```js
await puter.kv.set([
    { key: `order:${ status }:${ id }`, value: order },
    { key: `order-by-customer:${ customer }:${ id }`, value: order },
]);
```

Reading by customer is then one query, the same as any other prefix:

```js
const rows = await puter.kv.list('order-by-customer:alice:', true);
```

Both keys hold the order, so every change has to reach both, and deleting the
order deletes both. [Keep an Index in Sync](/recipes/keep-an-index-in-sync/)
shows how.

## Filter the Rest in Your Code

A field you rarely filter on can stay out of the key. Narrow the read with a
prefix first, then filter what came back:

```js
const rows = await puter.kv.list('order:pending:', true);
const large = rows.filter(row => row.value.total > 50);
```

This works once the prefix has cut the set down to about a page, and it keeps
rarely used filters out of the key layout.

## Filter by Date

ISO 8601 timestamps sort in time order as text, so a prefix of one is a
calendar range:

```js
await puter.kv.set(`log:${ new Date().toISOString() }`, entry);
// log:2026-09-09T14:03:11.204Z

await puter.kv.list('log:2026-09-', true);      // September
await puter.kv.list('log:2026-09-09', true);    // one day
await puter.kv.list('log:2026-09-09T14', true); // one hour
```

A listing comes back in ascending key order. For newest first, pass
`reverse: true` in the options form:

```js
await puter.kv.list({ pattern: 'log:2026-09-', returnValues: true, reverse: true });
```

For a range that isn't one prefix, such as the last 7 days, read newest first
and stop at the first key before the range. With `stream: true`, pages load one
at a time, so stopping early skips the rest:

```js
async function logSince (date) {
    const start = `log:${ date.toISOString() }`;
    const entries = [];

    for await ( const page of puter.kv.list({ pattern: 'log:', returnValues: true, reverse: true, limit: 100, stream: true }) ) {
        for ( const entry of page.items ) {
            if ( entry.key < start ) return entries;
            entries.push(entry);
        }
    }
    return entries;
}

const lastWeek = await logSince(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
```

## Filter by Number

A number in a key sorts as text, so `10` lands before `9`. Pad it to a fixed
width and the order comes out numeric, which also makes a digit prefix a range:

```js
await puter.kv.set(`invoice:${ String(number).padStart(6, '0') }`, invoice);
// invoice:000042

await puter.kv.list('invoice:', true);      // every invoice, in numeric order
await puter.kv.list('invoice:000', true);   // 000000 to 000999
```

Pick a width the numbers won't outgrow. Once the count passes six digits,
`invoice:1000000` sorts before `invoice:999999` and the order breaks.
