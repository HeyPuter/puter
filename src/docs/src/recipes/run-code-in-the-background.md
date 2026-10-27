---
title: Run Code in the Background
description: "Learn how to run your own code with Puter.js events when a user's files change, even while your app is closed, like a webhook or a background job."
tags: [events, fs, kv]
order: 68
---

<div class="info">The Events API is in beta. Event shapes, limits, and behavior may change between releases.</div>

Some work should happen even when nobody has your app open. For example,
recording each file a user adds to a folder, posting to a chat when a report is
saved, or processing a file as soon as it's uploaded. On other platforms you'd
use a webhook, a background job, or a cloud function that runs on upload.

In Puter, you write a function, publish it once, and each user's subscription
runs it when their files change. Puter runs it in your app's
[events worker](/Events/workers/), a serverless function that belongs to your
app. You don't need to run a server.

[Watch for Changes](/recipes/watch-for-changes/) covers subscriptions
that end when the page closes. This recipe uses persistent subscriptions,
created with [`puter.events.onPersistent()`](/Events/onPersistent/). They're
saved to the user's account and keep running after your app closes.

## The Three Parts

The setup has three parts:

- **The handler**: the function to run. You publish it once, as the app's
  developer.
- **Permission**: each user has to allow your app to run code while the app is
  closed.
- **The subscription**: created once per user by your app. It says what to
  watch and which handler to run.

The examples build one app. Users add files to the app's `Inbox` folder, and
the handler saves a record of each new file in the app's
[key-value store](/KV/), so the app can show them later.

## Publish the Handler

Publish with [`puter.events.handlers.publish()`](/Events/handlers/). This is a
developer step, like a deploy, and it only works for the account that owns the
app. Run it from a deploy script or your browser console. For any other account
it fails with `events_handler_forbidden`.

Here's the handler and the call that publishes it:

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

The handler gets one object as its argument. This handler uses two of its
fields:

- `event`: what changed, in the [same shape](/Events/onLocal/#the-event) as
  [`onLocal()`](/Events/onLocal/) events. The file's ID is `event.uid`.
- `user`: a `puter` object signed in as the user who owns the subscription. It
  can do whatever your app can do for that user, like `user.kv` and `user.fs`.
  It's valid for 15 minutes, so use it only during the run.

Your script doesn't run the handler. Puter stores the handler's code and runs
it later in the events worker. So the handler can't use variables or functions
defined outside it, or `puter`. It uses `user` instead of `puter`. It can use
its parameters, its own variables, and standard globals like `fetch`, `JSON`
and `Math`. The [`publish()`](/Events/handlers/) method checks this, and fails
with `events_handler_free_variable` if the handler uses a name it doesn't
define.

The handler only acts on new files. Uploads and copies arrive as `add`. A file
moved in from another folder, for example by dragging it on the Puter desktop,
arrives as a `move` with no `from`, because it came from outside the folder.
Everything else is skipped, including edits, deletes and
[gaps](/recipes/watch-for-changes/#handle-gaps).

A skipped event still runs the handler. Each run is billed to the user as
worker usage, on top of the cost per event, under the
[User-Pays Model](/user-pays-model/), and counts toward the limit of 60 runs a
minute per user and app. For example, every save to a file that's already in
`Inbox` is one run.

A new folder in `Inbox` also arrives as an `add`. To handle only files, check
the item with `user.fs.stat({ uid: event.uid })`. Dragging a folder in sends one
`move` for the folder and nothing for the files inside it, so list its contents
with `user.fs.readdir()` to handle those.

## Ask for Permission

Running code while your app is closed needs the user's permission. Ask from
your app with [`puter.perms.request()`](/Perms/request/):

```js
const allowed = await puter.perms.request('events:background');
```

It resolves to `true` or `false`. If the permission is already granted, the
user doesn't see a prompt. To check without prompting, for example to decide
whether to show an "Enable background processing" button, use
[`puter.perms.check('events:background')`](/Perms/check/).

Without the permission, [`onPersistent()`](/Events/onPersistent/) fails with
`events_background_consent_required`. The user can also revoke the permission
later. That pauses the app's subscriptions for that user with the reason
`permission_revoked`. They stay paused even if the user grants the permission
again, so your app has to subscribe again.

Persistent subscriptions need a Puter account. For a guest account,
[`onPersistent()`](/Events/onPersistent/) fails with
`events_durable_requires_account`.

## Subscribe Once per User

Every [`onPersistent()`](/Events/onPersistent/) call creates a new
subscription, even with the same options. If you call it each time the app
opens, each call adds another subscription, every one of them runs the handler
for each event, and the user eventually reaches the limit of 25 subscriptions
per app (100 on a paid plan). Check [`puter.events.list()`](/Events/list/)
first:

```js
const inbox = `~/AppData/${puter.appID}/Inbox`;
const options = { subject: `fs:${inbox}`, handlerName: 'recordUpload' };

async function findSubscription () {
    const subs = await puter.events.list();
    return subs.find((s) =>
        s.subject === options.subject && s.handlerName === options.handlerName);
}

async function startBackgroundWork () {
    const folder = await puter.fs.mkdir(inbox, { createMissingParents: true });
    const existing = await findSubscription();

    const working = existing
        && existing.anchor.uid === folder.uid
        && existing.suspendedReason !== 'permission_revoked';
    if (working) return;

    if (existing) await puter.events.unsubscribe(existing.subId);
    await puter.events.onPersistent(options);
}
```

Call `startBackgroundWork()` when the app opens, after the user has given
permission. A few details:

- An `fs:<folder>` subject matches changes anywhere inside the folder.
- The [`mkdir()`](/FS/mkdir/) call creates `Inbox` if it's missing, and returns
  the existing folder if it's already there.
- A subscription is tied to the folder itself, not its name. If the user
  deletes `Inbox` on the desktop, the folder moves to the Trash, and the
  subscription stays attached to the folder in the Trash. The code compares
  `anchor.uid` (the ID of the folder the subscription is attached to) with the
  folder from `mkdir()`. When they differ, it subscribes to the new folder.
- A paused subscription has its reason in `suspendedReason`. One paused with
  `permission_revoked` stays paused after the user grants the permission again,
  so the code replaces it. Subscriptions paused for other reasons resume
  without your app doing anything, so the code keeps them.

The [`list()`](/Events/list/) method only returns your app's subscriptions, with
`subject` exactly as you passed it. If two tabs open at the same moment, both
might create a subscription. If [`list()`](/Events/list/) returns more than one
match, keep one and unsubscribe the rest.

## Pass Settings to the Handler

The handler can't see your app's variables, so per-user settings go in
`context` when you subscribe, and the handler gets them as `ctx`. For example,
if the user saved a chat webhook URL in your app's settings, add it to
`options` before calling `startBackgroundWork()`:

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

    if (ctx.webhookUrl) {
        await fetch(ctx.webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: `New file: ${name}` }),
        });
    }
}
```

The `context` is saved when the subscription is created and never updated. If the
user changes the setting, replace the subscription:

```js
async function updateWebhook (webhookUrl) {
    options.context = { webhookUrl };
    const existing = await findSubscription();
    if (existing) await puter.events.unsubscribe(existing.subId);
    await puter.events.onPersistent(options);
}
```

This calls [`onPersistent()`](/Events/onPersistent/) directly instead of
`startBackgroundWork()`, because [`list()`](/Events/list/) can still return the
old subscription for a short time after an unsubscribe.

The `context` can be up to 4 KB of JSON, and anything bigger fails with
`events_context_too_large`. For more data, store it with [`puter.kv`](/KV/) and
read it in the handler with `user.kv.get()`. The [`list()`](/Events/list/)
method shows the key names in `context`, never the values.

To end a subscription automatically, set `expiresAt` in unix seconds or as an
ISO date string. `Date.now()` is in milliseconds, so divide it by 1000:

```js
options.expiresAt = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;    // one week from now
```

## Write Output Outside the Watched Folder

Write the handler's output somewhere the subscription isn't watching, like a
`Processed` folder next to `Inbox`, or the key-value store.

A file the handler writes into the folder it's watching is a new change, so the
handler runs again. In the events worker, Puter stops this loop after 4 runs on
the free plan and 12 on a paid plan, and doesn't report an error.

## Make Sure Every File Gets Handled

By default, the handler runs once per event. If it throws or takes longer than
30 seconds, that event is lost. There's also a limit of 60 runs a minute per
user and app, and runs past it are skipped, so if someone uploads 100 files at
once, only about 60 get recorded.

To handle every file, use `delivery: 'single'`. Puter then keeps each event
until a run finishes without throwing, retrying after 2 seconds, then 4, then
8, up to 5 minutes apart. Events over the per-minute limit are delivered later
instead of being skipped:

```js
options.delivery = 'single';
options.targets = ['worker'];
```

Setting `targets: ['worker']` runs the handler in the events worker right away.
Without it, if the user has your app open, Puter tries those tabs first, which
can delay each event by a minute or two.

Subscriptions keep the delivery they were created with. To replace the
subscriptions users created before this change, `startBackgroundWork()` also
checks `existing.delivery`:

```js
async function startBackgroundWork () {
    const folder = await puter.fs.mkdir(inbox, { createMissingParents: true });
    const existing = await findSubscription();

    const working = existing
        && existing.anchor.uid === folder.uid
        && existing.suspendedReason !== 'permission_revoked'
        && existing.delivery === 'single';
    if (working) return;

    if (existing) await puter.events.unsubscribe(existing.subId);
    await puter.events.onPersistent(options);
}
```

Some things to know about `single`:

- **The same event can run twice.** For example, if a run finishes its work but
  times out, Puter tries again with the same `event.id`. Saving the same
  key-value record twice leaves the same data, but posting to the chat twice
  sends two messages. To prevent most of these, save `event.id` after posting
  and check for it before posting. A run that crashes between posting and
  saving can still post twice.
- **Stop retrying events that can't succeed.** If retrying won't help, for
  example with a file type you don't support, throw an error with
  `terminal: true`. Puter drops the event instead of retrying it.
- **Five failures in a row pause the subscription**, including events you
  stopped with `terminal: true`. Puter notifies you as the developer. Fix the
  handler and publish it again. The subscription resumes and delivers the
  events it saved while paused.
- Events with `single` delivery cost the user $1 per million instead of $0.10.
  See [Rate Limits and Quotas](/rate-limits-and-quotas/#events).

Here's `recordUpload()` with the duplicate check. The marker key expires after
a week, so these keys don't stay in the user's key-value store. Publish the
handler again after the change:

```js
async function recordUpload ({ event, user, ctx }) {
    const arrived = event.op === 'add' || (event.op === 'move' && !event.from);
    if (!arrived) return;

    const name = event.path.split('/').pop();
    await user.kv.set(`uploads:${event.uid}`, { name, addedAt: event.ts });

    const postedKey = `posted:${event.id}`;
    if (ctx.webhookUrl && !(await user.kv.get(postedKey))) {
        await fetch(ctx.webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: `New file: ${name}` }),
        });
        await user.kv.set(postedKey, true, Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60);
    }
}
```

## Update the Handler

To change the handler, publish it again under the same name. Every
subscription uses the new code from its next event, and users don't need to do
anything.

A deploy script runs in a new process each time, so its SDK hasn't seen the
published handler yet. Call [`handlers.list()`](/Events/handlers/) before
publishing changed code. Without that call, [`publish()`](/Events/handlers/)
fails with `events_handler_conflict`. This check stops two deploys from
overwriting each other's code without an error:

```js
await puter.events.handlers.list({ appUid: app.uid });
await puter.events.handlers.publish('recordUpload', recordUpload, { appUid: app.uid });
```

After [`handlers.list()`](/Events/handlers/), publishing only fails if someone
else published in between. Pass `replace: true` to overwrite anyway. To roll
back, publish the old code.

Keep the handler's name the same. Subscriptions are tied to the name, so after
a rename every user's app has to subscribe again.

To see your apps' events workers, or remove the ones you no longer need, use
[`puter.events.workers`](/Events/workers/).

## Check on Subscriptions

A paused (*suspended*) subscription still exists, and
[`list()`](/Events/list/) shows why it's paused in `suspendedReason`:

| `suspendedReason` | What happened | What to do |
| --- | --- | --- |
| `handler_not_found` | The handler was removed. | Publish it again. The subscription resumes. |
| `failures` | Five runs in a row failed (`single` only). | Fix the handler and publish it again. The subscription resumes. |
| `no_credit` | The user ran out of credit. | Nothing. It resumes when they add credit. |
| `permission_revoked` | The user took back `events:background`, or lost access to the folder. | Ask for the permission again, then call `startBackgroundWork()`. |

A paused `single` subscription saves up to 100 missed events and delivers them
when it resumes. They're kept for 24 hours, or 1 hour for `no_credit`. Default
subscriptions don't save missed events while paused.

A subscription can also be removed entirely, for example when its folder is
permanently deleted. It then disappears from [`list()`](/Events/list/), and
`startBackgroundWork()` creates a new one the next time the app opens. When
that happens, Puter sends the user's app an `app.events.ended` notification.
When subscriptions are paused, it sends you, the developer,
`app.events.suspended`. [Catch Up on
Notifications](/recipes/catch-up-on-notifications/) shows how to read
both.

To turn off background work, for example from a setting in your app, call
[`puter.events.unsubscribe(subId)`](/Events/unsubscribe/) with the `subId` from
`findSubscription()`.

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
    if (ctx.webhookUrl && !(await user.kv.get(postedKey))) {
        await fetch(ctx.webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: `New file: ${name}` }),
        });
        await user.kv.set(postedKey, true, Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60);
    }
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
    delivery: 'single',
    targets: ['worker'],
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

    const working = existing
        && existing.anchor.uid === folder.uid
        && existing.suspendedReason !== 'permission_revoked'
        && existing.delivery === 'single';
    if (working) return;

    if (existing) await puter.events.unsubscribe(existing.subId);
    await puter.events.onPersistent(options);
}

async function updateWebhook (webhookUrl) {
    options.context = { webhookUrl };
    const existing = await findSubscription();
    if (existing) await puter.events.unsubscribe(existing.subId);
    await puter.events.onPersistent(options);
}

const allowed = await puter.perms.request('events:background');
if (allowed) await startBackgroundWork();
```
