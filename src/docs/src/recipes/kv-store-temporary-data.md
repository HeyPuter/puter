---
title: Store Temporary Data
description: "Learn how to store data that deletes itself after a while with Puter.js, such as a cached response, a draft, or a banner the user dismissed for a day."
tags: [kv, performance]
order: 9
---

Some data only matters for a while: a cached API response, a draft the user
never sent, or a banner they dismissed "for 24 hours". Give the key a TTL (time
to live) and the [key-value store](/KV/) deletes it for you, with no cleanup
code in your app. [Store data](/recipes/store-data/) covers the basic reads and
writes.

## Expire a Value

To have a key delete itself after a while, write it, then call the
[`puter.kv.expire()`](/KV/expire/) method with the number of seconds it should
live:

```js
await puter.kv.set('promoDismissed', true);
await puter.kv.expire('promoDismissed', 60 * 60 * 24);   // 24 hours
```

The seconds are counted on the server, so a wrong clock on the user's device
doesn't change when the key expires.

Write the value first. On a key that doesn't exist yet,
[`puter.kv.expire()`](/KV/expire/) creates an empty marker instead, as in
[Mark Something for a While](#mark-something-for-a-while).

## Check Whether It Expired

Once the time passes, [`puter.kv.get()`](/KV/get/) returns `null`, the same as
for a key that was never written:

```js
const dismissed = await puter.kv.get('promoDismissed');

if ( ! dismissed ) {
    showPromo();
}
```

This happens the moment the TTL runs out. [`puter.kv.list()`](/KV/list/) leaves
the key out from then on too, so you never have to filter out stale entries
yourself.

## Expire at a Set Time

To expire a key at a specific moment instead, such as the end of a sale or
midnight, use the [`puter.kv.expireAt()`](/KV/expireAt/) method with a Unix
timestamp in seconds:

```js
const midnight = new Date();
midnight.setHours(24, 0, 0, 0);

await puter.kv.expireAt('promoDismissed', Math.floor(midnight.getTime() / 1000));
```

JavaScript dates count in milliseconds, so divide by 1000. A millisecond value
reads as a date tens of thousands of years away, and the key never expires.

The timestamp comes from the user's device, which is what you want for "their
midnight". For a plain duration, use [`puter.kv.expire()`](/KV/expire/).

A timestamp that has already passed, including `0`, expires the key right
away.

## Mark Something for a While

[`puter.kv.expire()`](/KV/expire/) on a key that doesn't exist creates an
empty entry that removes itself when the TTL runs out. Use it as a basic TTL
lock or cooldown, e.g. "don't send another reminder for 10 minutes" or "one
sync at a time".

[`puter.kv.get()`](/KV/get/) reads a marker as `null`, the same as a missing
key, so check for it with [`puter.kv.list()`](/KV/list/) instead:

```js
async function isLocked (key) {
    const { items } = await puter.kv.list({ pattern: key, limit: 1 });
    return items[0] === key;
}

if ( ! await isLocked('lock:sync') ) {
    await puter.kv.expire('lock:sync', 30);   // held for 30 seconds
    await sync();
}
```

This is exact because a key sorts first among keys that start with it, and an
expired marker is left out. A closed tab can't leave the lock stuck, since the
marker removes itself; [`puter.kv.del()`](/KV/del/) releases it early. Two
tabs checking at the same instant can both see it free, so use it where that
is harmless.

## Cache a Response

To cache something you fetch, pass the expiry as the third argument of
[`puter.kv.set()`](/KV/set/). It takes the same timestamp in seconds as
[`puter.kv.expireAt()`](/KV/expireAt/), and sets the value and the TTL in one
write:

```js
async function getForecast (city) {
    const key = `forecast:${ city }`;

    const cached = await puter.kv.get(key);
    if ( cached ) return cached;

    const forecast = await fetchForecast(city);
    const inOneHour = Math.floor(Date.now() / 1000) + 60 * 60;
    await puter.kv.set(key, forecast, inOneHour);
    return forecast;
}
```

Every [`puter.kv.set()`](/KV/set/) replaces the whole entry, TTL included. A
value you write again and again, such as a draft saved on every edit, needs the
expiry on every write. Each save then pushes the deadline back:

```js
const inOneWeek = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7;

await puter.kv.set('draft', text, inOneWeek);
```

## Keep It After All

To remove a TTL, write the value again with [`puter.kv.set()`](/KV/set/) and no
expiry. The key then stays until you delete it:

```js
await puter.kv.set('draft', text);
```

Passing `null` as [`puter.kv.update()`](/KV/update/)'s TTL changes part of the
value and drops the TTL in one write. [`puter.kv.set()`](/KV/set/) with `null`
or no expiry does the same for the whole value.

## Notes

- A TTL is always in seconds. [`puter.kv.expire()`](/KV/expire/) takes a
  duration, and [`puter.kv.expireAt()`](/KV/expireAt/) and
  [`puter.kv.set()`](/KV/set/) take a Unix timestamp.
- [`puter.kv.expire()`](/KV/expire/) counts from the start of the current
  second, so a TTL of 60 ends the value 59 to 60 seconds later.
- [`puter.kv.set()`](/KV/set/) without an expiry and
  [`puter.kv.update()`](/KV/update/) with a `null` TTL clear a TTL.
  [`puter.kv.incr()`](/KV/incr/), [`puter.kv.decr()`](/KV/decr/),
  [`puter.kv.add()`](/KV/add/), [`puter.kv.remove()`](/KV/remove/), and
  [`puter.kv.update()`](/KV/update/) without a TTL argument all keep the TTL
  the key already has.
- An expired key starts fresh: [`puter.kv.incr()`](/KV/incr/) counts from 0,
  [`puter.kv.add()`](/KV/add/) starts a new array,
  [`puter.kv.update()`](/KV/update/) builds a new value, and
  [`puter.kv.expire()`](/KV/expire/) creates an empty marker. The old value
  and TTL never come back.
- A TTL belongs to one key. If each item in a list should expire on its own,
  give each item its own key, as in [store a large
  collection](/recipes/store-large-collection/).
- To count per calendar day or week, put the period in the key.
  [Keep a counter](/recipes/kv-keep-a-counter/) shows how.
