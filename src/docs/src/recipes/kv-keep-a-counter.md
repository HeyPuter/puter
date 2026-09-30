---
title: Keep a Counter
description: "Learn how to count things like visits, likes or unread messages with Puter.js, using one key-value call that never loses a count."
tags: [kv]
order: 8
---

Many apps count something: how often the user opened the app, how many words
they wrote, how many hints they have left. The [key-value store](/KV/) has
counter methods built in, so you never read a number, add to it, and write it
back yourself. [Store data](/recipes/store-data/) covers the basic reads and
writes.

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

## Why Not Use get() and set()

Reading the number and writing it back loses counts. Two tabs can both read 5
and both write 6, so one of the two visits disappears:

```js
// Don't do this
const opens = await puter.kv.get('opens') ?? 0;
await puter.kv.set('opens', opens + 1);
```

[`puter.kv.incr()`](/KV/incr/) does the addition inside the database in a
single write, so two calls at the same moment always add two. It is also one
call instead of two.

## Count Down

To subtract, use the [`puter.kv.decr()`](/KV/decr/) method. It works the same
way and also returns the new value:

```js
await puter.kv.decr('unread');
```

[`puter.kv.decr()`](/KV/decr/) doesn't stop at zero, so a counter at 0 goes to
-1. When a count must not go below zero, check the value it returns and undo
the step if it went too far:

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

To keep related counts together, such as the stats of one post, pass an object
that maps each field to the amount to add:

```js
const stats = await puter.kv.incr('post:42', { views: 1, likes: 1 });
// { views: 1, likes: 1 }
```

Every field in the object changes in the same write. With this form the call
returns the whole stored object instead of a number.

Paths use dot notation, and missing objects along the path are created for
you:

```js
await puter.kv.incr('post:42', { 'reactions.heart': 1 });
// { views: 1, likes: 1, reactions: { heart: 1 } }
```

The counts can sit in a record next to other fields, such as the post's title.
Only the fields you name change.

## Count per Day

To count per day, put the date in the key. Each day gets a fresh key that
starts at 0:

```js
const today = new Date().toISOString().slice(0, 10);   // '2026-09-30', in UTC

await puter.kv.incr(`opens:${ today }`);
```

To have old days delete themselves, set a TTL the first time a day is counted.
Only one call ever gets 1 back, so the TTL is set once:

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

- Use a counter key for numbers only. [`puter.kv.incr()`](/KV/incr/) rejects
  with `value_not_a_number` when the key holds text (even `'5'`), `null`, or an
  object or array and you don't name a field. The stored value stays as it
  was.
- Counts stay exact up to **±9,007,199,254,740,991**. A counter pushed past
  that reads back clamped to that limit.
- Each call counts toward the key-value rate limit of **400 calls per 10
  seconds** (200 for guest accounts). For something that happens constantly,
  such as keystrokes, add it up in your app and send one
  [`puter.kv.incr()`](/KV/incr/) with the total. See [Rate Limits and
  Quotas](/rate-limits-and-quotas/).
- [`puter.kv.incr()`](/KV/incr/) and [`puter.kv.decr()`](/KV/decr/) keep any
  TTL the key already has; they never set or extend one. Once the key has
  expired, the next [`puter.kv.incr()`](/KV/incr/) starts again from 0 with no
  TTL. For a count that restarts, put the period in the key as in [Count per
  Day](#count-per-day).
- Each user has their own counters, like the rest of their data. A count that
  every user adds to, such as the total views of a public page, goes [behind a
  worker](/recipes/store-server-side-data/) with `me.puter.kv.incr()`.
