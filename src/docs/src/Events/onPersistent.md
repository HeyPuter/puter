---
title: puter.events.onPersistent()
description: Subscribe to changes with a subscription that keeps running when your app is closed.
platforms: [websites, apps, nodejs, workers]
---

<div class="info">The Events API is in beta. Event shapes, limits, and behavior may change between releases.</div>

Creates a subscription that outlives this connection. It's stored on the account, keeps matching while your app is closed, and runs a handler in an [events worker](/Events/workers/). The handler is either inline code you pass as `handler`, which is published into the signed-in user's own [user scope](/Events/handlers/#user-scope) of your app, or a handler published under a name with [`puter.events.handlers.publish()`](/Events/handlers/). Each event also reaches every connected client. Compare [`puter.events.onLocal()`](/Events/onLocal/), which ends with the page.

The subscription is live right away in the region where it was created. Right after this call resolves, changes made in other regions can take a moment longer to reach it, usually well under a second.

See [Subjects and events](/Events/subjects/) for the subject syntax and the event shape.

On a website with nobody signed in, it asks the user to sign in first, as other Puter.js calls do. An app running on Puter is always signed in.

## Syntax
```js
puter.events.onPersistent(options)
```

## Parameters

#### `options` (Object) (required)

- `subject` (String) (required): What to watch, in the same form [`onLocal()`](/Events/onLocal/) takes, such as `fs:~/Documents` or `kv:<handle>:*`.
- `handlerName` (String): The published handler to run in an [events worker](/Events/workers/). Up to 128 characters. A subscription made outside an app has no events worker, so its handler runs only in connected clients.
- `handlerScope` (String): Where `handlerName` is looked up, `'app'` or `'user'`. Defaults to `'app'`, the handlers the app's owner published. `'user'` binds to a handler in the signed-in user's own scope, published with `handlers.publish(name, handler, { scope: 'user' })`.
- `queue` (Boolean): Handles events like a work queue. Each event goes to one consumer at a time, and it's offered again if a run never finishes or hits a temporary error. Requires `handlerName` or an inline `handler`. Defaults to `false`. See [Choosing a mode](#choosing-a-mode).
- `handler` (Function | String | Object): The handler code, as a function, a source string, or `{ file: '~/AppData/…/handler.js' }`. Without `handlerName`, the source is sent and published into the signed-in user's own user scope, and it runs for this user's events only. With `handlerName`, only its hash is sent, and the subscription is created only if it matches what's published under that name. A function also runs in this client for each delivery it receives (see [Where the handler runs](#where-the-handler-runs)).
- `context` (Object): Values the handler needs, passed to it as a frozen `ctx`. Up to 4 KB serialized. See [Context is captured once](#context-is-captured-once-up-to-4-kb).
- `expiresAt` (Number | String): When the subscription ends on its own, as unix seconds or an ISO-8601 string. Must be in the future.
- `includeValue` (Boolean): For a `kv:` subject, include the key's new value as `event.value`. See [Getting the new value](/Events/subjects/#getting-the-new-value) for when it's left out. Other subjects are refused with `invalid_include_value`.
- `onError` (Function): Called with `{ message, code }` when this client stops running `handler` because its connection can't be restored (`reauth_required` after a sign-out, `events_connection_failed` otherwise). The subscription itself keeps going in the events worker, and this client takes deliveries again once it reconnects. Only used with a function `handler`. Without it, the stop is logged to the console.
- `delivery` (String): Deprecated. Use `queue` instead. The value `'single'` is the same as `queue: true`, and `'broadcast'` is the default.
- `targets` (Array): Deprecated and ignored.

## Background delivery needs consent

Running your handler while the user isn't there needs its own per-app permission, `events:background`. When an app subscribes with a `handlerName` or an inline `handler` without it, the call fails with `events_background_consent_required`. To ask for it, call [`puter.perms.request()`](/Perms/request/) with the `'backgroundEvents'` resource:

```js
await puter.perms.request('backgroundEvents');
```

A subscription with neither a `handlerName` nor an inline `handler` runs nothing in the background and needs no consent.

Background handlers run as a worker session for your app, which appears in the user's sessions list. Revoking that session invalidates the `user` token a run holds, and the next delivery starts a new session. Withdrawing `events:background`, uninstalling the app, destroying its events worker, or deleting the app also stops background deliveries. What happens to the subscriptions depends on which one it was:

- **Withdrawing `events:background`** suspends every subscription with a handler the app holds for that user, with `permission_revoked`.
- **Uninstalling the app** suspends every subscription the app holds for that user, with `permission_revoked`.
- **Destroying the events worker** suspends its subscriptions with `handler_not_found`. Publishing the handlers again resumes them. Destroying a user scope does the same for the handlers in it, including inline ones, which resume when you publish the same code again.
- **Deleting the app** deletes its subscriptions and handlers.

A subscription suspended with `permission_revoked` doesn't resume when access is granted again. Subscribe again instead.

## Choosing a mode

| | Who gets each event | If a run fails |
|---|---|---|
| [`onLocal()`](/Events/onLocal/) | Clients connected right now | Gone. Nothing is kept while disconnected. |
| `onPersistent()` | The events worker, even with the app closed, plus every connected client | Gone. Each place gets one attempt. |
| `onPersistent({ queue: true })` | One consumer at a time, a connected client first and then the events worker | Offered again if the run never finished or hit a network or other temporary error. |

- **[`onLocal()`](/Events/onLocal/)** is live and best effort. Use it to update the page while it's open.
- **`onPersistent()`** runs your handler in the events worker for every event, even when your app is closed, and also sends the event to every connected client. Use it to react to every change, such as keeping an index or a notification up to date.
- **`onPersistent({ queue: true })`** hands each event to one consumer at a time and retries it when the run never finished or failed for a temporary reason. Use it for work that has to finish, such as processing every uploaded file or calling a webhook.

Queue subscriptions skip the 250 ms coalescing window, so quick changes stay separate. A queued event comes back only on a retry or a lost answer, with the same `event.id`, so check that id before doing work twice.

## Where the handler runs

Without `queue`, every event runs the handler in each place that's listening:

- An [events worker](/Events/workers/) runs the handler named by `handlerName`, or the inline `handler`, whether or not a client is open. It skips a run when the server has no worker runtime, or when the [handler-run limit](/rate-limits-and-quotas/#events) for this user and app is used up for the minute.
- Every connected client that passed a function `handler` runs it too. Every [`onLocal()`](/Events/onLocal/) subscription that matches the change gets the event as well.

With `queue: true`, a connected client that passed a function `handler` gets the first try. If no client has one, or its run fails, the events worker takes the event right away. A client that doesn't answer within 15 seconds loses the event to the events worker, so keep client handlers short. If the user has your app open in several tabs, each tab that passed a function `handler` gets the event, so keep side effects that must happen once in the worker handler.

Only a function `handler` runs in this client. A source string or `{ file }` is only published, or hashed to check it against `handlerName`. The connection reconnects on its own when it drops, so this client keeps taking deliveries unless `onError` is called.

Wherever it runs, the handler is the same code, called with:

| Binding | What it is |
| --- | --- |
| `event` | The [event](/Events/subjects/#the-event), or a [gap marker](/Events/subjects/#gaps). |
| `ctx` | The frozen `context` this subscription was created with. |
| `user` | A `puter` bound to the account holding the subscription, with the same access your app has for that user in a tab. In a client, it's the page's own `puter`. |
| `fetch` | In a client, [`puter.net.fetch()`](/Networking/fetch/) where it exists, otherwise the environment's `fetch`. In the events worker, the environment's native `fetch`. |
| `ack` | On a `queue` subscription only. Optional, see [What happens when a handler fails](#what-happens-when-a-handler-fails). |

Those five bindings are the handler's whole environment. The events worker has no global `puter`, so a handler that names `puter` or `me` is refused when you publish it. Use `user` instead. In the events worker, `user` is valid for 15 minutes, so don't keep it past the run.

### Handlers that trigger handlers

In the events worker, a write made through `user`, or through a token `user` creates, is one run deeper than the event the handler ran for, and it can run handlers of its own, including this one. A handler can't create a worker through `user.workers.create` to get around this. That call is refused. A chain stops at 12 runs on a paid plan and 4 on a free one, by the plan of the account holding the subscription.

An event past that runs no handler in the events worker. Without `queue`, it still reaches connected clients, which don't run the handler for it. A queued event is still offered to a connected client first and runs there. The dropped run leaves no gap marker and doesn't count as a failure. Writes made anywhere else, including from a handler running in a client, start a new chain. See [handler chains](/rate-limits-and-quotas/#handler-chains).

### What happens when a handler fails

These rules apply to a `queue` subscription, in a client or in the events worker:

| The handler | Result |
| --- | --- |
| Resolves | Done. |
| Throws | The event is dropped and replaced by a [gap marker](/Events/subjects/#gaps) with `reason: 'handler_rejected'`. It counts as a failure. |
| Throws a temporary error, meaning a network error, a timeout, a rate limit (`429`), a `5xx`, or any error with `retry: true` | Retried after 2 seconds, then 4, 8 and so on, up to 5 minutes apart. It counts as a failure. |
| Runs past 30 seconds in the events worker | Retried on the same schedule. It counts as a failure. |
| Never answers in a client, because the tab closed or the connection dropped | Offered again. |

To have an error retried, throw it with `retry: true`:

```js
throw Object.assign(new Error('Service busy, try later'), { retry: true });
```

In the events worker, a run that fails because of Puter doesn't count as a failure. That covers a run Puter couldn't start or finish, and a handler that throws after a call it made through `user` got a `5xx`, a `429`, or a network error from Puter. It's retried on the same schedule, and waits longer if Puter's answer asked for a longer wait, up to 5 minutes. To drop the event in that case anyway, throw an error with `terminal: true`.

Five failures in a row suspend the subscription with `failures`, and publishing the handler again resumes it.

Without `queue`, a failed run is never retried.

In a connected client, a handler can call `ack()` to mark the event done before it finishes. In the events worker, `ack()` prevents a later throw from rejecting the delivery, but the answer waits until the handler finishes. It doesn't prevent a timeout or a lost answer from causing a retry.

## Context is captured once, up to 4 KB

A handler can't use outside variables (see [`puter.events.handlers`](/Events/handlers/)), so `context` is how values reach it. It's evaluated once, at this call. Below, `ctx.endpoint` stays whatever `process.env.INGEST_URL` was when you subscribed, until you change it with [`puter.events.update()`](/Events/update/):

```js
await puter.events.onPersistent({
    subject: 'fs:~/inbox',
    handlerName: 'ingestUpload',
    context: { endpoint: process.env.INGEST_URL, apiKey: process.env.INGEST_KEY },
});
```

Over 4 KB serialized, the call fails with `events_context_too_large` before any request is made. Context is stored in plaintext and only read when delivering. [`puter.events.list()`](/Events/list/) returns its key names and a hash, never the values. For more than 4 KB, put the data in a file and pass the path in `context`.

## Suspended subscriptions

A persistent subscription can stop without being unsubscribed. It's then suspended, not deleted, and [`list()`](/Events/list/) shows `suspendedAt` and `suspendedReason`:

| `suspendedReason` | Cause | Resumes when |
| --- | --- | --- |
| `handler_not_found` | Its handler was removed. | A handler is published under that name again. |
| `failures` | Its handler failed 5 times in a row. | The handler is published again. |
| `no_credit` | Its holder ran out of credit. | The balance is topped up (checked every few minutes). |
| `permission_revoked` | The permission or share it relied on was withdrawn. | Never. Subscribe again. |

A suspended subscription stops delivering and isn't billed. Its backlog is cut to 100 deliveries and kept for 24 hours (`handler_not_found`, `failures`) or 1 hour (`no_credit`), then replaced by one gap marker. A `permission_revoked` backlog is dropped right away. Suspended subscriptions are deleted after 30 days.

The app's developer gets an `app.events.suspended` notification for `handler_not_found` and `failures` on a handler in the app's scope. The holder gets an `app.events.handler_suspended` notification instead when a subscription bound to a handler in their own user scope is suspended, and the developer isn't told. That covers the handler being removed, including by the holder with `handlers.remove()` or `workers.destroy()`, five failures in a row, and a delivery that finds the handler missing. The holder also gets an `app.events.ended` notification on `notif:app-user` for `no_credit` and `permission_revoked`. Both can be read with [`fetch()`](/Events/fetch/).

A subscription suspended for a reason that can resume still counts toward your [persistent subscription limit](/rate-limits-and-quotas/#what-an-account-can-hold) until you unsubscribe it. One suspended with `permission_revoked` doesn't count. An account keeps at most 500 of those, and past that, subscribing again deletes the oldest ones.

## Delivery guarantees

Clients connect to the nearest region. Events reach a client wherever it's connected.

- Without `queue`, an event runs the handler in the events worker and in each connected client that passed a function `handler`. A run that fails or happens while nothing is connected isn't retried.
- `queue` deliveries are at-least-once. An event whose run never finished, or failed with a temporary error, arrives again with the same `event.id`.
- Undelivered events are held in the region where the change happened. If that region goes down, only what it was holding is lost.
- Order is kept within a region and is best effort across regions. Without `queue`, coalescing (250 ms) also runs per region, so two quick writes can arrive as one event nearby and as two farther away.

## Return value

A `Promise` that resolves to the subscription:

- `subId` (String): Its id, which [`puter.events.update()`](/Events/update/) and [`puter.events.unsubscribe()`](/Events/unsubscribe/) take. It never changes.
- `subject` (String): For `kv:` and `notif:`, the subject in full form, so `kv:cart` comes back as `kv:<appId>:cart`. For `fs:`, as you passed it, except a relative path comes back resolved the same way [`onLocal()`](/Events/onLocal/) returns it.
- `anchor`, `match`, `op`: As [`onLocal()`](/Events/onLocal/#return-value) returns them.
- `queue` (Boolean), `handlerName` (String | null), `includeValue` (Boolean). An inline handler comes back as its server-assigned `handlerName`, which starts with `@`.
- `handlerScope` (String): `'user'` when the subscription is bound to a handler in the user's own scope. Absent otherwise.
- `appUid` (String | null): The app that created it, or `null` if it was created outside an app.
- `contextKeys` (Array | null), `contextHash` (String | null): The key names and a hash of the stored context, never its values.
- `createdAt`, `expiresAt` (Number | null): Unix seconds.
- `suspendedAt` (Number | null), `suspendedReason` (String | null): Set when the subscription is [suspended](#suspended-subscriptions).
- `off()` (Function): Ends the subscription and stops running its handler here. Same as [`puter.events.unsubscribe(subId)`](/Events/unsubscribe/).

The promise rejects with `{ message, code }`:

| `code` | Meaning |
| --- | --- |
| `events_handler_conflict` | The inline handler couldn't be confirmed after a concurrent publish. Try again. |
| `events_handler_hash_mismatch` | The published handler isn't the source passed as `handler`. |
| `events_handler_not_found` | Nothing is published under `handlerName` in that scope, or source was supplied to check a named handler outside an app. |
| `events_handler_hash_unavailable` | This environment has no `crypto.subtle`, so `handler` can't be hashed. Pass `handlerName` alone. |
| `events_handler_invalid` | `handler` isn't a function, a nonempty source string, or `{ file }`. |
| `invalid_subject` | The subject is empty, not a string, or can't be parsed, or it's a `notif:` subject and this server has notification events turned off. |
| `auth_canceled` | Nobody was signed in, and the user closed the sign-in without finishing it. |
| `events_user_handlers_disabled` | Publishing into a user scope isn't turned on for this server. |
| `events_handler_forbidden` | The call can't publish into a user scope: it came from a scoped access token, a temporary account, or on behalf of a different app. |
| `insufficient_funds` | Publishing into a user scope needs credit on a hosted Puter server, and the user has none. Arrives as HTTP 402. |
| `forbidden` | The user already holds as many [worker units](/rate-limits-and-quotas/#worker-units) as their plan allows, so a new user scope can't be created. |
| `events_handler_limit` | The user scope already holds the [maximum number of handlers](/rate-limits-and-quotas/#handlers). |
| `events_handler_too_large` | The handler is over 64 KB. |
| `events_worker_too_large` | The user scope's handlers would exceed 1 MB combined. |
| `events_handler_name_invalid` | `handlerName` has characters that aren't allowed, or starts with `@`, which is reserved for inline handlers. |
| `events_handler_free_variable` | The handler uses an outside variable. The message names it. |
| `events_handler_invalid` | `handler` isn't a function, a source string, or `{ file }`. |
| `events_handler_hash_unavailable` | This environment has no `crypto.subtle`, so `handler` can't be hashed. Pass `handlerName` alone. |
| `events_handler_not_found` | Nothing is published under `handlerName` in that scope of this app. |
| `events_handler_hash_mismatch` | The published handler isn't the source you passed as `handler`. |
| `events_handler_required` | `queue: true` without a `handlerName` or an inline `handler`. |
| `events_background_consent_required` | An app subscribed with a handler, and the user hasn't granted `events:background`. |
| `events_context_too_large` | The serialized `context` is over 4 KB. |
| `events_context_invalid` | `context` isn't JSON-serializable. |
| `bad_request` | `queue` isn't a boolean, `delivery` isn't `'broadcast'` or `'single'`, the two disagree, or `handlerName` isn't a string or is over 128 characters. |
| `invalid_expires_at` | `expiresAt` isn't a future time. |
| `invalid_include_value` | `includeValue` isn't a boolean, or the subject isn't `kv:`. |
| `invalid_subject_op`, `invalid_subject_audience`, `invalid_subject_pattern`, `invalid_kv_pattern`, `invalid_kv_handle_key`, `events_cross_app_disabled`, `events_kv_handles_disabled`, `forbidden` | As on [`onLocal()`](/Events/onLocal/#return-value). |
| `subject_does_not_exist` | The subject doesn't exist, or this account can't read it. |
| `events_subscription_limit` | The account or app is at its [persistent subscription limit](/rate-limits-and-quotas/#events). |
| `events_value_too_large` | A field is longer than can be stored, such as an app id over 40 characters. |
| `events_durable_requires_account` | Temporary (anonymous) accounts only get session subscriptions. Scoped access tokens, such as the one in a [`getReadURL()`](/FS/getReadURL/) URL, get no persistent subscriptions either, whether the account or an app created them. |
| `too_many_requests` | Over the subscribe rate limit. |
| `events_disabled` | Events aren't enabled on this server. |
| `events_failed` | The server sent a response the SDK couldn't read. |

With a `{ file }` handler, errors from [`puter.fs.read()`](/FS/read/) also pass through.

## Examples

The first example is the inline form, which any app can use for the signed-in user. The others bind to a handler the app's owner published, so they run in your own app or from Node.js signed in as its developer.

<strong class="example-title">Watch a folder with an inline handler</strong>

```js
await puter.perms.request('backgroundEvents');
const sub = await puter.events.onPersistent({
    subject: 'fs:~/inbox',
    handler: async ({ event, ctx }) => {
        await fetch(ctx.webhook, { method: 'POST', body: event.path });
    },
    context: { webhook: 'https://example.com/ingest' },
});

// It outlives the page. End it when it's no longer needed.
await puter.events.unsubscribe(sub.subId);
```

The handler is stored in the user's scope under `sub.handlerName`, and keeps running for this user until the subscription ends. After the subscription ends, Puter removes the handler about a day later, once nothing is bound to it. You can remove it sooner, as [Clean Up Background Work](/recipes/clean-up-background-work/#remove-a-user-scope) shows.

<strong class="example-title">Watch a folder with a handler the app's owner published</strong>

Publish once as the developer to ship one shared handler to every user.

```js
// Once, as the app's developer
await puter.events.handlers.publish('ingestUpload', async ({ event, ctx }) => {
    await fetch(ctx.endpoint, {
        method: 'POST',
        body: JSON.stringify({ path: event.path, key: ctx.apiKey }),
    });
});

// In your app, for each user. `context` is read now and never again.
await puter.perms.request('backgroundEvents');
const sub = await puter.events.onPersistent({
    subject: 'fs:inbox',
    handlerName: 'ingestUpload',
    context: { endpoint: 'https://example.com/ingest', apiKey: 'k-123' },
});

// It outlives the page. End it when it's no longer needed.
await puter.events.unsubscribe(sub.subId);
```

<strong class="example-title">Bind to the exact source you wrote against</strong>

```js
const handler = ({ event, ctx }) => console.log(ctx.label, event.path);
await puter.events.handlers.publish('onWrite', handler);

// Passing the function sends its hash. If someone published different
// source under `onWrite` in the meantime, this fails with
// events_handler_hash_mismatch instead of binding you to code you never saw.
const sub = await puter.events.onPersistent({
    subject: 'fs:inbox',
    handlerName: 'onWrite',
    handler,
    context: { label: 'inbox' },
});
```
