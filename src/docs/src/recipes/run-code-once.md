---
title: Run Code Only Once
description: "Learn how to make sure something runs only once with Puter.js, even when two tabs or requests try it at the same time."
tags: [kv, workers]
order: 12
---

Some things should only happen once, like showing a welcome tour or giving out
a daily reward. The obvious way is to check a flag, do the thing, then set the
flag. But two tabs can both check the flag before either one sets it, and then
both do it. This is called a race condition.

[`puter.kv.incr()`](/KV/incr/) avoids it. It adds 1 on the server and returns
the new number in one step, so no matter how many calls happen at once, exactly
one of them gets back `1`. [Add Counters](/recipes/add-counters/) covers
`incr()` for regular counting.

## Run Once

Call [`puter.kv.incr()`](/KV/incr/) and only run the action when it returns `1`:

```js
if ( await puter.kv.incr('welcomeTourShown') === 1 ) {
    showWelcomeTour();
}
```

The first call returns 1. Every call after that returns 2, 3 and so on, and
skips the tour.

Data in `puter.kv` is stored per user and per app, so this runs once per user,
across all their tabs and devices. To run something once across all users, see
[Run Once Across All Users](#run-once-across-all-users).

## Why Not Use get() and set()

```js
// Two tabs can both get null here, and both show the tour.
if ( await puter.kv.get('welcomeTourShown') === null ) {
    await puter.kv.set('welcomeTourShown', true);
    showWelcomeTour();
}
```

With one tab this works fine. With two, both can call
[`puter.kv.get()`](/KV/get/) before either calls [`puter.kv.set()`](/KV/set/),
so both see `null` and both show the tour.

## Run Once per Day

Put the date in the key. Each day gets a new key that starts again at 1:

```js
const today = new Date().toISOString().slice(0, 10);   // '2026-10-02', in UTC
const key = `dailyReward:${ today }`;

if ( await puter.kv.incr(key) === 1 ) {
    await puter.kv.expire(key, 60 * 60 * 24 * 2);   // delete the key after 2 days
    giveDailyReward();
}
```

The date in the key is what makes it once a day. The
[`puter.kv.expire()`](/KV/expire/) call just cleans up old keys, so if the tab
closes before it runs, nothing breaks. For once an hour, use
`toISOString().slice(0, 13)` instead.

## Allow It a Few Times

[`puter.kv.incr()`](/KV/incr/) returns how many times the action has been tried,
so the same check works for limits other than one. This allows three free
exports a day:

```js
const used = await puter.kv.incr(`freeExports:${ today }`);

if ( used <= 3 ) {
    await exportFile();
} else {
    showUpgradePrompt();
}
```

Calls that get turned down still count, so the number can go past 3. That's
fine, since anything over 3 is turned down anyway.

## Hand Out Numbers in Order

[`puter.kv.incr()`](/KV/incr/) also works like an auto-increment ID in SQL.
Every call gets the next number and no two calls get the same one, which is
useful for things like invoice numbers:

```js
const number = await puter.kv.incr('nextInvoiceNumber');

await puter.kv.set(`invoice:${ String(number).padStart(6, '0') }`, invoice);
// invoice:000042
```

If the [`puter.kv.set()`](/KV/set/) call fails, that number is skipped, so there
can be gaps. The zero padding keeps the keys in number order, as explained in
[Query a Collection](/recipes/query-collection/#filter-by-number).

## Run Once Across All Users

Services that send webhooks, like payment providers, will send an event again
if your reply is slow or fails. A [worker](/Workers/) can make sure each event
is only handled once by claiming its ID. It uses `me.puter.kv`, which is your
own storage, so every request shares the same keys (see [Build an API with a
Worker](/recipes/build-an-api/#routes-without-a-user)):

```js
router.post('/webhooks/payments', async ({ request }) => {
    const event = await request.json();
    const key = `handled:${ event.id }`;

    if ( await me.puter.kv.incr(key) > 1 ) {
        return { received: true };   // already handled
    }
    await me.puter.kv.expire(key, 60 * 60 * 24 * 7);

    try {
        await handlePayment(event);
    } catch ( error ) {
        await me.puter.kv.del(key);   // let the next retry try again
        throw error;
    }
    return { received: true };
});
```

Keep the key around longer than the sender keeps retrying. A week is enough for
most services. If handling the event fails, the key is deleted so the next retry
runs normally.

## Notes

- To let something run again, like replaying the welcome tour, delete its key
  with [`puter.kv.del()`](/KV/del/).
- [Set a Lock or Cooldown](/recipes/store-temporary-data/#set-a-lock-or-cooldown)
  is simpler, but two tabs can get through it at the same time. Use `incr()`
  when running twice would be a problem.
- Code running in the browser can be changed by the user. For anything
  valuable, like credits or payments, do the check in a worker.
