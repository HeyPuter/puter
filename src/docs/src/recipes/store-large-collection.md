---
title: Store a Large Collection
description: "Learn how to store a large collection of data in the Puter.js key-value database. It fits any number of records and you can read or change one at a time."
tags: [kv, data-modeling, performance]
order: 30
---

You can keep an entire table of records in the Puter.js key-value database, such
as every todo in an app or every order in a store. Each record gets its own key,
and the key is the part you design up front. In a regular database you pick a
primary key and an index. Here you do both in one string, since a full key reads
one record and a key prefix reads a group of them.

## Store a Record

Give each record its own key and write it with the [`puter.kv.set()`](/KV/set/)
method. Name the collection first and put the record id last:

```js
await puter.kv.set(`todo:${ id }`, { text: 'Buy milk', done: false });
```

The id works like a primary key. It has to be unique inside the collection, and
it is how you reach that record later, so any unique string does, such as
`crypto.randomUUID()` or a timestamp.

## Read, Change or Delete a Record

To read one record, use the [`puter.kv.get()`](/KV/get/) method with its full
key. To change a field, use [`puter.kv.update()`](/KV/update/), and to replace
the record, use [`puter.kv.set()`](/KV/set/) again. To remove it, use
[`puter.kv.del()`](/KV/del/). None of them read or write the rest of the
collection:

```js
const key = `todo:${ id }`;

const todo = await puter.kv.get(key);
await puter.kv.update(key, { done: true });
await puter.kv.set(key, { text: 'Buy oat milk', done: false });
await puter.kv.del(key);
```

## Read the Collection

To read the records back, use the [`puter.kv.list()`](/KV/list/) method with the
name of the collection. The `true` brings the values back with the keys, so one
round trip both selects and loads:

```js
const rows = await puter.kv.list('todo:*', true);
// [ { key: 'todo:a', value: { text: 'Buy milk',     done: false } },
//   { key: 'todo:b', value: { text: 'Water plants', done: true  } } ]
```

To narrow that down, filter the results in your own code:

```js
const open = rows.filter(row => ! row.value.done);
```

Every record is still sent to your app that way, and you throw most of them
away.

## Filter with a Key Prefix

To have the database do the filtering, you can perform filter based on the key.
The [`puter.kv.list()`](/KV/list/) method accepts a key prefix match, allowing
you to only retrieve the records with the matched prefix. The tradeoff is that
you design the key before you write any records:

```js
// todo:<category>:<id>
await puter.kv.set(`todo:${ category }:${ id }`, { text: 'Buy milk', done: false });
```

A prefix now reads one category, and only those records come back:

```js
const rows = await puter.kv.list(`todo:${ category }:*`, true);
```

Pick a field that actually partitions the data, such as a category, a project or
a status.

The pattern is prefix-only, with `*` allowed at the end, so a key gives you
exactly one filter dimension. Decide which field needs the filter by prefix,
since filtering on a different field later means rewriting every key you have
already written.

Records sort lexicographically by key, so zero-pad any number you want to sort
numerically, as in `todo:home:000042`.

## Page Through a Collection

To read a large collection a page at a time, pass a `limit` and keep going until
a page comes back with no `cursor`:

```js
let cursor;
do {
    const page = await puter.kv.list({
        pattern: `todo:*`,
        returnValues: true,
        limit: 100,
        cursor,
    });
    console.log(page.items);
    cursor = page.cursor;
} while ( cursor );
```

To show numbered pages instead, jump to a page with an `offset`:

```js
const pageSize = 20;
const pageNumber = 3;

const page = await puter.kv.list({
    pattern: `todo:*`,
    returnValues: true,
    limit: pageSize,
    offset: (pageNumber - 1) * pageSize,
    includeTotal: true,
});

console.log(page.items);
console.log(`Page ${ pageNumber } of ${ Math.ceil(page.total / pageSize) }`);
```

The `offset` skips the records on the pages before this one, and `includeTotal:
true` adds a `total` to the page with the number of records matching the
pattern, which is what gives you a page count. The largest offset allowed is
5000.

## Set a TTL

To have a record delete itself later, set a TTL on it with the
[`puter.kv.expire()`](/KV/expire/) method. It takes the key and a number of
seconds:

```js
await puter.kv.expire(`todo:${ category }:${ id }`, 60 * 60 * 24);
```

A TTL applies to one key, so each record counts down on its own.

## Notes

- A [`puter.kv.list()`](/KV/list/) call with no pattern reads the entire store,
  and every page is metered. Always pass a `pattern`, a `limit`, or both.
- There is no secondary index, so a read path that needs a different filter
  needs a different key layout. [Query a collection](/recipes/query-collection/)
  covers the layouts that work, such as composite key segments and a second key
  per read path.
- For a list of a few hundred items that you always read all of, [store a small
  list](/recipes/store-small-list/) is one read instead of a page at a time.
