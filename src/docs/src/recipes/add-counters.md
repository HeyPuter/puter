---
title: Add Counters
description: "Learn how to add counters to your app with Puter.js that stay accurate even when the user updates them from several tabs at once."
tags: [kv]
order: 8
---

Many apps count something, such as how often the user opened the app, how many
words they wrote, or how many hints they have left. The Puter.js database,
[`puter.kv`](/KV/), has counter methods built in. The database does the
addition, so a count stays accurate even when two tabs update it at the same
moment. [Store Data](/recipes/store-data/) covers the basic reads and writes.

## Count Up

To add one, use the [`puter.kv.incr()`](/KV/incr/) method. It returns the new
value:

```js
const opens = await puter.kv.incr('opens');
```

A key that doesn't exist yet starts at 0, so the first call returns 1. To add
more than one, pass the amount:

```js
await puter.kv.incr('wordsWritten', 250);
```

The addition happens inside the database in a single write, so two tabs that
count at the same moment both add theirs. Two calls at nearly the same moment
from different places, such as two devices far apart, can still lose one of the
additions, as [`puter.kv.set()`](/KV/set/#writing-only-if-absent) explains for
`onlyIfAbsent`.

The key must hold a number. When it holds anything else, such as the text
`'5'`, the call rejects with `value_not_a_number` and the stored value stays as
it was.

## Count Down

To subtract, use the [`puter.kv.decr()`](/KV/decr/) method. It also returns the
new value:

```js
await puter.kv.decr('unread');
```

A counter keeps going below zero. When a count must stay at zero or above, check
the value it returns and undo the step if it went too far:

```js
const hintsLeft = await puter.kv.decr('hintsLeft');

if ( hintsLeft < 0 ) {
    await puter.kv.incr('hintsLeft');   // there was nothing left to use
} else {
    showHint();
}
```

This holds when two tabs spend the last hint at once. Only one of them sees 0,
and the other sees -1 and gives it back.

## Read a Counter

To show the count, read it with the [`puter.kv.get()`](/KV/get/) method. A key
that was never counted, or whose TTL ran out, comes back as `null`, so default
it to 0:

```js
const opens = await puter.kv.get('opens') ?? 0;
```

## Count Several Things in One Key

Counts that belong together can share one key, as fields of an object:

```js
{
    opens: 12,
    wordsWritten: 4500,
    hintsLeft: 3,
    features: { export: 2 },
}
```

To add to them, pass [`puter.kv.incr()`](/KV/incr/) an object that maps each
field to the amount to add. All the fields change in the same write, and the
call returns the whole stored object:

```js
const stats = await puter.kv.incr('stats', { opens: 1, wordsWritten: 250 });
// { opens: 13, wordsWritten: 4750, hintsLeft: 3, features: { export: 2 } }
```

To reach a field inside a nested object, such as `features`, write its path with
dot notation:

```js
await puter.kv.incr('stats', { 'features.export': 1 });
// { opens: 13, wordsWritten: 4750, hintsLeft: 3, features: { export: 3 } }
```

Fields left out of the call stay as they are. A field that doesn't exist yet
starts at 0, and missing objects along the path are created. A negative amount
subtracts, so one call can move a count from one field to another:

```js
await puter.kv.incr('stats', { hintsLeft: -1, hintsUsed: 1 });
```

## Count per Day

To count per day, put the date in the key. Each day gets a fresh key that
starts at 0:

```js
const today = new Date().toISOString().slice(0, 10);   // '2026-09-30', in UTC

await puter.kv.incr(`opens:${ today }`);
```

To have old days delete themselves, set a TTL with the
[`puter.kv.expire()`](/KV/expire/) method the first time a day is counted. Only
one call gets 1 back, so the TTL is set once, and later calls to
[`puter.kv.incr()`](/KV/incr/) keep it:

```js
const key = `opens:${ today }`;
const count = await puter.kv.incr(key);

if ( count === 1 ) {
    await puter.kv.expire(key, 60 * 60 * 24 * 90);   // keep 90 days
}
```

[Query a Collection](/recipes/query-collection/#filter-by-date) shows how to
read a range of dated keys back, such as one month.

## Keep the Highest Score

[`puter.kv.incr()`](/KV/incr/) adds to a number, but it can't keep the highest
one, like a game's best score. The simple way is to read the current best,
compare, and save:

```js
async function saveScore (score) {
    const best = await puter.kv.get('highScore') ?? 0;

    if ( score > best ) {
        await puter.kv.set('highScore', score);
    }
}
```

If two tabs finish a game at the same time, both can read the old best, and the
lower score can get saved last. When that matters, save each new best as its
own key, with the score padded so the keys sort in number order. The highest
score is then the last key:

```js
const scoreKey = (score) => `score:${ String(score).padStart(10, '0') }`;

async function bestScore () {
    const { items } = await puter.kv.list({ pattern: 'score:', reverse: true, limit: 1 });
    return items.length > 0 ? Number(items[0].slice('score:'.length)) : 0;
}

async function saveScore (score) {
    if ( score > await bestScore() ) {
        await puter.kv.set(scoreKey(score), { at: Date.now() });
    }
}
```

With `reverse: true`, [`puter.kv.list()`](/KV/list/) returns the keys from last
to first, so `limit: 1` gives just the highest. If two tabs save at once, each
adds its own key, and the higher score still comes out on top.

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
