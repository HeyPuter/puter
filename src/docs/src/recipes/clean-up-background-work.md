---
title: Clean Up Background Work
description: "Learn how to find and remove background jobs your app no longer needs, so users aren't billed for them."
tags: [events, workers]
order: 70
---

<div class="info">The Events API is in beta. Event shapes, limits, and behavior may change between releases.</div>

An app that runs code in the background, as in
[Run Code in the Background](/recipes/run-code-in-the-background/), leaves
two kinds of things behind. Each user has persistent subscriptions in their
account, and you have the handlers you published and the events worker that
runs them. When a feature changes or goes away, the ones you no longer need can
keep running. A subscription with a handler runs it for every event it matches,
and each run is billed to the user. An [events worker](/Events/workers/) can be
billed to you even when nothing runs on it.

This recipe removes both. Your app cleans up each user's subscriptions, and you
remove the handlers and events workers you no longer use.

## Remove Stale Subscriptions

Your app can see and end only the subscriptions it created, so it cleans up
for each user when they open it. List the subscriptions with
[`puter.events.list()`](/Events/list/), and end the ones you don't need with
[`puter.events.unsubscribe()`](/Events/unsubscribe/):

```js
const handlersInUse = new Set(['recordUpload']);

async function cleanUpSubscriptions () {
    const kept = new Set();
    for (const sub of await puter.events.list()) {
        const key = `${sub.subject} ${sub.handlerName}`;
        const keep = handlersInUse.has(sub.handlerName)
            && sub.suspendedReason !== 'permission_revoked'
            && !kept.has(key);
        if (keep) kept.add(key);
        else await puter.events.unsubscribe(sub.subId);
    }
}

await cleanUpSubscriptions();
```

The code keeps one subscription for each subject and handler your app still
uses, and ends the rest:

- **A handler you stopped using.** Put only the handler names the current
  version of your app subscribes with in `handlersInUse`. A subscription made
  without a handler has `handlerName: null`, so add `null` if your app makes
  those.
- **Paused with `permission_revoked`.** The user took back the permission, or
  lost access to what the subscription watched. It never resumes. It stays in
  the list for up to 30 days unless you remove it.
- **A duplicate.** Two tabs that open at the same moment can both create a
  subscription, and each one runs the handler for every event.

Call `cleanUpSubscriptions()` when the app opens, before `startBackgroundWork()`
from [Run Code in the Background](/recipes/run-code-in-the-background/#subscribe-once-per-user),
so that function finds the subscription that's left.

## Remove Handlers You No Longer Use

Removing a handler is a developer step, so run it from a deploy script or your
browser console, signed in as the app's owner.
[`puter.events.handlers.list()`](/Events/handlers/) shows how many
subscriptions still use each handler, and
[`puter.events.handlers.remove()`](/Events/handlers/) removes one:

```js
const app = await puter.apps.get('drop-box');    // your app's name

for (const handler of await puter.events.handlers.list({ appUid: app.uid })) {
    console.log(`${handler.name}: ${handler.subscriptions} subscriptions`);
}

await puter.events.handlers.remove('postToWebhook', { appUid: app.uid });
```

The subscriptions that still use the handler stop right away. They're paused
with `handler_not_found`, not deleted, and publishing the handler again resumes
them. A paused subscription still counts toward the user's
[limit on persistent subscriptions](/rate-limits-and-quotas/#what-an-account-can-hold),
so `cleanUpSubscriptions()` deletes it the next time the user opens your app.

Release the version of your app that no longer subscribes with the handler
before you remove it. An older version that subscribes with a removed handler
gets `events_handler_not_found` from
[`puter.events.onPersistent()`](/Events/onPersistent/).

## Remove an Events Worker

Your app's events worker is created when you publish its first handler, and
removed with its last one. To see which of your apps have one, call
[`puter.events.workers.list()`](/Events/workers/) outside an app, for example
in your browser console on Puter. It returns a page at a time:

```js
let cursor;
do {
    const page = await puter.events.workers.list({ cursor });
    for (const worker of page.items) {
        console.log(`${worker.appName} (${worker.appUid}): ${worker.handlerCount} handlers`);
    }
    cursor = page.cursor;
} while (cursor);
```

For an app you retired, or one you only used for testing, pass its `appUid` to
[`puter.events.workers.destroy()`](/Events/workers/). It removes every handler
the app published, which removes the worker, and pauses their subscriptions as
removing each handler would:

```js
const retired = await puter.apps.get('old-drop-box');
await puter.events.workers.destroy(retired.uid);
```
