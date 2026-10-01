---
title: Store Temporary Data
description: "Learn how to store data that deletes itself after a set time with Puter.js, so your app needs no cleanup code."
tags: [kv, performance]
order: 9
---

In some cases, you might want to store data only for a while. With `puter.kv`,
you can set a TTL (time to live) or an expiry time on a key. When the time is up, the key is removed automatically.

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
[Set a Lock or Cooldown](#set-a-lock-or-cooldown).

## Check Whether It Expired

Once the time passes, [`puter.kv.get()`](/KV/get/) returns `null`, the same as
for a key that was never written:

```js
const dismissed = await puter.kv.get('promoDismissed');

if ( ! dismissed ) {
    showPromo();
}
```

The key is gone the moment the TTL runs out. From then on,
[`puter.kv.list()`](/KV/list/) leaves it out too, so you never have to filter
out stale entries yourself.

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

The timestamp comes from the user's device, so midnight here is midnight in the
user's time zone. For a plain duration, use [`puter.kv.expire()`](/KV/expire/).

A timestamp that has already passed, including `0`, expires the key right
away.

## Set a Lock or Cooldown

Calling [`puter.kv.expire()`](/KV/expire/) on a key that doesn't exist creates
an empty marker that removes itself when the TTL runs out. You can use the
marker as a basic lock or cooldown, such as waiting 10 minutes before sending
another reminder, or running one sync at a time.

The [`puter.kv.get()`](/KV/get/) method reads a marker as `null`, the same as a
missing key. To check whether the marker exists, use
[`puter.kv.list()`](/KV/list/) instead:

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

The list is sorted, and a key comes first among the keys that start with it, so
the first item is the marker when it exists. An expired marker is left out of
the list.

When the tab closes in the middle of a sync, the marker still removes itself
when the TTL runs out. To release the lock early, delete the key with the
[`puter.kv.del()`](/KV/del/) method. Two tabs that check at the same moment can
both see the lock as free, so use it where running twice is harmless.

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

Every call to [`puter.kv.set()`](/KV/set/) replaces the whole entry, TTL
included. A value you write again and again, such as a draft saved on every
edit, needs the expiry on every write. Each save then moves the expiry later:

```js
const inOneWeek = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7;

await puter.kv.set('draft', text, inOneWeek);
```

## Remove a TTL

To keep a key for good, write the value again with
[`puter.kv.set()`](/KV/set/) and no expiry. The key then stays until you delete
it:

```js
await puter.kv.set('draft', text);
```

To change part of the value and remove the TTL in the same write, pass `null`
as the TTL of [`puter.kv.update()`](/KV/update/).

Calls that change part of a value keep the TTL the key already has. That
includes [`puter.kv.incr()`](/KV/incr/), [`puter.kv.decr()`](/KV/decr/),
[`puter.kv.add()`](/KV/add/), [`puter.kv.remove()`](/KV/remove/), and
[`puter.kv.update()`](/KV/update/) without a TTL argument.

## Notes

- A TTL belongs to one key. If each item in a list should expire on its own,
  give each item its own key, as in [store a large
  collection](/recipes/store-large-collection/).
- To count per calendar day or week, put the period in the key.
  [Add counters](/recipes/add-counters/) shows how.
