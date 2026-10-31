---
title: Store Temporary Data
description: "Learn how to store data that deletes itself after a set time with Puter.js, so your app needs no cleanup code."
tags: [kv, performance]
order: 9
---

Some data only matters for a while, such as a dismissed banner, a cached
response or a draft. With [`puter.kv`](/KV/), you can give a key a TTL (time to
live) or an expiry time, and the key is removed when the time is up.

## Expire a Value

To have a key delete itself after a while, write it, then call the
[`puter.kv.expire()`](/KV/expire/) method with the number of seconds it should
live:

```js
await puter.kv.set('promoDismissed', true);
await puter.kv.expire('promoDismissed', 60 * 60 * 24);   // 24 hours
```

The seconds are counted on the server, so a wrong clock on the user's device
doesn't change when the key expires. A TTL belongs to one key. To have items of
a list expire one by one, give each item [its own
key](/recipes/store-large-collection/).

## Check Whether It Expired

Once the time passes, [`puter.kv.get()`](/KV/get/) returns `null`, the same as
for a key that was never written:

```js
const dismissed = await puter.kv.get('promoDismissed');

if ( ! dismissed ) {
    showPromo();
}
```

From then on, [`puter.kv.list()`](/KV/list/) leaves the key out too, so you
never filter out stale entries yourself.

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
user's time zone.

## Cache a Response

To cache something you fetch, pass the expiry as the third argument of
[`puter.kv.set()`](/KV/set/). It takes the same timestamp in seconds as
[`puter.kv.expireAt()`](/KV/expireAt/), and sets the value and the expiry in
one write:

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

Every call to [`puter.kv.set()`](/KV/set/) replaces the whole entry, expiry
included. A value you write again and again, such as a draft saved on every
edit, needs the expiry on every write, and each save moves it later:

```js
const inOneWeek = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7;

await puter.kv.set('draft', text, inOneWeek);
```

## Set a Lock or Cooldown

To run something at most once in a period, such as one reminder every 10
minutes, write a key with an expiry and `onlyIfAbsent: true` in the options of
[`puter.kv.set()`](/KV/set/). The key is written only when it isn't already
there, and the call returns `false` when it is:

```js
async function claim (key, seconds) {
    const expireAt = Math.floor(Date.now() / 1000) + seconds;
    return await puter.kv.set(key, true, expireAt, { onlyIfAbsent: true });
}

if ( await claim('cooldown:reminder', 10 * 60) ) {
    await sendReminder();
}
```

Once the key expires, the next `claim()` call writes it again and returns
`true`.

To run one sync at a time, use the key as a lock and delete it with
[`puter.kv.del()`](/KV/del/) when the work is done. If the tab closes in the
middle, the expiry releases the lock:

```js
if ( await claim('lock:sync', 30) ) {
    try {
        await sync();
    } finally {
        await puter.kv.del('lock:sync');
    }
}
```

The check and the write are a single call. Two calls at nearly the same moment
from different places can still both get `true`, so use this where running
twice is harmless.

## Remove a TTL

To keep a key for good, write the value again with
[`puter.kv.set()`](/KV/set/) and no expiry:

```js
await puter.kv.set('draft', text);
```

To change part of a value and remove its TTL in the same write, pass `null` as
the TTL of [`puter.kv.update()`](/KV/update/).

Calls that change part of a value keep the TTL the key already has. That
includes [`puter.kv.incr()`](/KV/incr/), [`puter.kv.decr()`](/KV/decr/),
[`puter.kv.add()`](/KV/add/), [`puter.kv.remove()`](/KV/remove/), and
[`puter.kv.update()`](/KV/update/) without a TTL argument.
