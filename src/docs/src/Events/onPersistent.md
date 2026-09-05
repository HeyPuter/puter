---
title: puter.events.onPersistent()
description: Subscribe to changes with a subscription that keeps running when your app is closed.
platforms: [websites, apps, nodejs, workers]
---

<div class="info">The Events API is in beta. Event shapes, limits, and behavior may change between releases.</div>

Creates a subscription that outlives this connection. It is stored against the account, keeps matching while your app is closed, and runs a handler your app published with [`puter.events.handlers.publish()`](/Events/handlers/). Contrast [`puter.events.onLocal()`](/Events/onLocal/), which lives and dies with the page.

See [Events](/Events/) for the subject grammar and the event shape.

## Syntax
```js
puter.events.onPersistent(options)
```

## Parameters

#### `options` (Object) (required)

- `subject` (String) (required): What to watch — the same grammar `onLocal()` takes, e.g. `fs:~/Documents` or `fs:~/inbox/*.json:add`.
- `delivery` (String): The [delivery class](/Events/#delivery-class). `'broadcast'` (default) delivers to everything listening. `'single'` delivers each event to exactly one consumer, which must acknowledge it, and requires `handlerName`.
- `targets` (Array): Transports deliveries may take — any of `'socket'`, `'worker'`, `'push'`. Defaults to `['socket', 'worker']` for a subscription an app made, `['socket']` for one an account session made naming no app. A subscription with no app may not target `'worker'` — there is exactly one [events worker](/Events/#events-worker) per app, and no app means no worker to invoke. `'push'` is reserved for a future device-notification transport: it is accepted (except on a `single` subscription, which may not target it) but nothing delivers through it yet.
- `handlerName` (String): The published handler this subscription binds to. Required for `single`.
- `handler` (Function | String | Object): The handler source this subscription was written against. Sent as a **hash**, never as source: the subscription binds only if that hash matches what is published under `handlerName`, which is why `handlerName` is required alongside it. Accepts a function, a source string, or `{ file: '~/AppData/…/handler.js' }`.
- `context` (Object): Values the handler needs, delivered to it as a frozen `ctx`. **Capped at 4 KB serialized** — see below.
- `expiresAt` (Number | String): When the subscription ends by itself — unix seconds or an ISO-8601 string, and it has to be in the future.

## Background delivery takes the user's consent

Running your handler when nobody is there is a different thing from delivering to a page the user has open, so it takes its own per-app permission, **`events:background`**. `['socket', 'worker']` is the default `targets` for a subscription an app creates; subscribing with `worker` among them without the permission fails with `events_background_consent_required`. Request it like any other permission:

```js
await puter.perms.request(['events:background']);
```

The user can revoke it wherever they manage an app's access. Doing so suspends every worker-target subscription that app holds for them with `permission_revoked`; re-granting the permission does not resume them, so subscribe again. A subscription that only wants deliveries while your app is open needs no consent at all: pass `targets: ['socket']`.

A background delivery runs as a session, the same as any other your app is granted — it shows up in the user's own sessions list as a worker session, and revoking it there stops background handlers for your app the same way withdrawing `events:background` does. Withdrawing `events:background` or uninstalling the app revokes that session in turn, so a copied-out token stops working too.

## Where the handler runs, and what it is handed

The handler runs **in this client while it is connected**, and in the app's events worker when it is not. It is the same body either way, called with:

| Binding | What it is |
| --- | --- |
| `event` | The projected event, or a gap marker. |
| `ctx` | The frozen `context` this subscription was created with. |
| `user` | A `puter` bound to the account holding the subscription, acting through your app the same way it does in a tab — the ambient one in a client. |
| `fetch` | [`puter.net.fetch`](/Networking/fetch/) where it exists, the environment's `fetch` otherwise. |
| `ack` | On a `single` subscription only — see below. |

Passing `handler` as a **function** is what registers it to run here; a source string or `{ file }` is sent as a hash only, and nothing runs client-side. Either way the hash must match what is published under `handlerName`.

Those five bindings are the whole environment. The events worker has no ambient `puter` and no identity of your own to act as — a handler that names `puter` or `me` is refused when you publish it, rather than failing on its first delivery. `user` is that identity instead: it carries your app's own reach for that account — its KV, its AppData, whatever else the user has granted it — the same as any session your app runs while they have a tab open.

### Acknowledging a `single` delivery

A `single` delivery is owed to exactly one consumer, so it stays owed until it is acknowledged:

- Calling `ack()` takes the delivery.
- Returning **without** calling it acknowledges it anyway — a handler that finished did the work.
- **Throwing acknowledges nothing.** The lease lapses after 30 seconds and the delivery is offered again, so a handler that throws sees the same event twice. `event.id` is stable across redeliveries; use it to make the second one a no-op.

In the events worker the same three outcomes are the response status: `2xx` takes the delivery, `4xx` refuses it (it is dropped with a `gap` marker carrying `reason: 'handler_rejected'`), and `5xx`, `429` or no answer within 30 seconds means "not now" — the delivery is retried after 2 seconds, doubling to at most 5 minutes. **Five failures in a row, refusals included, suspend the subscription** with `failures`; the developer is notified and republishing the handler puts it back in service.

A handler that throws normally lands on the retriable side (`5xx`), since the failure might be transient. To refuse a delivery outright instead — a malformed event, say, where retrying changes nothing — throw an error with `terminal: true`, or a `code` of `'events_terminal'`. The worker maps that to a `4xx`, the same `handler_rejected` gap a plain refusal gets. This only matters in the events worker: thrown in the client, it just reaches whatever caught the promise.

## `context` is evaluated once, and capped at 4 KB

A handler cannot close over anything (see [`puter.events.handlers`](/Events/handlers/)), so `context` is how values reach it. It is evaluated **at this call**, serialized, and never re-evaluated. `ctx.endpoint` is whatever `process.env.INGEST_URL` was when you subscribed, forever, until you subscribe again.

```js
await puter.events.onPersistent({
    subject: 'fs:~/inbox',
    handlerName: 'ingestUpload',
    context: { endpoint: process.env.INGEST_URL, apiKey: process.env.INGEST_KEY },
});
```

**The cap is a hard 4 KB.** These are database rows read on every delivery, and `context` is the one field you control the size of; over the cap the call fails with `events_context_too_large`, client-side, before the request. Context is stored in plaintext and is read only on the delivery path — [`puter.events.list()`](/Events/list/) returns its **key names and a content hash**, never its values. If you need to hand a handler more than 4 KB, put it in a file and pass the path in `context`; a wider column is not the upgrade path.

## Return value

A `Promise` that resolves to the subscription:

- `subId` (String): Its id, and what [`puter.events.unsubscribe()`](/Events/unsubscribe/) names. Stable for the life of the subscription.
- `subject`, `anchor`, `match`, `op`: as `onLocal()` returns them.
- `delivery` (String), `targets` (Array), `handlerName` (String | null).
- `appUid` (String | null): The app that created it, or `null` for one an account session made.
- `contextKeys` (Array | null), `contextHash` (String | null): the shape of the stored context, never its values.
- `createdAt`, `expiresAt` (Number | null): unix seconds.
- `suspendedAt` (Number | null), `suspendedReason` (String | null): why it stopped delivering without being removed — see [`puter.events.handlers.remove()`](/Events/handlers/).
- `off()` (Function): ends the subscription — stops running its handler here and unsubscribes it. The same thing as [`puter.events.unsubscribe(subId)`](/Events/unsubscribe/), with nothing to pass.

The promise rejects with `{ message, code }`:

| `code` | Meaning |
| --- | --- |
| `invalid_subject` | The subject is not a non-empty string, or the server could not parse it. |
| `events_handler_name_required` | An inline `handler` was given with no `handlerName` to publish it under. |
| `events_handler_free_variable` | The handler names something it cannot carry — a closed-over variable. The message names the identifier. |
| `events_handler_invalid` | `handler` is not a function, a source string, or `{ file }`. |
| `events_handler_hash_unavailable` | This environment provides no `crypto.subtle`, so an inline handler cannot be hashed. Publish it first and pass `handlerName` alone. |
| `events_handler_not_found` | No handler is published under `handlerName`. The subscription is **not** created. |
| `events_handler_hash_mismatch` | The published handler is not the source this subscription was written against. |
| `events_handler_required` | `delivery: 'single'` without a `handlerName`. |
| `events_background_consent_required` | The subscription targets `worker` and the user has not granted this app `events:background`. |
| `events_context_too_large` | The serialized `context` is over 4 KB. |
| `events_context_invalid` | `context` is not JSON-serializable. |
| `invalid_targets` | A target outside `socket`/`worker`/`push`, `push` on a `single` subscription (which may not target it), or `worker` on a subscription with no app. |
| `invalid_expires_at` | `expiresAt` is not a future time. |
| `subject_does_not_exist` | The subject is not there, or this account cannot read it. |
| `events_subscription_limit` | This account already holds the maximum number of persistent subscriptions. |
| `events_durable_requires_account` | Called from a temporary (anonymous) account, which gets session subscriptions only. |
| `too_many_requests` | Over the subscribe/unsubscribe call budget. |
| `events_disabled` | Events are not enabled on this server. |
| `events_failed` | The server answered with something the SDK could not make sense of. |

## Examples

<strong class="example-title">Watch a folder with a handler that keeps running</strong>

```html
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
            const dir = `~/${puter.randName()}`;
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

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            const name = `pinned-${puter.randName()}`;
            const app = await puter.apps.create(name, `https://example.com/${name}`);

            const handler = ({ event, ctx }) => console.log(ctx.label, event.path);
            await puter.events.handlers.publish('onWrite', handler, { appUid: app.uid });

            const dir = `~/${puter.randName()}`;
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
