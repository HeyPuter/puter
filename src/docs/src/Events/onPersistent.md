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
- `delivery` (String): `'broadcast'` (default) delivers to everything listening. `'single'` delivers each event to exactly one consumer, which must acknowledge it, and requires `handlerName`.
- `targets` (Array): Transports deliveries may take — any of `'socket'`, `'worker'`, `'push'`. Defaults to `['socket', 'worker']` for a subscription an app made, `['socket']` for one an account session made naming no app. A `single` subscription may not target `'push'`; a subscription with no app may not target `'worker'` — there is exactly one events worker per app, and no app means no worker to invoke.
- `handlerName` (String): The published handler this subscription binds to. Required for `single`.
- `handler` (Function | String | Object): The handler source this subscription was written against. Sent as a **hash**, never as source: the subscription binds only if that hash matches what is published under `handlerName`, which is why `handlerName` is required alongside it. Accepts a function, a source string, or `{ file: '~/AppData/…/handler.js' }`.
- `context` (Object): Values the handler needs, delivered to it as a frozen `ctx`. **Capped at 4 KB serialized** — see below.
- `expiresAt` (Number | String): When the subscription ends by itself — unix seconds or an ISO-8601 string, and it has to be in the future.

## `context` is evaluated once, and capped at 4 KB

A handler is deployed, not called: it is serialized and run later, somewhere else, so it cannot close over anything. `context` is how values reach it — and it is evaluated **at this call**, serialized, and never re-evaluated. `ctx.endpoint` is whatever `process.env.INGEST_URL` was when you subscribed, forever, until you subscribe again.

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
| `events_context_too_large` | The serialized `context` is over 4 KB. |
| `events_context_invalid` | `context` is not JSON-serializable. |
| `invalid_targets` | A target outside `socket`/`worker`/`push`, `push` on a `single` subscription, or `worker` on a subscription with no app. |
| `invalid_expires_at` | `expiresAt` is not a future time. |
| `subject_does_not_exist` | The subject is not there, or this account cannot read it. |
| `events_subscription_limit` | This account already holds the maximum number of persistent subscriptions. |
| `too_many_requests` | Over the subscribe/unsubscribe call budget. |
| `events_disabled` | Events are not enabled on this server. |

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
