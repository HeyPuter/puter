---
title: Run Code Only Once
description: "Learn how to make sure something runs only once with Puter.js, even when two tabs or requests try it at the same time."
tags: [kv, workers]
order: 12
---

Some things should only happen once, like showing a welcome tour or giving out
a daily reward. The obvious way is to read a flag, do the thing, then set the
flag. But two tabs can both read the flag before either one sets it, and then
both do it. This is called a race condition.

To avoid it, check and set the flag in one call. The `onlyIfAbsent` option of
[`puter.kv.set()`](/KV/set/) writes a key only when it doesn't exist yet, and
resolves to `true` only for the call that wrote it.

## Run Once

Pass `{ onlyIfAbsent: true }` and only run the action when the call resolves to
`true`:

```js
if ( await puter.kv.set('welcomeTourShown', true, { onlyIfAbsent: true }) ) {
    showWelcomeTour();
}
```

The first call writes the key and resolves to `true`. Every call after that
finds the key, writes nothing and resolves to `false`. When two tabs try at the
same moment, only one of them gets `true`.

Data in [`puter.kv`](/KV/) is stored per user and per app, so this runs once
per user, across all their tabs and devices. Two calls at nearly the same
moment from different places can both get `true`, so use it where a rare repeat
is harmless, like a tour. To show the tour again, delete the key with
[`puter.kv.del()`](/KV/del/).

## Run Once per Day

Put the date in the key, so each day gets a new key. The third argument of
[`puter.kv.set()`](/KV/set/) is when the key expires, as a Unix timestamp in
seconds, so old keys delete themselves:

```js
const today = new Date().toISOString().slice(0, 10);   // '2026-10-31', in UTC
const inTwoDays = Math.floor(Date.now() / 1000) + 2 * 24 * 60 * 60;

if ( await puter.kv.set(`dailyReward:${ today }`, true, inTwoDays, { onlyIfAbsent: true }) ) {
    giveDailyReward();
}
```

For once an hour, use `toISOString().slice(0, 13)` instead. To hold a key only
while some work runs, see
[Set a Lock or Cooldown](/recipes/store-temporary-data/#set-a-lock-or-cooldown).

## Allow It a Few Times

To allow an action more than once, count the tries with
[`puter.kv.incr()`](/KV/incr/). It adds 1 on the server and returns the new
count, so two tabs that try at once get different numbers. This allows three
free exports a day:

```js
const key = `freeExports:${ today }`;
const used = await puter.kv.incr(key);
if ( used === 1 ) {
    await puter.kv.expire(key, 2 * 24 * 60 * 60);   // delete it after 2 days
}

if ( used <= 3 ) {
    await exportFile();
} else {
    showUpgradePrompt();
}
```

Since [`puter.kv.incr()`](/KV/incr/) takes no expiry, the first try sets one
with [`puter.kv.expire()`](/KV/expire/). Tries that get turned down still count,
so the number can go past 3, and anything over 3 is turned down anyway.
[Add Counters](/recipes/add-counters/) covers counting in more detail.

## Run Once Across All Users

Code in the browser can be changed by the user, and [`puter.kv`](/KV/) only
holds one user's data. To run something once for everyone, or to guard
something valuable like a payment, do the check in a [worker](/Workers/).
Inside a worker, [`me.puter`](/Workers/router/#integration-with-puter-js) is Puter.js
signed in as you, the worker's owner, so every request reads and writes the
same keys.

Services that send webhooks, like payment providers, send an event again if
your reply is slow or fails. This worker route claims each event's ID before
handling it:

```js
router.post('/webhooks/payments', async ({ request }) => {
    const event = await request.json();
    const key = `handled:${ event.id }`;
    const inAWeek = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;

    if ( ! await me.puter.kv.set(key, true, inAWeek, { onlyIfAbsent: true }) ) {
        return { received: true };   // already handled
    }

    try {
        await handlePayment(event);
    } catch ( error ) {
        await me.puter.kv.del(key);   // let the next retry handle it
        throw error;
    }
    return { received: true };
});
```

A retry arrives seconds or minutes after the first delivery, so it finds the
claim and skips the event. Keep the key longer than the sender keeps retrying.
A week is enough for most services. If handling the event fails, the key is
deleted and the worker answers `500`, so the next retry handles it.
[Build an API with a Worker](/recipes/build-an-api/#routes-without-a-user)
covers routes that outside services call.
