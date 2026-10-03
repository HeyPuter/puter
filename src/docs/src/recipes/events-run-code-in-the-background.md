---
title: Run Code in the Background
description: "Learn how to run your own code with Puter.js events when a user's files change, even while your app is closed, like a webhook or a background job."
tags: [events, fs, kv]
order: 68
---

<div class="info">The Events API is in beta. Event shapes, limits, and behavior may change between releases.</div>

Some work should happen even when nobody has your app open: recording each
file a user adds to a folder, posting to a chat when a report is saved, or
processing an upload as soon as it lands. On other platforms you'd use a
webhook, a background job, or a cloud function that runs on upload.

In Puter, you write a function, publish it once, and each user's subscription
runs it when their files change. Puter runs it for you in your app's
[events worker](/Events/workers/), a serverless function that belongs to your
app, so there's no server for you to run.

[Watch for Changes](/recipes/events-watch-for-changes/) covers subscriptions
that end when the page closes. This recipe uses persistent subscriptions,
created with [`puter.events.onPersistent()`](/Events/onPersistent/). They're
saved to the user's account and keep running after your app closes.

## How It Fits Together

There are three pieces:

- **The handler**: the function to run. You publish it once, as the app's
  developer.
- **Permission**: each user has to allow your app to run code while they're
  away.
- **The subscription**: created once per user by your app. It says what to
  watch and which handler to run.

The examples build one app. Users add files to the app's `Inbox` folder, and
the handler saves a record of each new file in the app's
[key-value store](/KV/), so the app can show them later.

## Publish the Handler

Publish with [`puter.events.handlers.publish()`](/Events/handlers/). This is a
developer step, like a deploy: it only works for the account that owns the
app. Run it from a deploy script or your browser console, not when users open
the app. For anyone else it fails with `events_handler_forbidden`.

From [Node.js](/getting-started/), with your auth token:

```js
import { init } from '@heyputer/puter.js/src/init.cjs';

const puter = init(process.env.puterAuthToken);
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

The handler gets one object. This one uses:

- `event`: what changed, in the [same shape](/Events/onLocal/#the-event) as
  `onLocal()` events. `event.uid` is the file's ID.
- `user`: a `puter` object signed in as the user who owns the subscription. It
  can do whatever your app can do for that user, like `user.kv` and `user.fs`.

Your script doesn't run the handler. Puter stores its code and runs it later,
somewhere else. That means it can't use anything from the surrounding file: no
outside variables or functions, and no `puter` (use `user` instead). It can use
its parameters, its own variables, and standard globals like `fetch`, `JSON`
and `Math`. `publish()` checks this and fails with
`events_handler_free_variable` if something is missing.

The handler only acts on new files. Uploads and copies arrive as `add`. A file
moved in from another folder, for example by dragging it on the Puter desktop,
arrives as a `move` with no `from`, because it came from outside the folder.
Everything else is skipped, including edits, deletes and
[gaps](/recipes/events-watch-for-changes/#handle-gaps).

## Ask for Permission

Running code while the user is away needs their permission. Ask from your app
with [`puter.perms.request()`](/Perms/request/):

```js
const allowed = await puter.perms.request('events:background');
```

It resolves to `true` or `false`. If the permission is already granted, the
user doesn't see a prompt. To check without prompting, for example to decide
whether to show an "Enable background processing" button, use
`puter.perms.check('events:background')`.

Without it, `onPersistent()` fails with `events_background_consent_required`.
The user can also take the permission back later. See
[Check on Subscriptions](#check-on-subscriptions).

## Subscribe Once per User

Every `onPersistent()` call creates a new subscription, even with the same
options. If you call it each time the app opens, the copies pile up, each one
runs the handler for every event, and the user eventually hits the limit of 25
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

- `fs:<folder>` matches changes anywhere inside the folder.
- `mkdir()` creates `Inbox` if it's missing, and returns the existing folder if
  it's already there.
- A subscription is tied to the folder itself, not its name. If the user
  deletes `Inbox` on the desktop, the folder moves to the Trash and the
  subscription goes with it. Comparing `anchor.uid` (the ID of the folder the
  subscription is attached to) with the folder from `mkdir()` catches this, and
  the code subscribes to the new folder.
- Subscriptions paused for other reasons resume without your app doing
  anything (see [Check on Subscriptions](#check-on-subscriptions)), so only a
  `permission_revoked` one gets replaced.

`list()` only returns your app's subscriptions, with `subject` exactly as you
passed it. If two tabs open at the same moment, both might create a
subscription. If `list()` returns more than one match, keep one and unsubscribe
the rest.

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

`context` is saved when the subscription is created and never updated. If the
user changes the setting, replace the subscription:

```js
async function updateWebhook (webhookUrl) {
    options.context = { webhookUrl };
    const existing = await findSubscription();
    if (existing) await puter.events.unsubscribe(existing.subId);
    await puter.events.onPersistent(options);
}
```

This calls `onPersistent()` directly instead of `startBackgroundWork()`,
because `list()` can take a moment to catch up after an unsubscribe and might
still return the old subscription.

`context` can be up to 4 KB of JSON, and anything bigger fails with
`events_context_too_large`. For more data, store it with [`puter.kv`](/KV/) and
read it in the handler with `user.kv.get()`. `list()` shows the key names in
`context`, never the values.

To end a subscription automatically, set `expiresAt` in unix seconds or as an
ISO date string. `Date.now()` is in milliseconds, so divide it by 1000:

```js
options.expiresAt = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;    // one week from now
```

## Don't Trigger Your Own Handler

If the handler writes a file into the folder it's watching, that's a new
change, and the handler runs again. In the events worker, this chain stops
after 4 runs on the free plan and 12 on a paid plan, and it stops without
telling you.

Write output somewhere the subscription isn't watching, like a `Processed`
folder next to `Inbox`, or the key-value store.

## Make Sure Every File Gets Handled

By default, the handler runs once per event. If it throws or takes longer than
30 seconds, that event is lost. There's also a limit of 60 runs a minute per
user and app, and runs past it are skipped, so if someone uploads 100 files at
once, only about 60 get recorded.

When every file matters, use `delivery: 'single'`. Puter then keeps each event
until a run finishes without throwing, retrying after 2 seconds, then 4, then
8, up to 5 minutes apart. Events over the per-minute limit wait their turn
instead of being skipped:

```js
options.delivery = 'single';
options.targets = ['worker'];
```

`targets: ['worker']` runs the handler in the events worker right away. Without
it, if the user has your app open, Puter tries those tabs first, which can
delay each event by a minute or two.

Subscriptions keep the delivery they were created with. If users already
subscribed before you made this change, also check
`existing.delivery === 'single'` in `startBackgroundWork()`, so their old
subscriptions get replaced.

Some things to know about `single`:

- **The same event can run twice.** For example, if a run finishes its work but
  times out, Puter tries again with the same `event.id`. Saving the same
  key-value record twice is harmless, but posting to the chat twice sends two
  messages. To avoid that, save `event.id` after posting and check for it
  first, as shown below. This makes repeats rare, but a run that crashes
  between posting and saving can still post twice.
- **Give up on events that will never work.** If retrying won't help, for
  example with a file type you don't support, throw an error with
  `terminal: true`. Puter drops the event instead of retrying it.
- **Five failures in a row pause the subscription**, including events you gave
  up on. Puter notifies you as the developer. Fix the handler and publish it
  again, and the subscription picks up where it left off.
- `single` events cost the user $1 per million instead of $0.10. See
  [Rate Limits and Quotas](/rate-limits-and-quotas/#events).

Here's the duplicate check inside the handler. The marker expires after a week,
so these keys don't pile up:

```js
const postedKey = `posted:${event.id}`;
if (ctx.webhookUrl && !(await user.kv.get(postedKey))) {
    await fetch(ctx.webhookUrl, { /* as above */ });
    await user.kv.set(postedKey, true, Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60);
}
```

## Update the Handler

To change the handler, publish it again under the same name. Every
subscription uses the new code from its next event, and users don't need to do
anything.

A deploy script that starts fresh each time should call `handlers.list()`
before publishing new code. Otherwise `publish()` fails with
`events_handler_conflict`. This check is there so two deploys can't overwrite
each other without noticing:

```js
await puter.events.handlers.list({ appUid: app.uid });
await puter.events.handlers.publish('recordUpload', recordUpload, { appUid: app.uid });
```

After `list()`, publishing only fails if someone else published in between.
Pass `replace: true` to overwrite anyway. To roll back, publish the old code.

Avoid renaming handlers. Subscriptions are tied to the name, so after a rename
every user's app has to subscribe again.

## Check on Subscriptions

A subscription can be paused (*suspended*) without being deleted. `list()`
shows the reason in `suspendedReason`:

| `suspendedReason` | What happened | What to do |
| --- | --- | --- |
| `handler_not_found` | The handler was removed. | Publish it again. The subscription resumes. |
| `failures` | Five runs in a row failed (`single` only). | Fix the handler and publish it again. The subscription resumes. |
| `no_credit` | The user ran out of credit. | Nothing. It resumes when they top up. |
| `permission_revoked` | The user took back `events:background`, or lost access to the folder. | Ask for the permission again, then call `startBackgroundWork()`. |

A paused `single` subscription saves up to 100 missed events and delivers them
when it resumes. They're kept for 24 hours, or 1 hour for `no_credit`. Default
subscriptions don't save anything while paused.

A subscription can also be removed entirely, for example when its folder is
permanently deleted. It then disappears from `list()`, and
`startBackgroundWork()` creates a new one the next time the app opens. When
that happens, Puter sends the user's app an `app.events.ended` notification.
When subscriptions are paused, it sends you, the developer,
`app.events.suspended`. [Catch Up on
Notifications](/recipes/events-catch-up-on-notifications/) shows how to read
both.

To turn off background work, for example from a setting in your app, call
[`puter.events.unsubscribe(subId)`](/Events/unsubscribe/) with the `subId` from
`findSubscription()`.

## Notes

- Handler runs are billed to the user as worker usage, on top of the cost per
  event, under the [User-Pays Model](/user-pays-model/).
- Skipped events still run the handler, so they're billed and count toward the
  60-a-minute limit. For example, every save to a file that's already in
  `Inbox` is one run.
- A new folder in `Inbox` also arrives as an `add`. Use
  `user.fs.stat({ uid: event.uid })` if you only want files. Dragging a folder
  in sends one `move` for the folder and nothing for the files inside it, so
  list it with `user.fs.readdir()` if you need those.
- `user` in the events worker is valid for 15 minutes, so don't hold on to it
  after the run.
- The first run after publishing, or after a quiet period, is a bit slower
  while the events worker starts up.
- Guest accounts can't create persistent subscriptions. `onPersistent()` fails
  with `events_durable_requires_account`.
- [`puter.events.workers`](/Events/workers/) lists your apps' events workers
  and can remove the ones you don't need.
