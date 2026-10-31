---
title: Run Code in the Background
description: "Learn how to run your own code with Puter.js events when a user's files change, even while your app is closed, like a webhook or a background job."
tags: [events, fs, kv]
order: 68
---

<div class="info">The Events API is in beta. Event shapes, limits, and behavior may change between releases.</div>

Some work should happen even when nobody has your app open, such as recording
each file a user adds to a folder, or posting to a chat when a report is saved.
On other platforms you'd use a webhook, a background job, or a cloud function
that runs on upload.

In Puter, you publish a function once, and each user's persistent subscription
runs it when their files change. A persistent subscription, created with
[`puter.events.onPersistent()`](/Events/onPersistent/), is saved to the user's
account and keeps running after your app closes. Puter runs the function in
your app's [events worker](/Events/workers/), a serverless function that
belongs to your app, so you don't run a server. To update a page while it's
open, use the subscriptions in
[Watch for Changes](/recipes/watch-for-changes/) instead.

The examples build one app. Users add files to the app's `Inbox` folder, and a
handler saves a record of each new file in the app's [key-value store](/KV/),
so the app can list them later.

## Publish the Handler

A handler is the function a subscription runs. Publish it with
[`puter.events.handlers.publish()`](/Events/handlers/). This is a developer
step, like a deploy, and only the account that owns the app can do it, so run it
from a deploy script or your browser console:

```js
const app = await puter.apps.get('drop-box');    // your app's name

async function recordUpload ({ event, user }) {
    const arrived = event.op === 'add' || (event.op === 'move' && !event.from);
    if (!arrived) return;

    await user.kv.set(`uploads:${event.uid}`, {
        name: event.path.split('/').pop(),
        addedAt: event.ts,
    });
}

await puter.events.handlers.publish('recordUpload', recordUpload, { appUid: app.uid });
```

The handler gets one object. Its `event` is what changed, in the
[same shape](/Events/subjects/#the-event) as
[`onLocal()`](/Events/onLocal/) events. Its `user` is a `puter` object signed
in as the user the subscription belongs to, with the access your app has for
that user. It expires after 15 minutes, so use it only during the run.

Puter saves the handler's code and runs it later in the events worker, so the
handler can't use anything defined outside it, including `puter`. It can use its
parameters, its own variables, and standard globals like `fetch` and `JSON`.
The [`publish()`](/Events/handlers/) method rejects any other name with
`events_handler_free_variable`.

Uploads and copies arrive as `add`. A file moved in from another folder, for
example by dragging it on the Puter desktop, arrives as a `move` with no
`from`, because it came from outside the folder. The handler skips everything
else, including edits, deletes and
[gaps](/recipes/watch-for-changes/#handle-gaps). A skipped event still runs the
handler, and each run is billed to the user as worker usage under the
[User-Pays Model](/user-pays-model/).

A new folder in `Inbox` also arrives as an `add`, and a folder dragged in sends
one `move` and nothing for the files inside it. To handle those, check the item
with [`user.fs.stat({ uid: event.uid })`](/FS/stat/) and list a folder with
[`user.fs.readdir()`](/FS/readdir/).

Write the handler's output outside the folder it watches, as this one does with
the key-value store. A file it writes into `Inbox` is a new change that runs the
handler again, and Puter stops that loop after a few runs without an error.
[Handler chains](/rate-limits-and-quotas/#handler-chains) has the numbers.

## Ask for Permission

Running code while your app is closed needs the user's permission. Ask from
your app with [`puter.perms.request()`](/Perms/request/):

```js
const allowed = await puter.perms.request('backgroundEvents');
```

It resolves to `true` or `false`, and doesn't prompt when the user already
allowed it. To check without prompting, for example to decide whether to show
an "Enable background processing" button, use
[`puter.perms.check('backgroundEvents')`](/Perms/check/).

The user can take the permission back later. That pauses the app's
subscriptions for that user with the reason `permission_revoked`. They stay
paused even if the user allows it again, so your app has to subscribe again.

Persistent subscriptions need a Puter account. For a guest account,
[`onPersistent()`](/Events/onPersistent/) rejects with
`events_durable_requires_account`.

## Subscribe Once per User

Every [`onPersistent()`](/Events/onPersistent/) call creates a new
subscription, and each one runs the handler for every event. Calling it each
time the app opens would run the handler several times per file, until the user
reaches the [limit on persistent subscriptions](/rate-limits-and-quotas/#what-an-account-can-hold).
So look for one with [`puter.events.list()`](/Events/list/) first:

```js
const inbox = `~/AppData/${puter.appID}/Inbox`;
const options = { subject: `fs:${inbox}`, handlerName: 'recordUpload', queue: true };

async function findSubscription () {
    const subs = await puter.events.list();
    return subs.find((s) =>
        s.subject === options.subject && s.handlerName === options.handlerName);
}

async function startBackgroundWork () {
    const folder = await puter.fs.mkdir(inbox, { createMissingParents: true });
    const existing = await findSubscription();
    if (existing?.anchor.uid === folder.uid && existing.suspendedReason !== 'permission_revoked') return;

    if (existing) await puter.events.unsubscribe(existing.subId);
    await puter.events.onPersistent(options);
}

if (await puter.perms.request('backgroundEvents')) await startBackgroundWork();
```

An `fs:` subject on a folder matches changes anywhere inside it. The
[`mkdir()`](/FS/mkdir/) call creates `Inbox` if it's missing, and returns the
existing folder otherwise. The [`list()`](/Events/list/) method returns only
your app's subscriptions, with `subject` exactly as you passed it.

A subscription is tied to the folder itself, not its path. If the user deletes
`Inbox` on the desktop, the folder moves to the Trash and the subscription
stays on it there. Its `anchor.uid` is the ID of the folder it's tied to, so
when that differs from the folder [`mkdir()`](/FS/mkdir/) returned, the code
subscribes to the new folder. It also replaces a subscription paused with
`permission_revoked`, which never resumes.

If two tabs open at the same moment, both might create a subscription. When
[`list()`](/Events/list/) returns more than one match, keep one and unsubscribe
the rest.

With `queue: true`, Puter treats the subscription like a work queue, so every
new file gets recorded. A run that fails with a network error, a timeout or
another temporary error is retried after 2 seconds, then 4, then 8, up to 5
minutes apart. Runs over the per-minute limit for your app wait and run later.
Without `queue`, a failed run isn't retried and runs over the limit are
skipped, so uploading 100 files at once would record only about 60.

Queued events cost more per event, as
[What events cost](/rate-limits-and-quotas/#what-events-cost) lists. For work
where a missed event doesn't matter, such as refreshing a summary that the next
change refreshes anyway, leave `queue` out.

## Pass Settings to the Handler

The handler can't see your app's variables, so per-user settings go in
`context` when you subscribe, and the handler gets them as `ctx`. For example,
to post each new file to a chat webhook the user saved in your app's settings,
add it to `options` before calling `startBackgroundWork()`:

```js
options.context = { webhookUrl: settings.webhookUrl };
```

Then use it in the handler, and publish the handler again:

```js
async function recordUpload ({ event, user, ctx }) {
    const arrived = event.op === 'add' || (event.op === 'move' && !event.from);
    if (!arrived) return;

    const name = event.path.split('/').pop();
    await user.kv.set(`uploads:${event.uid}`, { name, addedAt: event.ts });

    const postedKey = `posted:${event.id}`;
    if (!ctx.webhookUrl || await user.kv.get(postedKey)) return;
    await fetch(ctx.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: `New file: ${name}` }),
    });
    await user.kv.set(postedKey, true, Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60);
}
```

A retried event has the same `event.id`. If a run posts the message but times
out before it finishes, the retry would post it again, so the handler saves the
ID after posting and skips IDs it already posted. The marker key expires after
a week. Saving the record needs no check, since writing it twice changes
nothing.

When the user changes the setting, change the subscription's `context` with
[`puter.events.update()`](/Events/update/). The subscription keeps its ID and
any events still waiting to run:

```js
async function updateWebhook (webhookUrl) {
    options.context = { webhookUrl };
    const existing = await findSubscription();
    if (existing) await puter.events.update(existing.subId, { context: options.context });
}
```

The `context` can be up to 4 KB of JSON. For more data, store it with
[`puter.kv`](/KV/) and read it in the handler with [`user.kv.get()`](/KV/get/).

## Update the Handler

To change the handler, publish it again under the same name. Every
subscription runs the new code from its next event, and users don't need to do
anything. Keep the name the same, since subscriptions are tied to it.

A deploy script runs in a new process each time, so its SDK hasn't seen what's
published. Call [`handlers.list()`](/Events/handlers/) before publishing changed
code, or [`publish()`](/Events/handlers/) rejects with
`events_handler_conflict`. This check stops two deploys from overwriting each
other's code without an error:

```js
await puter.events.handlers.list({ appUid: app.uid });
await puter.events.handlers.publish('recordUpload', recordUpload, { appUid: app.uid });
```

After [`handlers.list()`](/Events/handlers/), publishing only fails if someone
else published in between. Pass `replace: true` to overwrite anyway. To roll
back, publish the old code.

## Check on Subscriptions

A subscription can pause without being removed, and
[`list()`](/Events/list/) shows why in `suspendedReason`:

| `suspendedReason` | What happened | What to do |
| --- | --- | --- |
| `permission_revoked` | The user took back the permission, or lost access to the folder. | Nothing. It never resumes, and `startBackgroundWork()` replaces it once the user allows background work again. |
| `failures` | Five runs in a row failed. | Fix the handler and publish it again. The subscription resumes with up to 100 events it saved while paused. |
| `handler_not_found` | The handler was removed. | Publish it again. The subscription resumes. |
| `no_credit` | The user ran out of credit. | Nothing. It resumes when they add credit. |

A handler that throws counts as a failure, and with `queue` the event is
dropped unless the error has `retry: true`. When failures pause subscriptions,
Puter sends you, the developer, an `app.events.suspended` notification.

A subscription can also end, for example when its folder is permanently
deleted. It then disappears from [`list()`](/Events/list/), Puter sends the
user's app an `app.events.ended` notification, and `startBackgroundWork()`
creates a new one the next time the app opens.
[Catch Up on Notifications](/recipes/catch-up-on-notifications/) shows how to
read both notifications.

To turn off background work, for example from a setting in your app, pass the
`subId` from `findSubscription()` to
[`puter.events.unsubscribe()`](/Events/unsubscribe/).

## Full Code

The recipe has two programs. The publish script runs as the app's developer,
from a deploy script or your browser console:

```js
const app = await puter.apps.get('drop-box');    // your app's name

async function recordUpload ({ event, user, ctx }) {
    const arrived = event.op === 'add' || (event.op === 'move' && !event.from);
    if (!arrived) return;

    const name = event.path.split('/').pop();
    await user.kv.set(`uploads:${event.uid}`, { name, addedAt: event.ts });

    const postedKey = `posted:${event.id}`;
    if (!ctx.webhookUrl || await user.kv.get(postedKey)) return;
    await fetch(ctx.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: `New file: ${name}` }),
    });
    await user.kv.set(postedKey, true, Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60);
}

await puter.events.handlers.list({ appUid: app.uid });
await puter.events.handlers.publish('recordUpload', recordUpload, { appUid: app.uid });
```

The app code runs in your app, signed in as the user. Here `settings` is your
app's saved settings for that user:

```js
const inbox = `~/AppData/${puter.appID}/Inbox`;
const options = {
    subject: `fs:${inbox}`,
    handlerName: 'recordUpload',
    queue: true,
    context: { webhookUrl: settings.webhookUrl },
};

async function findSubscription () {
    const subs = await puter.events.list();
    return subs.find((s) =>
        s.subject === options.subject && s.handlerName === options.handlerName);
}

async function startBackgroundWork () {
    const folder = await puter.fs.mkdir(inbox, { createMissingParents: true });
    const existing = await findSubscription();
    if (existing?.anchor.uid === folder.uid && existing.suspendedReason !== 'permission_revoked') return;

    if (existing) await puter.events.unsubscribe(existing.subId);
    await puter.events.onPersistent(options);
}

async function updateWebhook (webhookUrl) {
    options.context = { webhookUrl };
    const existing = await findSubscription();
    if (existing) await puter.events.update(existing.subId, { context: options.context });
}

if (await puter.perms.request('backgroundEvents')) await startBackgroundWork();
```
