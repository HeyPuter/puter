---
title: Run Code in the Background
description: "Learn how to run your own code with Puter.js events when a user's files change, even while your app is closed, like a webhook or a background job."
tags: [events, fs, kv]
order: 68
---

<div class="info">The Events API is in beta. Event shapes, limits, and behavior may change between releases.</div>

Some work should happen whether or not your app is open: record every file a
user adds to a folder, post to a chat when a report is saved, or process an
upload as soon as it lands. Elsewhere you would reach for a webhook, a
background job, or a cloud function that runs on upload.

With the [Events API](/Events/), you write that function once and publish it to
Puter. Each user's subscription then runs it when their data changes. Puter
runs it for you in your app's [events worker](/Events/workers/), a serverless
function that belongs to your app, so there is no server to keep running.

[Watch for Changes](/recipes/events-watch-for-changes/) covers subscriptions
that only last while the page is open. This recipe uses persistent
subscriptions, made with [`puter.events.onPersistent()`](/Events/onPersistent/).
They are saved on the user's account and keep going after the page closes.

## How the Pieces Fit

There are three parts:

- **The handler**: the function to run. You publish it once, as the app's
  developer, under a name.
- **The user's permission**: each user lets your app run code while they're
  not using it.
- **The subscription**: made once per user, from your app. It says what to
  watch and which handler to run.

The examples follow one app. Users upload files into the app's `Inbox` folder,
or drag them in on the Puter desktop, and a handler records each new file in
the app's [key-value store](/KV/), so the app can list them the next time it
opens.

## Publish the Handler

Publish with
[`puter.events.handlers.publish()`](/Events/handlers/). Publishing is a
developer task, like deploying: it only works for the account that owns the
app, so run it from a deploy script or your browser's console, never when a
user opens your app. For anyone else it rejects with `events_handler_forbidden`.

From [Node.js](/getting-started/), with your own auth token:

```js
import { init } from '@heyputer/puter.js/src/init.cjs';

const puter = init(process.env.puterAuthToken);
const app = await puter.apps.get('drop-box');    // your app's name

async function recordUpload ({ event, user }) {
    // Uploads and copies arrive as `add`. A file dragged in from another
    // folder arrives as a `move`, with no `from` because it came from outside.
    const arrived = event.op === 'add' || (event.op === 'move' && !event.from);
    if (!arrived) return;

    await user.kv.set(`uploads:${event.uid}`, {
        name: event.path.split('/').pop(),
        addedAt: event.ts,
    });
}

await puter.events.handlers.publish('recordUpload', recordUpload, { appUid: app.uid });
```

The handler is called with one object. The parts used here:

- `event`: what changed, in the [same shape](/Events/onLocal/#the-event) as
  with `onLocal()`. `event.uid` is the file's ID.
- `user`: a `puter` object signed in as the user who holds the subscription,
  with the same access your app has in their browser, such as `user.kv` and
  `user.fs`.

The handler doesn't run in your script. Puter saves its source code and runs it
later, somewhere else, as a serverless platform would. So it can't use anything
around it: no variables or functions from your file, and no `puter`. Everything
it uses has to be a parameter, something it declares itself, or a standard
global such as `fetch`, `JSON` or `Math`. `publish()` checks this before
sending anything, and rejects with `events_handler_free_variable` naming what
it couldn't find.

The handler also skips writes, removals and
[gaps](/recipes/events-watch-for-changes/#handle-gaps). A gap means some events
weren't delivered, so the app can compare the folder with what was recorded the
next time it opens. Skipped events still run the handler, so they are billed
and count toward the [limits below](#make-sure-every-file-gets-handled): each
save of a file already in `Inbox` is one run.

A new folder inside `Inbox` arrives as an `add` too. Check with
`user.fs.stat({ uid: event.uid })` if you only want files. Uploading or copying
a folder sends one `add` per file, but dragging a folder in sends a single
`move` for the folder and nothing for the files inside it. To record those,
list the folder with `user.fs.readdir()`.

## Ask the User for Permission

Running code while the user isn't there needs their permission. Ask from your
app with [`puter.perms.request()`](/Perms/request/):

```js
const allowed = await puter.perms.request('events:background');
```

It resolves to `true` or `false`. Puter remembers the answer and only shows the
prompt when the permission isn't granted yet. To find out without prompting,
for example to decide whether to show an "Enable background processing"
button, use `puter.perms.check('events:background')`.

Without this permission, `onPersistent()` rejects with
`events_background_consent_required`. The user can withdraw it later, which
stops your subscriptions for them. [Check on
Subscriptions](#check-on-subscriptions) covers that.

## Subscribe Once per User

Each `onPersistent()` call creates a new subscription, even with the same
options. Calling it every time the app opens piles up copies that each run the
handler for every event, until the user hits the limit of 25 per app on the
free plan (100 on a paid plan). So look for an existing one with
[`puter.events.list()`](/Events/list/) first:

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

Call `startBackgroundWork()` when the app opens, once the user has granted the
permission. `fs:<folder>` matches changes anywhere inside the folder.

- `mkdir()` makes sure the folder is there for the user to add files to, and
  returns the existing folder when there already is one.
- A subscription follows the folder it was made on, by its ID. If the user
  deletes `Inbox` on the Puter desktop, it goes to the Trash and the
  subscription goes with it. Comparing `anchor.uid`, the ID of the folder the
  subscription is attached to, with the folder `mkdir()` returned catches that,
  and the code subscribes again on the new folder.
- A subscription suspended for any reason other than `permission_revoked`
  starts again without your app doing anything, as described in [Check on
  Subscriptions](#check-on-subscriptions).

`list()` returns only your app's subscriptions, and gives each `subject` back
exactly as you passed it, so comparing the same string works. If two tabs open
at the same moment, both can create one. When `list()` finds more than one
match, keep one and unsubscribe the rest.

## Pass Settings to the Handler

The handler can't see your app's variables, so per-user settings travel with
the subscription as `context`. The handler receives them as `ctx`. Say the user
pasted a chat webhook URL into your app's settings. Add it to `options` before
calling `startBackgroundWork()`:

```js
options.context = { webhookUrl: settings.webhookUrl };
```

Then publish the handler again with the new code:

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

`context` is read once, when the subscription is created. When the user
changes the setting later, the existing subscription still has the old value,
so replace it:

```js
async function updateWebhook (webhookUrl) {
    options.context = { webhookUrl };
    const existing = await findSubscription();
    if (existing) await puter.events.unsubscribe(existing.subId);
    await puter.events.onPersistent(options);
}
```

This subscribes directly instead of calling `startBackgroundWork()`. `list()`
can lag a moment behind changes, so right after the unsubscribe it may still
show the old subscription.

- `context` holds up to 4 KB as JSON, and more rejects with
  `events_context_too_large`. For more, store the data with
  [`puter.kv`](/KV/) and read it in the handler with `user.kv.get()`.
- `list()` shows the names of the keys in `context`, never the values.

To stop a subscription at a set time, add `expiresAt` to `options`, as unix
seconds or an ISO date string. `Date.now()` is in milliseconds, which reads as
a date far in the future, so divide it by 1000:

```js
options.expiresAt = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;    // one week from now
```

## Don't Trigger Your Own Handler

If the handler writes into the folder it watches, that write is a new change,
and it runs the handler again. In the events worker, such a chain stops after 4
runs on the free plan and 12 on a paid plan. After that, nothing runs, and
nothing tells you it stopped.

Write results where the subscription doesn't look: a different folder, such as
`~/AppData/<app ID>/Processed` next to `Inbox`, or the key-value store, which
an `fs:` subject never matches.

## Make Sure Every File Gets Handled

By default, each event runs the handler once, on a best-effort basis. A run
that throws or takes longer than 30 seconds isn't retried. Past 60 runs a
minute for one user and app, further runs are skipped, so uploading 100 files
at once records only about 60 of them.

For work that has to happen for every file, add `delivery: 'single'` to
`options`. Each event is then kept until a run finishes without throwing. One
that throws is tried again after 2 seconds, then 4, 8 and so on, up to 5
minutes apart, and events over the per-minute limit wait instead of being
skipped:

```js
options.delivery = 'single';
options.targets = ['worker'];
```

`targets: ['worker']` sends each event straight to the events worker. Without
it, a `single` event is first offered to your app's open tabs. A tab only runs
the handler if it passed the function itself to `onPersistent()`, and
otherwise each try waits about a minute before the event moves on.

A subscription keeps the delivery it was created with. If users already have
the default kind, make `startBackgroundWork()` replace theirs by adding one
more check:

```js
const working = existing
    && existing.anchor.uid === folder.uid
    && existing.delivery === 'single'
    && existing.suspendedReason !== 'permission_revoked';
```

- **A run can repeat.** For example, a run that did its work but timed out is
  tried again, with the same `event.id`. Writing the same key-value entry
  twice does no harm, but posting to the chat twice sends two messages. To
  skip a repeat, record `event.id` after posting, and check for it before
  posting. A run that stops between posting and recording can still post
  twice, so expect "at least once", not "exactly once".
- **Refuse what can never work.** When retrying can't help, such as a file
  type you don't support, throw an error with `terminal: true`. The event is
  dropped instead of retried.
- **Five failures in a row stop the subscription**, refusals included. Puter
  tells you as the developer. Fix the handler and publish it again, and the
  subscription picks up where it stopped.
- `single` events cost the user $1 per million instead of $0.10. See [Rate
  Limits and Quotas](/rate-limits-and-quotas/#events).

The repeat check looks like this inside the handler. The marker expires after
a week, well after any retry, so the keys don't pile up:

```js
const postedKey = `posted:${event.id}`;
if (ctx.webhookUrl && !(await user.kv.get(postedKey))) {
    await fetch(ctx.webhookUrl, { /* as above */ });
    await user.kv.set(postedKey, true, Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60);
}
```

## Update the Handler

To change the code, publish again under the same name. Every subscription runs
the new code from its next event, and users don't have to do anything.

To keep two deploys from overwriting each other by accident, Puter only
replaces a handler when the SDK says which version it's replacing. The SDK
only knows that after listing or publishing in the same process, so a fresh
deploy script that publishes changed code rejects with
`events_handler_conflict`. Call `handlers.list()` first:

```js
await puter.events.handlers.list({ appUid: app.uid });
await puter.events.handlers.publish('recordUpload', recordUpload, { appUid: app.uid });
```

Publishing then rejects only if someone else published in between. Pass
`replace: true` to `publish()` to overwrite anyway. To roll back, publish the
old code.

Keep handler names stable. Subscriptions stay bound to the name they were made
with, so renaming a handler means every user's app has to subscribe again.

## Check on Subscriptions

A subscription can stop without being removed. It's then *suspended*, and
`list()` shows why in `suspendedReason`:

| `suspendedReason` | What happened | What to do |
| --- | --- | --- |
| `handler_not_found` | The handler was removed. | Publish it again. The subscription resumes. |
| `failures` | Five runs in a row failed (`single` only). | Fix the handler and publish it again. The subscription resumes. |
| `no_credit` | The user ran out of credit. | Nothing. It resumes once they top up. |
| `permission_revoked` | The user withdrew `events:background`, or lost access to what it watched. | Call `puter.perms.request()` again, then `startBackgroundWork()`. |

A suspended `single` subscription keeps up to 100 missed events for a while, 24
hours for the first two reasons and 1 hour for `no_credit`, and delivers them
when it resumes. A default one doesn't keep them.

A subscription can also end for good, for example when the folder it watches
is permanently deleted. It then disappears from `list()`, and
`startBackgroundWork()` creates a new one the next time the app opens. Puter
tells the user's app with an `app.events.ended` notification, and tells you as
the developer about suspended handlers with `app.events.suspended`. [Catch Up
on Notifications](/recipes/events-catch-up-on-notifications/) shows how to read
both.

To stop background work, for example from a switch in your app's settings, call
[`puter.events.unsubscribe(subId)`](/Events/unsubscribe/) with the `subId` from
`findSubscription()`.

## Notes

- Handler runs are billed to the user as worker usage, on top of the delivery
  cost, under the [User-Pays Model](/user-pays-model/).
- `user` inside the events worker is valid for 15 minutes, so don't keep it
  around after the run.
- The first run after a publish, or after a quiet period, takes a little longer
  while the events worker starts.
- Guest accounts that haven't signed up can't create persistent subscriptions.
  `onPersistent()` rejects with `events_durable_requires_account`.
- [`puter.events.workers`](/Events/workers/) lists your apps' events workers,
  and removes the ones you no longer need.
