---
title: Run Code Only Once
description: "Learn how to make sure an action runs only once, even when two tabs, devices or requests try it at the same moment, with an atomic counter in Puter.js."
tags: [kv, workers]
order: 12
---

Some actions must happen only once: showing the welcome tour, giving out a daily
reward, handling a payment. The obvious way is to check a flag, run the action,
then set the flag. That leaves a gap. Two tabs can both read the flag before
either one sets it, and then both run the action. A bug like this is called a
race condition.

The [`puter.kv.incr()`](/KV/incr/) method closes that gap. It adds 1 to a number
on the server and returns the new number in a single step, the same as `INCR`
in Redis or `UPDATE … SET n = n + 1` in SQL. A step that can't be split up like
this is called atomic. However many calls arrive at the same moment, each one
gets a different number back, and exactly one gets `1`. [Add
Counters](/recipes/add-counters/) covers the method for counting.

## Run Once

Call [`puter.kv.incr()`](/KV/incr/) and run the action only when it returns `1`:

```js
if ( await puter.kv.incr('welcomeTourShown') === 1 ) {
    showWelcomeTour();
}
```

The first call creates the key with the value 1. Every later call gets 2, 3 and
so on, and skips the tour.

Everything in `puter.kv` belongs to the signed-in user and your app, so this
runs once for each user, across all their tabs and devices. To run something
once for all users together, see [Run Once Across All
Users](#run-once-across-all-users).

## Why Not Use get() and set()

This version reads the flag, then sets it:

```js
// Two tabs can both get null here, and both show the tour.
if ( await puter.kv.get('welcomeTourShown') === null ) {
    await puter.kv.set('welcomeTourShown', true);
    showWelcomeTour();
}
```

It works with one tab. With two, both can run the [`puter.kv.get()`](/KV/get/)
call before either runs [`puter.kv.set()`](/KV/set/), so both see `null` and
both show the tour.

## Run Once per Day

To run something once a day, put the date in the key. Each day gets a new key,
which starts over at 1:

```js
const today = new Date().toISOString().slice(0, 10);   // '2026-10-02', in UTC
const key = `dailyReward:${ today }`;

if ( await puter.kv.incr(key) === 1 ) {
    await puter.kv.expire(key, 60 * 60 * 24 * 2);   // delete the key after 2 days
    giveDailyReward();
}
```

The date in the key is what limits it to once a day. The
[`puter.kv.expire()`](/KV/expire/) call only deletes old keys, so if the tab
closes before it runs, the key stays but nothing breaks. The same works for any
period: `toISOString().slice(0, 13)` gives one key per hour.

## Allow It a Few Times

The number [`puter.kv.incr()`](/KV/incr/) returns is how many times the action
was tried, so the same check works for a limit other than one. This allows three
free exports per day, a simple quota:

```js
const used = await puter.kv.incr(`freeExports:${ today }`);

if ( used <= 3 ) {
    await exportFile();
} else {
    showUpgradePrompt();
}
```

Every call counts, including the ones that are turned down, so the number can go
past 3. That doesn't matter, because anything above 3 is turned down.

## Hand Out Numbers in Order

[`puter.kv.incr()`](/KV/incr/) also works like an auto-increment column in SQL.
Each call gets the next number, and no two calls get the same one, so it can
number invoices or orders:

```js
const number = await puter.kv.incr('nextInvoiceNumber');

await puter.kv.set(`invoice:${ String(number).padStart(6, '0') }`, invoice);
// invoice:000042
```

If the [`puter.kv.set()`](/KV/set/) call fails, its number is never used, so the
numbers can have gaps. The zeros in front make the keys sort in number order,
as explained in [Query a Collection](/recipes/query-collection/#filter-by-number).

## Run Once Across All Users

Services that send you webhooks, such as payment providers, send the same event
again when your reply is slow or fails. A [worker](/Workers/) can make sure each
event is handled only once by claiming its ID. The worker writes to your own
database through `me.puter`, so every request shares the same keys, as in
[Build an API with a Worker](/recipes/build-an-api/#routes-without-a-user):

```js
router.post('/webhooks/payments', async ({ request }) => {
    const event = await request.json();
    const key = `handled:${ event.id }`;

    if ( await me.puter.kv.incr(key) > 1 ) {
        return { received: true };   // a repeat of an event already handled
    }
    await me.puter.kv.expire(key, 60 * 60 * 24 * 7);

    try {
        await handlePayment(event);
    } catch ( error ) {
        await me.puter.kv.del(key);   // so the sender's next try runs again
        throw error;
    }
    return { received: true };
});
```

An ID used this way is often called an idempotency key. Keep the key for longer
than the sender keeps retrying. A week covers most services.

If handling the event fails, the key is deleted, so the next try is not mistaken
for a repeat.

## Notes

- To let an action run again, such as replaying the welcome tour, delete its key
  with [`puter.kv.del()`](/KV/del/).
- [Set a Lock or Cooldown](/recipes/store-temporary-data/#set-a-lock-or-cooldown)
  is simpler, but two tabs can both get through it at the same moment. Use the
  approach on this page when running twice is a problem.
- Code that runs in the browser can be changed by the person using it. To guard
  something of value, such as credits or a payment, run the check in a worker.
