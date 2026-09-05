---
title: puter.events.handlers
description: Publish, list and remove the named handlers a persistent subscription runs.
platforms: [websites, apps, nodejs, workers]
---

<div class="info">The Events API is in beta. Event shapes, limits, and behavior may change between releases.</div>

A **handler** is a function your app deploys once, under a name, that persistent subscriptions bind to. A name is a label for deployed code, not an event: nothing triggers by name, and a handler runs only when a subscription bound to it has a delivery.

Publishing is a **developer** operation. An app token publishes into its own app; an account session has to name an app it owns with `appUid`. Either way the account must own the app.

```js
await puter.events.handlers.publish('ingestUpload', async ({ event, ctx }) => {
    await fetch(ctx.endpoint, { method: 'POST', body: event.path });
}, { appUid });

await puter.events.handlers.list({ appUid });     // [{ name, hash, updatedAt, subscriptions }]
await puter.events.handlers.remove('indexDocument', { appUid });
```

## Handlers cannot close over anything

A handler is serialized with `Function.prototype.toString()` and run later, somewhere else. A closed-over variable is not discouraged — it is **unrepresentable**, because nothing around the function survives the trip.

Every identifier a handler names must be one of: a parameter, something the handler itself declares, a standard global (`fetch`, `JSON`, `Math`, `console`, `URL`, `crypto`, …), or reached through `ctx`. `puter` is **not** one of them — a handler running in the [events worker](/Events/#events-worker) has no ambient SDK, and reaches the account through its `user` binding instead, with the same authority your app has for that user in a tab. The SDK checks this before the request and rejects with `events_handler_free_variable`, naming the identifier:

```js
const endpoint = 'https://example.com/ingest';

// Rejected: `endpoint` is not a parameter, a local, or a known global.
await puter.events.handlers.publish('ingestUpload', ({ event }) => fetch(endpoint), { appUid });

// Accepted: the value travels with the subscription, not with the code.
await puter.events.handlers.publish('ingestUpload', ({ event, ctx }) => fetch(ctx.endpoint), { appUid });
await puter.events.onPersistent({ subject: 'fs:~/inbox', handlerName: 'ingestUpload', context: { endpoint } });
```

The check is deliberately conservative: anything it cannot resolve is refused with a clear message, rather than accepted and failed on first delivery in production.

## `publish()`

```js
puter.events.handlers.publish(name, handler)
puter.events.handlers.publish(name, handler, options)
```

- `name` (String) (required): The name subscriptions bind to. Letters, digits and `_ . : -`, starting alphanumeric, up to 128 characters. Unique per app, and stable across source changes.
- `handler` (Function | String | Object) (required): A function (serialized with `toString()`), a source string, or `{ file: '~/AppData/…/handler.js' }`. **A file reference resolves now, not at delivery** — the bytes as they are at this call are what gets deployed, so editing the file afterwards changes nothing until you publish again.
- `options.replace` (Boolean): Take the name whatever is published under it.
- `options.appUid` (String): The app to publish into. Required for an account session.

Resolves to `{ name, hash, updatedAt, outcome, resumed }`. `outcome` is `'created'`, `'updated'`, or `'unchanged'` when the same source was already published. `resumed` counts subscriptions this publish brought back out of suspension.

### Two build steps must not silently pick a winner

The source hash is a change detector and an idempotency key: publishing the **same** source again is a no-op. Publishing **different** source is an update — but only from a caller that knows what it is updating.

The SDK remembers the hash it last saw published for each name and sends it as the base. A publish whose base has moved under it — a second build step got there first — is refused with `events_handler_conflict`. Pass `replace: true` to say you mean to take the name regardless.

A client that has never published or listed that name sends no base, so its publish can only create, or be idempotent.

## `publishAll()`

```js
puter.events.handlers.publishAll(handlers)
puter.events.handlers.publishAll(handlers, options)
```

Publishes a set in one call — what a build step has. `handlers` is an array of `{ name, handler, replace? }`, capped at 50 entries and taken in order. An item the server refuses stops the pass, so a deploy never reports success over a half-published set; items before it are published, and the error names where it stopped.

Resolves to an array of the same objects `publish()` returns.

## `list()`

```js
puter.events.handlers.list()
puter.events.handlers.list(options)
```

Resolves to `[{ name, hash, updatedAt, subscriptions }]` for everything the app has published, ordered by name. `subscriptions` counts what is bound to that name, **suspended ones included** — a suspended subscription is still a dependent, and it is the reason removing a name is not just a delete.

**Source is never returned.** It is the app's own code, read only on the delivery path.

## `remove()`

```js
puter.events.handlers.remove(name)
puter.events.handlers.remove(name, options)
```

Resolves to `{ name, removed, suspended }`.

| Situation | What happens |
| --- | --- |
| Nothing is bound to the name | The handler is deleted outright. |
| Subscriptions are bound to it | The handler is deleted **and** every subscription on it is *suspended* with `suspendedReason: 'handler_not_found'` — not deleted. The app's developer is notified. |

**Publishing the name again resumes them.** That is what makes a bad deploy recoverable: the subscriptions keep their ids, their context and their place, and start delivering again on the next publish.

Renaming is publish-new plus remove-old, and subscriptions do **not** follow — that is a re-subscribe, deliberately: silently repointing someone's subscription at different code is exactly what consent is protecting against.

**An app's first published handler stands up an [events worker](/Events/#events-worker) for it.** See [`puter.events.workers`](/Events/workers/) to list and destroy them — the last handler removed here takes it down the same way.

### Refusing a delivery outright

A handler running in the events worker normally has two outcomes: return (or resolve) and the delivery is taken, or throw and it is retried later. Sometimes neither is right — the delivery is malformed in a way retrying never fixes. Throw an error with `terminal: true`, or a `code` of `'events_terminal'`, and it is refused instead of retried. The invocation answers a `4xx` rather than the usual `5xx`, and the delivery is dropped with a [gap marker](/Events/#gap-marker) carrying `reason: 'handler_rejected'` instead of being sent again to the same handler.

```js
await puter.events.handlers.publish('ingestUpload', async ({ event }) => {
    if (! event.path.endsWith('.json')) {
        const err = new Error(`cannot ingest ${event.path}`);
        err.terminal = true;
        throw err;
    }
    // ...
}, { appUid });
```

See [`onPersistent()`](/Events/onPersistent/) for the full `2xx`/`4xx`/`5xx` mapping this feeds into.

### What a suspension does to the backlog

A suspended subscription stops being delivered to and stops being metered, so it cannot go on holding a full backlog for free. On suspension its undelivered deliveries are trimmed to **100** and given a deadline: **24 hours** for `handler_not_found` and `failures`, **1 hour** for `no_credit`. Past the deadline they are dropped and one [gap marker](/Events/#gap-marker) with `reason: 'suspended_backlog_expired'` takes their place, so a resumed subscription learns there were events rather than reading the silence as "nothing changed". A subscription suspended by `permission_revoked` has its backlog **purged at once** and never resumes.

## Errors

All four methods reject with `{ message, code }`:

| `code` | Meaning |
| --- | --- |
| `events_handler_free_variable` | The handler names something it cannot carry. The message names the identifier. |
| `events_handler_invalid` | `handler` is not a function, a source string, or `{ file }`. |
| `events_handler_name_invalid` | The name is empty, too long, or not an addressable identifier. |
| `events_handler_conflict` | Different source is published under this name and the caller did not name it as the base. Pass `replace: true` to take it. |
| `events_handler_app_required` | An account session did not name an app. |
| `events_handler_forbidden` | The caller does not own the app — and an app that is not there answers the same way. |
| `events_handler_too_large` | The serialized handler is over 64 KB. |
| `events_worker_too_large` | The app's handlers would exceed 5 MB of source combined. |
| `events_handler_source_invalid` | The handler source is empty. |
| `events_handler_limit` | The app already has the maximum number of published handlers. |
| `too_many_requests` | Over the handler publish/remove budget. |
| `events_disabled` | Events are not enabled on this server. |
| `events_failed` | The server answered with something the SDK could not make sense of. |

## Examples

<strong class="example-title">Publish a handler, bind a subscription to it, then take it away</strong>

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            // (1) An app of your own — handlers belong to an app you own
            const name = `ingest-${puter.randName()}`;
            const app = await puter.apps.create(name, `https://example.com/${name}`);
            const appUid = app.uid;

            // (2) Publish
            const published = await puter.events.handlers.publish(
                'ingestUpload',
                async ({ event, ctx }) => {
                    await fetch(ctx.endpoint, { method: 'POST', body: event.path });
                },
                { appUid },
            );
            puter.print(`published ${published.name} (${published.outcome})<br>`);

            // (3) Publishing the same source again changes nothing
            const again = await puter.events.handlers.publish(
                'ingestUpload',
                async ({ event, ctx }) => {
                    await fetch(ctx.endpoint, { method: 'POST', body: event.path });
                },
                { appUid },
            );
            puter.print(`second publish: ${again.outcome}<br>`);

            // (4) What is deployed, and how much depends on it
            for (const handler of await puter.events.handlers.list({ appUid })) {
                puter.print(`${handler.name}: ${handler.subscriptions} subscription(s)<br>`);
            }

            // (5) Nothing bound to it, so it is deleted outright
            const removed = await puter.events.handlers.remove('ingestUpload', { appUid });
            puter.print(`removed: ${removed.removed}, suspended: ${removed.suspended}<br>`);
        })();
    </script>
</body>
</html>
```

<strong class="example-title">Deploy a whole set from a build step</strong>

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            const name = `pipeline-${puter.randName()}`;
            const app = await puter.apps.create(name, `https://example.com/${name}`);

            const published = await puter.events.handlers.publishAll([
                {
                    name: 'ingestUpload',
                    handler: ({ event, ctx }) => fetch(ctx.ingest, { body: event.path }),
                },
                {
                    name: 'indexDocument',
                    handler: ({ event, ctx }) => fetch(ctx.index, { body: event.uid }),
                },
            ], { appUid: app.uid });

            for (const handler of published) {
                puter.print(`${handler.name} → ${handler.outcome}<br>`);
            }
        })();
    </script>
</body>
</html>
```
