---
title: puter.events.handlers
description: Publish, list and remove the named handlers that persistent subscriptions and schedules run, for an app or for one user.
platforms: [websites, apps, nodejs, workers]
---

<div class="info">The Events API is in beta. Event shapes, limits, and behavior may change between releases.</div>

A **handler** is a function that [persistent subscriptions](/Events/onPersistent/) and [schedules](/Events/onSchedule/) run in the background. A handler runs only when a subscription bound to it has a delivery, or a schedule bound to it is due. Nothing else can trigger it.

A handler lives in one of two scopes:

- **App scope.** The handler belongs to the app, and every user's subscriptions and schedules can bind to it by name. Only the app's owner can publish, list, and remove these. Inside an app, including a website using Puter.js, these calls act on that app, and work only while the signed-in user owns it. Outside an app, such as in Node.js with your account token, name the app with `appUid`.
- **User scope.** The handler belongs to one user in one app, and only that user's subscriptions and schedules can bind to it. Any signed-in user's session of the app can publish, list, and remove these, with `scope: 'user'`. See [User scope](#user-scope).

You don't have to publish a handler to use one. Pass it inline as `handler` to [`onSchedule()`](/Events/onSchedule/) or [`onPersistent()`](/Events/onPersistent/) without a `handlerName`, and it's published into the signed-in user's scope for you.

On a website with nobody signed in, each method asks the user to sign in first, as other Puter.js calls do. An app running on Puter is always signed in.

```js
await puter.events.handlers.publish('ingestUpload', async ({ event, ctx }) => {
    await fetch(ctx.endpoint, { method: 'POST', body: event.path });
}, { appUid });

await puter.events.handlers.list({ appUid });     // [{ name, hash, updatedAt, subscriptions }]
await puter.events.handlers.remove('ingestUpload', { appUid });
```

## User scope

A user scope holds the handlers one user has published in one app. Nobody else can publish into it, list it, or remove from it, including the app's owner.

An inline `handler` without a `handlerName` is published into the scope for you, under a name Puter chooses that starts with `@`, which is reserved for these. The name is derived from the code, so the same code is one handler, and changing the code makes a new one. Subscriptions and schedules keep running the code they were created with.

To ship a new version to existing subscriptions and schedules, publish a named handler into the scope and bind to it with `handlerName` and `handlerScope: 'user'`. Publishing the name again moves every one of them to the new code:

```js
await puter.events.handlers.publish('digest', async ({ ctx, user }) => {
    await user.notifications.notify({ title: ctx.title });
}, { scope: 'user' });

await puter.events.onSchedule({
    cron: '0 8 * * 1-5',
    handlerName: 'digest',
    handlerScope: 'user',
    context: { title: 'Good morning' },
});
```

Handlers in a user scope:

- Are published only from an app acting for a signed-in user, never from a scoped access token or a temporary (guest) account, and only into that app's scope.
- Are billed to the user like their own workers. A hosted Puter server may bill each user scope as a monthly cost, and publishing into one needs credit. Listing and removing don't.
- Count toward the user's [worker units](/rate-limits-and-quotas/#worker-units), as one unit per app. A user over their plan's limit keeps what they hold, and can't create a new scope.
- Are limited to 20 handlers and 1 MB of source combined per scope, and 10 deploys an hour. See [Rate Limits and Quotas](/rate-limits-and-quotas/#handlers).
- Clean themselves up. Once no subscription or schedule, in any state, is bound to a handler and it's more than a day old, Puter removes it. This covers inline handlers and named ones. A scope with no handlers left stops counting as a worker unit.
- Suspend like any other handler. The user gets an `app.events.handler_suspended` notification, and the developer isn't told, when a subscription or schedule bound to one is suspended because the handler was removed (including by the user, with `remove()` or `workers.destroy()`), because it failed 5 times in a row, or because a delivery found the handler missing. Publishing the name again resumes them.

The server may turn user-scope handlers off, and then publishing into one fails with `events_user_handlers_disabled`. To remove a whole scope, see [`workers.destroy()`](/Events/workers/).

## Handlers can't use outside variables

A handler is serialized with `Function.prototype.toString()` and run later, somewhere else, so nothing around the function comes with it.

Every identifier a handler uses must be a parameter, something the handler declares itself, a standard global (`fetch`, `JSON`, `Math`, `console`, `URL`, `crypto`, …), or a value reached through `ctx`. The global `puter` isn't available in the [events worker](/Events/workers/). Use the `user` binding, which has the same access your app has for that user in a tab. The SDK checks this before sending, and Puter checks it again when the handler is published. Either one rejects with `events_handler_free_variable`, naming the identifier:

```js
const endpoint = 'https://example.com/ingest';

// Rejected: `endpoint` isn't a parameter, a local, or a known global.
await puter.events.handlers.publish('ingestUpload', ({ event }) => fetch(endpoint), { appUid });

// Accepted: the value travels with the subscription, not with the code.
await puter.events.handlers.publish('ingestUpload', ({ event, ctx }) => fetch(ctx.endpoint), { appUid });
await puter.events.onPersistent({ subject: 'fs:~/inbox', handlerName: 'ingestUpload', context: { endpoint } });
```

An identifier the check can't resolve is refused when you publish, instead of failing on the first delivery.

## What a handler is called with

A handler gets one object. Which `event` it carries depends on what ran it:

- **A subscription delivery** carries the change that happened, in the shape [Subjects and events](/Events/subjects/#the-event) describes, or a [gap marker](/Events/subjects/#gaps).
- **A schedule run** carries `op: 'tick'`, the `scheduleId`, and the `scheduledFor` time the run is for, as [`onSchedule()`](/Events/onSchedule/#the-event) describes.

The other bindings are the same for both: `ctx`, `user` and `fetch`, plus `ack` on a `queue` subscription. See [Where the handler runs](/Events/onPersistent/#where-the-handler-runs). One handler can serve both, and tell them apart by `event.op`.

Schedule runs and `queue` deliveries are at-least-once. A retry, or a handler still running past its 30 seconds when the retry starts, can run the same event twice, and even at the same time. Both attempts have the same `event.id`, so record it once the work is done and skip ids you've already handled.

## `publish()`

```js
puter.events.handlers.publish(name, handler)
puter.events.handlers.publish(name, handler, options)
```

- `name` (String) (required): The name subscriptions bind to. Letters, digits, and `_ . : -`, starting with a letter or digit, up to 128 characters. Unique within the app.
- `handler` (Function | String | Object) (required): A function (serialized with `toString()`), a source string, or `{ file: '~/AppData/…/handler.js' }`. A file is read at this call, so later edits to it take effect only when you publish again.
- `options.replace` (Boolean): Overwrite whatever is published under the name.
- `options.scope` (String): `'app'` or `'user'`. Defaults to `'app'`. `'user'` publishes into the signed-in user's own [user scope](#user-scope) of the app.
- `options.appUid` (String): The app to publish into. Required outside an app. Inside an app, it can only name that app. With `scope: 'user'` it can only name the app making the call, and needs no value. Only [`workers.destroy()`](/Events/workers/) can name another app for a user scope, from an account session.

Resolves to `{ name, hash, updatedAt, outcome, resumed }`. Its `outcome` is `'created'`, `'updated'`, or `'unchanged'` (the same source was already published), and `resumed` counts the suspended subscriptions this publish brought back.

### Concurrent publishes

Publishing the same source again does nothing. Publishing different source updates the handler, but only if you know what you're replacing.

The SDK remembers the hash it last saw for each name and sends it with the publish. If someone else published in between, the publish fails with `events_handler_conflict`. Pass `replace: true` to overwrite anyway. A client that has never published or listed the name sends no hash, so it can only create the name or publish the same source again.

## `publishAll()`

```js
puter.events.handlers.publishAll(handlers)
puter.events.handlers.publishAll(handlers, options)
```

Publishes a set in one call, for build steps. Pass `handlers` as an array of up to 50 `{ name, handler, replace? }`, published in order. The `options.appUid` and `options.scope` options work as they do for `publish()`. If one is refused, publishing stops there. Earlier items stay published, and the error says where it stopped.

Resolves to an array of `publish()` results.

## `list()`

```js
puter.events.handlers.list()
puter.events.handlers.list(options)
```

Resolves to `[{ name, hash, updatedAt, subscriptions }]` for every handler the app, or the user's scope with `scope: 'user'`, has published, sorted by name. Each `subscriptions` count includes the subscriptions and schedules bound to that name, suspended ones included. The `options.appUid` and `options.scope` options work as they do for `publish()`.

The source is never returned.

## `remove()`

```js
puter.events.handlers.remove(name)
puter.events.handlers.remove(name, options)
```

Resolves to `{ name, removed, suspended }`, where `removed` is `false` when nothing was published under the name. The `options.appUid` and `options.scope` options work as they do for `publish()`.

| Situation | What happens |
| --- | --- |
| No subscriptions or schedules use the name | The handler is deleted. |
| Subscriptions or schedules use it | The handler is deleted, and its subscriptions and schedules are suspended with `suspendedReason: 'handler_not_found'`, not deleted. The app's developer gets an `app.events.suspended` notification. For a handler in a user scope, the user gets an `app.events.handler_suspended` notification instead. |

Publishing the name again resumes them, with the same ids and context. This is how you recover from a bad deploy. A resumed schedule runs at its next slot, and doesn't make up the runs it missed.

To rename a handler, publish the new name and remove the old one. Subscriptions and schedules don't follow the rename. Users have to subscribe again, so their subscriptions never switch to different code without them knowing.

An app's first published handler creates its [events worker](/Events/workers/), and removing the last one takes it down. A user scope works the same way: its first handler creates it, and removing its last one removes the scope.

## Failed runs

A handler that throws on a `queue` subscription drops the event, unless the error is temporary or thrown with `retry: true`. See [What happens when a handler fails](/Events/onPersistent/#what-happens-when-a-handler-fails) for the outcomes and the retry schedule, and [Suspended subscriptions](/Events/onPersistent/#suspended-subscriptions) for what happens after repeated failures.

## Errors

All four methods reject with `{ message, code }`:

| `code` | Meaning |
| --- | --- |
| `auth_canceled` | Nobody was signed in, and the user closed the sign-in without finishing it. |
| `events_handler_free_variable` | The handler uses an outside variable. The message names it. |
| `events_handler_invalid` | `handler` isn't a function, a source string, or `{ file }`. |
| `events_handler_name_invalid` | The name is empty, too long, or has characters that aren't allowed. Names starting with `@` are reserved for inline handlers. |
| `events_handler_conflict` | Someone else published different source under this name since you last saw it. Pass `replace: true` to overwrite. |
| `events_handler_app_required` | The call was made outside an app without `appUid`. |
| `events_handler_forbidden` | For app scope, the signed-in user doesn't own the app, the app doesn't exist, `appUid` names a different app than the one making the call, or the caller is a scoped access token. For `scope: 'user'`, publishing, listing and removing need an app acting for a signed-in user, so the caller was a scoped access token, a temporary account, or a different app. [`workers.destroy()`](/Events/workers/) also accepts an account session. |
| `events_user_handlers_disabled` | `scope: 'user'` was used to publish, and this server doesn't have user-scope handlers turned on. |
| `insufficient_funds` | Publishing into a user scope needs credit on a hosted Puter server, and the user has none. Arrives as HTTP 402. |
| `forbidden` | The user already holds as many [worker units](/rate-limits-and-quotas/#worker-units) as their plan allows, so a new user scope can't be created. |
| `events_handler_too_large` | The handler is over 64 KB. |
| `events_worker_too_large` | The app's handlers would exceed 5 MB combined, or a user scope's would exceed 1 MB. |
| `events_handler_source_invalid` | The handler source is empty. |
| `events_handler_limit` | The app, or the user scope, already has the [maximum number of handlers](/rate-limits-and-quotas/#handlers). |
| `invalid_request` | `publishAll()` got something other than a non-empty array. |
| `too_many_requests` | Over the publish and remove rate limit. |
| `events_disabled` | Events aren't enabled on this server. |
| `events_failed` | The server sent a response the SDK couldn't read. |

## Examples

The first example publishes into a user scope from inside an app, for the signed-in user. The others run in Node.js signed in with your account token, and `appUid` names an app you own. Inside your own app, leave out `appUid`.

<strong class="example-title">Publish into the user's scope, list it, then remove it</strong>

```js
const published = await puter.events.handlers.publish(
    'digest',
    async ({ ctx, user }) => {
        await user.notifications.notify({ title: ctx.title });
    },
    { scope: 'user' },
);
console.log(published.outcome);

for (const handler of await puter.events.handlers.list({ scope: 'user' })) {
    console.log(`${handler.name}: ${handler.subscriptions} bound`);
}

await puter.events.handlers.remove('digest', { scope: 'user' });
```

<strong class="example-title">Publish a handler, list it, then remove it</strong>

```js
const published = await puter.events.handlers.publish(
    'ingestUpload',
    async ({ event, ctx }) => {
        await fetch(ctx.endpoint, { method: 'POST', body: event.path });
    },
    { appUid },
);
console.log(published.outcome);   // 'created', or 'unchanged' if it was already published

for (const handler of await puter.events.handlers.list({ appUid })) {
    console.log(`${handler.name}: ${handler.subscriptions} subscription(s)`);
}

// With nothing bound to it, the handler is deleted outright.
const removed = await puter.events.handlers.remove('ingestUpload', { appUid });
console.log(removed.removed, removed.suspended);
```

<strong class="example-title">Deploy a whole set from a build step</strong>

```js
const published = await puter.events.handlers.publishAll([
    {
        name: 'ingestUpload',
        handler: ({ event, ctx }) => fetch(ctx.ingest, { method: 'POST', body: event.path }),
    },
    {
        name: 'indexDocument',
        handler: ({ event, ctx }) => fetch(ctx.index, { method: 'POST', body: event.uid }),
    },
], { appUid });

for (const handler of published) {
    console.log(`${handler.name}: ${handler.outcome}`);
}
```
