---
title: Poll an API in the Background
description: "Learn how to check an outside service for new data on a schedule with Puter.js, so your app keeps each user's copy up to date even while it's closed."
tags: [events, kv, net]
order: 71
---

<div class="info">The Events API is in beta. Event shapes, limits, and behavior may change between releases.</div>

Some services can't tell your app when something changes, so your app has to
ask them every so often. For example, importing new orders from a store,
syncing a user's bookmarks from another service, or pulling the latest
readings from a sensor. On other platforms you'd run a cron job on a server
that calls the API for every user.

In Puter, each user gets a schedule that runs your handler in your app's
[events worker](/Events/workers/), every 15 minutes in this recipe, even
while your app is closed. The handler asks the API for what changed since
its last run, and saves it in the user's [key-value store](/KV/).
[Run Code on a Schedule](/recipes/run-code-on-a-schedule/) covers handlers,
permission and creating one schedule per user. This recipe adds the two
things polling needs, a cursor and a way to finish a large batch.

The examples call an API that returns the changes after a cursor, a page at a
time:

```
GET https://api.example.com/changes?after=<cursor>
→ { "items": [{ "id": "o-1", ... }, ...], "next": "<cursor>", "hasMore": true }
```

Most APIs that list changes work like this, with a cursor, a page token or a
timestamp.

## Publish the Handler

The handler keeps its cursor in the user's key-value store, so each run picks
up where the last one stopped. Publish it as the app's developer, from a
deploy script or your browser console:

```js
const app = await puter.apps.get('order-sync');    // your app's name

async function syncChanges ({ ctx, user, fetch }) {
    const cursor = (await user.kv.get('sync:cursor')) ?? '';
    const res = await fetch(`${ctx.apiUrl}/changes?after=${encodeURIComponent(cursor)}`, {
        headers: { Authorization: `Bearer ${ctx.apiKey}` },
    });
    if (!res.ok) return;

    const page = await res.json();
    for (const item of page.items) {
        await user.kv.set(`order:${item.id}`, item);
    }
    await user.kv.set('sync:cursor', page.next);
}

await puter.events.handlers.publish('syncChanges', syncChanges, { appUid: app.uid });
```

The handler gets `ctx`, the `context` the schedule was created with, and
`fetch`, which reaches outside services from the events worker. A few
details:

- Each item is saved under its own id, so saving it twice is harmless. That
  matters because a run can happen more than once.
- The cursor is saved after the items. If a run stops partway, the next run
  fetches the same page again instead of skipping it.
- When the API answers with an error, the handler returns without moving the
  cursor, and the next run asks again. A handler that throws counts as a
  failed run, and five failed runs in a row pause the schedule until you
  publish the handler again, so an outage at the other service would pause
  every user's sync.

## Create the Schedule

In the app, after the user connects their account on the other service,
create the schedule with the API's address and the user's key:

```js
await puter.perms.request('backgroundEvents');

await puter.events.onSchedule({
    every: '15m',
    handlerName: 'syncChanges',
    context: { apiUrl: 'https://api.example.com', apiKey: userApiKey },
});
```

Create it once per user. [Run Code on a Schedule](/recipes/run-code-on-a-schedule/#create-the-schedule-once-per-user)
shows how to check [`listSchedules()`](/Events/listSchedules/) first.

The `context` is stored with the schedule and can't be changed. When the
user's key changes, remove the schedule with
[`puter.events.removeSchedule()`](/Events/removeSchedule/) and create a new
one. [`listSchedules()`](/Events/listSchedules/) shows the names of the
`context` keys, never their values. It can be up to 4 KB.

The schedule runs every 15 minutes from when it's created, which is as often
as a free plan allows. A paid plan can run one every minute. See
[Rate Limits and Quotas](/rate-limits-and-quotas/#schedules).

## Finish a Large Batch

A run has 30 seconds. After a long break, for example on the first sync, the
API may have more pages than one run can fetch. The handler keeps fetching
while there's time, and when pages are left over it schedules one extra run a
minute later, with [`user.events.onSchedule()`](/Events/onSchedule/) and `at`:

```js
async function syncChanges ({ ctx, user, fetch }) {
    const stopAt = Date.now() + 20 * 1000;
    let cursor = (await user.kv.get('sync:cursor')) ?? '';
    let hasMore = true;

    while (hasMore && Date.now() < stopAt) {
        const res = await fetch(`${ctx.apiUrl}/changes?after=${encodeURIComponent(cursor)}`, {
            headers: { Authorization: `Bearer ${ctx.apiKey}` },
        });
        if (!res.ok) return;

        const page = await res.json();
        for (const item of page.items) {
            await user.kv.set(`order:${item.id}`, item);
        }
        cursor = page.next;
        hasMore = page.hasMore;
        await user.kv.set('sync:cursor', cursor);
    }

    if (hasMore && !ctx.followUp) {
        await user.events.onSchedule({
            at: Date.now() + 60 * 1000,
            handlerName: 'syncChanges',
            context: { ...ctx, followUp: true },
        });
    }
}
```

Publish the handler again after the change. A few details:

- The loop stops starting new pages after 20 seconds, which leaves time to
  save the last one inside the 30.
- The extra run is a one-time schedule with the same handler and the same
  `context`, plus `followUp: true`. It continues from the saved cursor and
  ends on its own after it runs.
- An extra run doesn't schedule another one. Whatever it leaves over, the
  next 15-minute run picks up. A schedule created from a handler counts as
  one step deeper in a [handler chain](/Events/onPersistent/#handlers-that-trigger-handlers),
  so extra runs that each scheduled the next would stop after a few steps.
- The extra run and a regular run can overlap. Both start from the saved
  cursor, so they can fetch the same page twice, which the per-item keys
  make harmless.

## Full Code

The publish script runs as the app's developer, from a deploy script or your
browser console:

```js
const app = await puter.apps.get('order-sync');    // your app's name

async function syncChanges ({ ctx, user, fetch }) {
    const stopAt = Date.now() + 20 * 1000;
    let cursor = (await user.kv.get('sync:cursor')) ?? '';
    let hasMore = true;

    while (hasMore && Date.now() < stopAt) {
        const res = await fetch(`${ctx.apiUrl}/changes?after=${encodeURIComponent(cursor)}`, {
            headers: { Authorization: `Bearer ${ctx.apiKey}` },
        });
        if (!res.ok) return;

        const page = await res.json();
        for (const item of page.items) {
            await user.kv.set(`order:${item.id}`, item);
        }
        cursor = page.next;
        hasMore = page.hasMore;
        await user.kv.set('sync:cursor', cursor);
    }

    if (hasMore && !ctx.followUp) {
        await user.events.onSchedule({
            at: Date.now() + 60 * 1000,
            handlerName: 'syncChanges',
            context: { ...ctx, followUp: true },
        });
    }
}

await puter.events.handlers.list({ appUid: app.uid });
await puter.events.handlers.publish('syncChanges', syncChanges, { appUid: app.uid });
```

The app code runs in your app, signed in as the user, once they've connected
the other service. Here `userApiKey` is the key your app got for them:

```js
const allowed = await puter.perms.request('backgroundEvents');
if (allowed) {
    await puter.events.onSchedule({
        every: '15m',
        handlerName: 'syncChanges',
        context: { apiUrl: 'https://api.example.com', apiKey: userApiKey },
    });
}
```
