---
title: Query a Collection
description: "Learn how to perform queries on a collection of records in the Puter.js key-value database."
tags: [kv, data-modeling, performance]
order: 35
---

In some cases your app needs filtering, whether by category, status, date or
something else. You can do that with a key prefix. This picks up where [store a
large collection](/recipes/store-large-collection/) leaves off, with each record
under its own key.

## Put the Filter Criteria in the Key

To query by a field, embed it in the key when you write the record with the
[`puter.kv.set()`](/KV/set/) method. Notice that the status comes before the
unique id:

```js
// order:<status>:<id>
await puter.kv.set(`order:${ status }:${ id }`, order);
```

To read one slice, use the [`puter.kv.list()`](/KV/list/) method with that
prefix. The `true` brings the values back with the keys, so one round trip both
selects and loads:

```js
const pending = await puter.kv.list('order:pending:*', true);
// [ { key: 'order:pending:0001', value: { customer: 'alice', total: 48 } }, ... ]
```

## How a Pattern Matches

The [`puter.kv.list()`](/KV/list/) method matches a prefix of the key, byte for
byte:

```js
await puter.kv.list('order:pending:');    // every pending order
await puter.kv.list('order:pending:*');   // the same set, the trailing * is optional
await puter.kv.list('order:pend');        // also matches, a prefix can stop mid-segment
await puter.kv.list('order:*:alice:');    // empty, the * is a literal asterisk here
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

To filter by a different field, you need a duplicate key that starts with that
field. Write it beside the record and copy in the fields the view shows:

```js
const order = { id, status, customer, total };

await puter.kv.set(`order:id:${ id }`, order);
await puter.kv.set(`order:by-customer:${ customer }:${ id }`, { id, status, total });
```

Reading by customer is then one query, the same as any other prefix:

```js
const rows = await puter.kv.list('order:by-customer:alice:*', true);
```

Since both keys hold the data, you need to make sure every write happens to
both. Update the duplicate whenever the record changes, and delete it whenever
the record is deleted.

## Filter the Rest in Your Code

A field you rarely filter on can stay out of the key. Narrow the read with a
prefix first, then filter what came back:

```js
const rows = await puter.kv.list('order:pending:', true);
const large = rows.filter(row => row.value.total > 50);
```

That works once the prefix has already cut the set down to about a page, and it
keeps rarely used filters out of the key layout.

## Filter by Date

ISO 8601 timestamps sort chronologically as text, so a prefix of one is a
calendar range:

```js
await puter.kv.set(`log:${ new Date().toISOString() }`, entry);
// log:2026-09-09T14:03:11.204Z

await puter.kv.list('log:2026-09-', true);      // September
await puter.kv.list('log:2026-09-09', true);    // one day
await puter.kv.list('log:2026-09-09T14', true); // one hour
```

A listing comes back in ascending key order, so newest first is a `reverse()` on
the page, or a key built from a counted-down timestamp such as `String(1e13 -
Date.now())`.

## Filter by Number

A number in a key sorts as text, so `10` lands before `9`. Pad it to a fixed
width and the order comes out numeric, which also makes a digit prefix a range:

```js
await puter.kv.set(`invoice:${ String(number).padStart(6, '0') }`, invoice);
// invoice:000042

await puter.kv.list('invoice:*', true);      // every invoice, in numeric order
await puter.kv.list('invoice:000*', true);   // 000000 to 000999
```

Pick a width the numbers will not outgrow. Once the count passes six digits,
`invoice:1000000` sorts before `invoice:999999` and the order breaks.
