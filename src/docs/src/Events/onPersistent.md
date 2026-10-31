---
title: puter.events.onPersistent()
description: Subscribe to changes with a subscription that keeps running when your app is closed.
platforms: [websites, apps, nodejs, workers]
---

<div class="info">The Events API is in beta. Event shapes, limits, and behavior may change between releases.</div>

Creates a subscription that outlives this connection. It's stored on the account, keeps matching while your app is closed, and runs a handler your app published with [`puter.events.handlers.publish()`](/Events/handlers/). Each event also reaches every connected client. Compare [`puter.events.onLocal()`](/Events/onLocal/), which ends with the page.

The subscription is live immediately in the region where it was created. Changes made in other regions can take a moment longer (usually well under a second) to reach it right after this call resolves.

See [Subjects and events](/Events/subjects/) for the subject syntax and the event shape.

On a website with nobody signed in, it asks the user to sign in first, as other Puter.js calls do. An app running on Puter is always signed in.

## Syntax
```js
puter.events.onPersistent(options)
```

## Parameters

#### `options` (Object) (required)

- `subject` (String) (required): What to watch, in the same form `onLocal()` takes, e.g. `fs:~/Documents` or `fs:~/inbox/*.json:add`.
- `queue` (Boolean): Handles events like a work queue. Each event goes to one consumer at a time, and it's offered again if a run never finishes or hits a temporary error. Requires `handlerName`. Defaults to `false`. See [Choosing a mode](#choosing-a-mode).
- `delivery` (String): Deprecated, use `queue` instead. A value of `'single'` is the same as `queue: true`, and `'broadcast'` is the default.
- `targets` (Array): Deprecated and ignored.
- `handlerName` (String): The published handler to run in your app's [events worker](/Events/workers/). Required for `queue`. A subscription with no app has no events worker, so its handler runs only in connected clients.
- `handler` (Function | String | Object): The handler source you wrote this subscription against: a function, a source string, or `{ file: '~/AppData/…/handler.js' }`. Only its **hash** is sent. The subscription is created only if it matches what's published under `handlerName`, so `handlerName` is required with it. Passing a function also runs it in this client for each delivery it receives (see below).
- `context` (Object): Values the handler needs, passed to it as a frozen `ctx`. **Up to 4 KB serialized**; see below.
- `expiresAt` (Number | String): When the subscription ends on its own, as unix seconds or an ISO-8601 string. Must be in the future.
- `includeValue` (Boolean): For a `kv:` subject, include the key's new value as `event.value` (`null` on a `del`, absent on an `expire`). The value is left out when it's over 16 KB, when more than 128 subscriptions match the change in that region, or when the filter-check limit stops the count early. Refused on other subjects.
- `onError` (Function): Called with `{ message, code }` when this client stops running `handler` because its connection can't be restored (`reauth_required` after a sign-out, `events_connection_failed` otherwise). The subscription itself keeps going in the events worker, and resumes taking deliveries here once this client reconnects. Only used with a function `handler`; without it, the stop is logged to the console.

## Background delivery needs consent

Running your handler while the user isn't there needs its own per-app permission, **`events:background`**. When an app subscribes with a `handlerName` without it, the call fails with `events_background_consent_required`. To ask for it, call [`puter.perms.request()`](/Perms/request/) with the `'backgroundEvents'` resource:

```js
await puter.perms.request('backgroundEvents');
```

The user can revoke it wherever they manage the app's access. That suspends every subscription with a `handlerName` the app holds for them with `permission_revoked`, and granting it again doesn't resume them: subscribe again. A subscription without a `handlerName` runs nothing in the background and needs no consent.

Background handlers run as a worker session for your app, which appears in the user's sessions list. Revoking that session, withdrawing `events:background`, uninstalling the app, destroying its events worker, or deleting the app all stop background deliveries and invalidate the session's token.

## Choosing a mode

| | Who gets each event | If a run fails |
|---|---|---|
| [`onLocal()`](/Events/onLocal/) | Clients connected right now | Gone. Nothing is kept while disconnected. |
| `onPersistent()` | The events worker, even with the app closed, plus every connected client | Gone. Each place gets one attempt. |
| `onPersistent({ queue: true })` | One consumer at a time: a connected client first, then the events worker | Offered again only if the run never finished or hit a network or other temporary error. |

- **[`onLocal()`](/Events/onLocal/)** is live and best effort. Use it to update the page while it's open.
- **`onPersistent()`** runs your handler in the events worker for every event, even when your app is closed, and also sends the event to every connected client. Each place gets one attempt, and a failed run isn't retried. Use it to react to every change, such as keeping an index or a notification up to date.
- **`onPersistent({ queue: true })`** hands each event to one consumer at a time and retries it when the run never finished or failed for a temporary reason. Use it for work that has to finish, such as processing every uploaded file or calling a webhook.

A queued event comes back only on a retry or a lost answer, with the same `event.id`, so check that ID before doing work twice. Open tabs that passed a function `handler` all receive it, like a broadcast.

## Where the handler runs

Without `queue`, every event runs the handler in each place that's listening:

- The app's [events worker](/Events/workers/) runs the handler named by `handlerName`, whether or not a client is open.
- Every connected client that passed a function `handler` runs it too. Every [`onLocal()`](/Events/onLocal/) subscription that matches the change gets the event as well.

The events worker skips a run when the deployment has no worker runtime or the [handler-run limit](/rate-limits-and-quotas/#events) for this user and app is used up for the minute. Connected clients still run it.

With `queue: true`, a connected client that passed a function `handler` gets the first try. If no client has one, or its run fails, the events worker takes the event right away. A client that doesn't answer within 15 seconds loses the event to the events worker, so keep client handlers short. If the user has your app open in several tabs, each tab that passed a function `handler` gets the event, as a broadcast; keep side effects that must happen once in the worker handler.

Whichever place runs it, it's the same code, called with:

| Binding | What it is |
| --- | --- |
| `event` | The [event](/Events/subjects/#the-event), or a [gap marker](/Events/subjects/#gaps). |
| `ctx` | The frozen `context` this subscription was created with. |
| `user` | A `puter` bound to the account holding the subscription, with the same access your app has for that user in a tab. In a client, it's the ambient `puter`. |
| `fetch` | [`puter.net.fetch`](/Networking/fetch/) where it exists, otherwise the environment's `fetch`. |
| `ack` | On a `queue` subscription only. Optional; see [below](#what-happens-when-a-handler-fails). |

Only a **function** `handler` runs in this client. A source string or `{ file }` is only used for its hash. The connection reconnects on its own when it drops, so this client keeps taking deliveries unless `onError` is called.

Those five bindings are the handler's whole environment. The events worker has no ambient `puter`: a handler that names `puter` or `me` is refused at publish time. Use `user` instead.

### Handlers that trigger handlers

In the events worker, a write made through `user`, or through a token `user` creates, is one run deeper than the event the handler ran for, and it can run handlers of its own, including this one. `user.workers.create` is refused instead — a handler cannot spin up a worker of its own to escape the chain. A chain stops at **12 runs on a paid plan and 4 on a free one**, by the plan of the account holding the subscription. An event past that runs no handler in the events worker. Without `queue`, it still reaches connected clients without running the handler there. A queued one is still offered to a connected client first and runs there. The dropped run leaves no gap marker and doesn't count as a failure. Writes made anywhere else, including from a handler running in a client, start a new chain. See [handler chains](/rate-limits-and-quotas/#handler-chains).

`user` in the events worker is valid for 15 minutes, so don't keep it past the run.

### What happens when a handler fails

These rules apply to a `queue` subscription, in a client or in the events worker:

| The handler | Result |
| --- | --- |
| Resolves | Done. |
| Throws | The event is dropped and replaced by a [gap marker](/Events/subjects/#gaps) with `reason: 'handler_rejected'`. It counts as a failure. |
| Throws a temporary error: a network error, a timeout, a rate limit (`429`), a `5xx`, or any error with `retry: true` | Retried after 2 seconds, then 4, 8 and so on, up to 5 minutes apart. It counts as a failure. |
| Never answers (the tab closed, the worker crashed, or it ran past 30 seconds in the worker) | Offered again. |

To have an error retried, throw it with `retry: true`:

```js
throw Object.assign(new Error('Service busy, try later'), { retry: true });
```

**Five failures in a row suspend the subscription** with `failures`. The developer is notified, and publishing the handler again resumes it.

Without `queue`, a failed run is never retried.

Advanced: a handler can call `ack()` to mark the event done before it finishes. A throw after that doesn't undo it.

## `context` is captured once, up to 4 KB

A handler can't use outside variables (see [`puter.events.handlers`](/Events/handlers/)), so `context` is how values reach it. It's evaluated **once, at this call**. Below, `ctx.endpoint` stays whatever `process.env.INGEST_URL` was when you subscribed, until you subscribe again:

```js
await puter.events.onPersistent({
    subject: 'fs:~/inbox',
    handlerName: 'ingestUpload',
    context: { endpoint: process.env.INGEST_URL, apiKey: process.env.INGEST_KEY },
});
```

Over **4 KB** serialized, the call fails with `events_context_too_large` before any request is made. Context is stored in plaintext and only read when delivering. [`puter.events.list()`](/Events/list/) returns its **key names and a hash**, never the values. For more than 4 KB, put the data in a file and pass the path in `context`.

## Suspended subscriptions

A persistent subscription can stop without being unsubscribed. It's then *suspended*, not deleted, and [`list()`](/Events/list/) shows `suspendedAt` and `suspendedReason`:

| `suspendedReason` | Cause | Resumes when |
| --- | --- | --- |
| `handler_not_found` | Its handler was removed. | A handler is published under that name again. |
| `failures` | Its handler failed 5 times in a row. | The handler is published again. |
| `no_credit` | Its holder ran out of credit. | The balance is topped up (checked every few minutes). |
| `permission_revoked` | The permission or share it relied on was withdrawn. | **Never.** Subscribe again. |

A suspended subscription stops delivering and isn't billed. Its backlog is cut to 100 deliveries and kept for 24 hours (`handler_not_found`, `failures`) or 1 hour (`no_credit`), then replaced by one gap marker. A `permission_revoked` backlog is dropped immediately. Suspended subscriptions are deleted after 30 days.

A subscription suspended for a reason that can resume still counts toward your [persistent subscription limit](/rate-limits-and-quotas/#what-an-account-can-hold) until you unsubscribe it. One suspended with `permission_revoked` doesn't count, since it never resumes. An account keeps at most 500 of those, and past that, subscribing again deletes the oldest ones.

## Delivery guarantees

Clients connect to the nearest region. Events reach a client wherever it's connected.

- Without `queue`, an event runs the handler in the events worker and in each connected client that passed a function `handler`. A run that fails or happens while nothing is connected isn't retried.
- `queue` deliveries are **at-least-once**: an event whose run never finished, or failed with a temporary error, arrives again with the same `event.id`.
- Undelivered events are held in the region where the change happened. If that region goes down, only what it was holding is lost.
- Order is kept within a region and is best-effort across regions. Coalescing (250 ms) also runs per region, so two quick writes can arrive as one event nearby and as two farther away.

## Return value

A `Promise` that resolves to the subscription:

- `subId` (String): Its id, which [`puter.events.unsubscribe()`](/Events/unsubscribe/) takes. It never changes.
- `subject` (String): For `kv:` and `notif:`, the subject in full form: `kv:cart` comes back as `kv:<appId>:cart`. For `fs:`, as you passed it, except a relative path comes back resolved the same way [`onLocal()`](/Events/onLocal/) returns it.
- `anchor`, `match`, `op`: as `onLocal()` returns them.
- `queue` (Boolean), `handlerName` (String | null), `includeValue` (Boolean).
- `appUid` (String | null): The app that created it, or `null` if an account session did.
- `contextKeys` (Array | null), `contextHash` (String | null): the key names and a hash of the stored context, never its values.
- `createdAt`, `expiresAt` (Number | null): unix seconds.
- `suspendedAt` (Number | null), `suspendedReason` (String | null): set when the subscription is [suspended](#suspended-subscriptions).
- `off()` (Function): Ends the subscription and stops running its handler here. Same as [`puter.events.unsubscribe(subId)`](/Events/unsubscribe/).

The promise rejects with `{ message, code }`:

| `code` | Meaning |
| --- | --- |
| `invalid_subject` | The subject is empty, not a string, or can't be parsed, or it's a `notif:` subject and this server has notification events turned off. |
| `auth_canceled` | Nobody was signed in, and the user closed the sign-in without finishing it. |
| `events_handler_name_required` | `handler` was given without `handlerName`. |
| `events_handler_free_variable` | The handler uses an outside variable. The message names it. |
| `events_handler_invalid` | `handler` is not a function, a source string, or `{ file }`. |
| `events_handler_hash_unavailable` | This environment has no `crypto.subtle`, so `handler` can't be hashed. Pass `handlerName` alone. |
| `events_handler_not_found` | Nothing is published under `handlerName`. The subscription isn't created. |
| `events_handler_hash_mismatch` | The published handler isn't the source you passed as `handler`. |
| `events_handler_required` | `queue: true` without a `handlerName`. |
| `events_background_consent_required` | An app subscribed with a `handlerName` and the user hasn't granted `events:background`. |
| `events_context_too_large` | The serialized `context` is over 4 KB. |
| `events_context_invalid` | `context` is not JSON-serializable. |
| `bad_request` | `queue` isn't a boolean, `delivery` isn't `'broadcast'` or `'single'`, the two disagree, or `handlerName` isn't a string or is over 128 characters. |
| `invalid_expires_at` | `expiresAt` is not a future time. |
| `invalid_include_value` | `includeValue` isn't a boolean, or the subject isn't `kv:`. |
| `subject_does_not_exist` | The subject doesn't exist, or this account can't read it. |
| `events_subscription_limit` | The account or app is at its [persistent subscription limit](/rate-limits-and-quotas/#events). |
| `events_value_too_large` | A field is longer than can be stored (for example an app id over 40 characters). |
| `events_durable_requires_account` | Temporary (anonymous) accounts only get session subscriptions. Scoped access tokens, such as the one in a [`getReadURL()`](/FS/getReadURL/) URL, get no persistent subscriptions, whether the account or an app created them. |
| `too_many_requests` | Over the subscribe rate limit. |
| `events_disabled` | Events aren't enabled on this server. |
| `events_failed` | The server sent a response the SDK couldn't read. |

## Examples

<strong class="example-title">Watch a folder with a handler that keeps running</strong>

```html;events-persistent
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            // (1) An app of your own to publish the handler under
            const name = `ingest-${puter.randName()}`;
            const app = await puter.apps.create(name, `https://example.com/${name}`);

            // (2) Publish the handler. It closes over nothing — everything it
            //     needs arrives as `ctx`.
            await puter.events.handlers.publish(
                'ingestUpload',
                async ({ event, ctx }) => {
                    await fetch(ctx.endpoint, {
                        method: 'POST',
                        body: JSON.stringify({ path: event.path, key: ctx.apiKey }),
                    });
                },
                { appUid: app.uid },
            );

            // (3) Subscribe. `context` is read now and never again.
            const dir = puter.randName();
            await puter.fs.mkdir(dir);
            const sub = await puter.events.onPersistent({
                subject: `fs:${dir}`,
                handlerName: 'ingestUpload',
                context: { endpoint: 'https://example.com/ingest', apiKey: 'k-123' },
            });

            puter.print(`watching ${dir} as ${sub.subId}<br>`);

            // (4) It outlives this page. End it explicitly when you are done.
            await puter.events.unsubscribe(sub.subId);
        })();
    </script>
</body>
</html>
```

<strong class="example-title">Bind to the exact source you wrote against</strong>

```html;events-persistent-pinned
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            const name = `pinned-${puter.randName()}`;
            const app = await puter.apps.create(name, `https://example.com/${name}`);

            const handler = ({ event, ctx }) => console.log(ctx.label, event.path);
            await puter.events.handlers.publish('onWrite', handler, { appUid: app.uid });

            const dir = puter.randName();
            await puter.fs.mkdir(dir);

            // Passing the function sends its hash: if somebody redeployed
            // `onWrite` in the meantime, this fails rather than binding you to
            // code you never saw.
            const sub = await puter.events.onPersistent({
                subject: `fs:${dir}`,
                handlerName: 'onWrite',
                handler,
                context: { label: 'inbox' },
            });

            puter.print(`bound to ${sub.handlerName}<br>`);
            await puter.events.unsubscribe(sub.subId);
        })();
    </script>
</body>
</html>
```
