---
title: Store a Large Collection
description: "Learn how to store any number of records with Puter.js, and load them a page at a time or change them one at a time."
tags: [kv, data-modeling, performance]
order: 30
---

A list in one key, as in [Store a Small List](/recipes/store-small-list/), holds
a few thousand small items. For a collection that can grow past that, such as
every order in a store, give each record its own key in [`puter.kv`](/KV/).
There's no limit on how many records you keep, each one can expire on its own,
and your app loads the collection a page at a time.

## Store a Record

Write each record under its own key with the [`puter.kv.set()`](/KV/set/)
method. Start the key with the collection's name and end it with the record's
ID:

```js
const id = crypto.randomUUID();

await puter.kv.set(`todo:${ id }`, { text: 'Buy milk', done: false });
```

The ID works like a primary key. It has to be unique inside the collection, and
it's how you reach the record later.

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

## Load a Page

To load records, use the [`puter.kv.list()`](/KV/list/) method with the
collection's prefix as the `pattern`. Set `returnValues: true` to get each
record's value with its key, and a `limit` for the page size:

```js
const page = await puter.kv.list({
    pattern: 'todo:',
    returnValues: true,
    limit: 50,
});
// { items: [{ key: 'todo:1b9d…', value: { text: 'Buy milk', done: false } }, …], cursor: '…' }
```

The records come back sorted by key. [Query a
Collection](/recipes/query-collection/) shows how to design keys that filter and
sort the way a view needs.

## Load More

When more records are left, the page has a `cursor`. Pass it back to load the
next page, for example from a "Load more" button:

```js
const next = await puter.kv.list({
    pattern: 'todo:',
    returnValues: true,
    limit: 50,
    cursor: page.cursor,
});
```

The last page has no `cursor`. Check for the `cursor` instead of the number of
items, since a page can hold fewer than `limit` records while more are left,
for example when some records expired. To have the page filled up to `limit`
when it can be, add `fetchUntilFull: true`.

## Read Every Record

To go through the whole collection, such as for an export or a migration, add
`stream: true`. The call then returns the pages one at a time for a
`for await` loop:

```js
let done = 0;

for await ( const page of puter.kv.list({ pattern: 'todo:', returnValues: true, stream: true }) ) {
    done += page.items.filter(({ value }) => value.done).length;
}
```

Every page reads only the keys that match the `pattern`, so a narrow prefix
keeps a listing fast. A listing with no `pattern` reads every key your app
stored for the user.

## Expire a Record

To have a record delete itself later, pass a Unix timestamp in seconds as the
third argument of [`puter.kv.set()`](/KV/set/). Each record counts down on its
own:

```js
const inOneDay = Math.floor(Date.now() / 1000) + 60 * 60 * 24;

await puter.kv.set(`todo:${ id }`, { text: 'Buy milk', done: false }, inOneDay);
```

Expired records drop out of listings on their own. [Store Temporary
Data](/recipes/store-temporary-data/) covers expiry in more detail.
