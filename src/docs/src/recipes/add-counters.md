---
title: Add Counters
description: "Learn how to add counters to your app with Puter.js that stay accurate even when many updates happen at once."
tags: [kv]
order: 8
---

Many apps count something: how often the user opened the app, how many words
they wrote, how many hints they have left. `puter.kv` is your database in
Puter.js, and it has counter methods built in. The database does the addition
for you, so a count stays accurate even when two tabs update it at the same
moment. [Store data](/recipes/store-data/) covers the basic reads and writes.

## Count Up

To add one, use the [`puter.kv.incr()`](/KV/incr/) method. It returns the new
value:

```js
const opens = await puter.kv.incr('opens');
```

A key that doesn't exist yet starts at 0, so the first call returns 1. There is
nothing to set up first.

To add more than one, pass the amount:

```js
await puter.kv.incr('wordsWritten', 250);
```

The addition happens inside the database in a single write, so two calls at the
same moment always add two. The key must hold a number. When it holds anything
else, such as the text `'5'`, the call rejects with `value_not_a_number` and the
stored value stays as it was.

## Count Down

To subtract, use the [`puter.kv.decr()`](/KV/decr/) method. It works the same
way and also returns the new value:

```js
await puter.kv.decr('unread');
```

A counter keeps going below zero, so a counter at 0 goes to -1. When a count
must stay at zero or above, check the value it returns and undo the step if it
went too far:

```js
const hintsLeft = await puter.kv.decr('hintsLeft');

if ( hintsLeft < 0 ) {
    await puter.kv.incr('hintsLeft');   // there was nothing left to use
} else {
    showHint();
}
```

Checking the returned value is safe when two tabs spend the last hint at once.
Only one of them sees 0, and the other sees -1 and gives it back.

## Read a Counter

To show the count, read it with the [`puter.kv.get()`](/KV/get/) method. A key
that was never counted, or whose TTL ran out, comes back as `null`, so default
it to 0:

```js
const opens = await puter.kv.get('opens') ?? 0;
```

## Count Several Things in One Key

So far each count has its own key, such as `opens` or `hintsLeft`. When an app
tracks several counts that belong together, it can keep them all in one key
instead. The value of that key is an object, and each count is a field of the
object.

For example, a writing app can keep all of its usage counts in one object.

```js
{
    opens: 12,
    wordsWritten: 4500,
    hintsLeft: 3,
    features: { export: 2 },
}
```

To add to these counts, pass an object with the fields you want to change to
[`puter.kv.incr()`](/KV/incr/). The value of each field is the amount to add.
All the fields change in the same write, and the call returns the whole stored
object:

```js
const stats = await puter.kv.incr('stats', { opens: 1, wordsWritten: 250 });
// { opens: 13, wordsWritten: 4750, hintsLeft: 3, features: { export: 2 } }
```

To reach a field inside a nested object, such as `features`, write its path
with dot notation:

```js
await puter.kv.incr('stats', { 'features.export': 1 });
// { opens: 13, wordsWritten: 4750, hintsLeft: 3, features: { export: 3 } }
```

Fields left out of the call, such as `hintsLeft`, stay as they are. A field
that doesn't exist yet starts at 0, and missing objects along the path are
created for you.

## Count per Day

To count per day, put the date in the key. Each day gets a fresh key that
starts at 0:

```js
const today = new Date().toISOString().slice(0, 10);   // '2026-09-30', in UTC

await puter.kv.incr(`opens:${ today }`);
```

To have old days delete themselves, set a TTL with the
[`puter.kv.expire()`](/KV/expire/) method the first time a day is counted. Only
one call ever gets 1 back, so the TTL is set once. Later calls to
[`puter.kv.incr()`](/KV/incr/) keep that TTL as it is:

```js
const key = `opens:${ today }`;
const count = await puter.kv.incr(key);

if ( count === 1 ) {
    await puter.kv.expire(key, 60 * 60 * 24 * 90);   // keep 90 days
}
```

[Query a collection](/recipes/query-collection/) shows how to read a range of
dated keys back, such as one month.

## Reset a Counter

To start over, delete the key with the [`puter.kv.del()`](/KV/del/) method. The
next [`puter.kv.incr()`](/KV/incr/) starts from 0 again:

```js
await puter.kv.del('opens');
```

## Notes

- Each user has their own counters, like the rest of their data. A count that
  every user adds to, such as the total views of a public page, goes [behind a
  worker](/recipes/store-server-side-data/) with
  [`me.puter.kv.incr()`](/KV/incr/).
