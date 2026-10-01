---
title: puter.events.handlers
description: Publish, list and remove the named handlers a persistent subscription runs.
platforms: [websites, apps, nodejs, workers]
---

<div class="info">The Events API is in beta. Event shapes, limits, and behavior may change between releases.</div>

A **handler** is a function your app publishes once, under a name, for persistent subscriptions to run. Nothing triggers a handler by name; it runs only when a subscription bound to it has a delivery.

Publishing is a **developer** operation: the account must own the app. An app token publishes into its own app; an account session names the app with `appUid`.

On a website with nobody signed in, each method asks the user to sign in first, as other Puter.js calls do. An app running on Puter is always signed in.

```js
await puter.events.handlers.publish('ingestUpload', async ({ event, ctx }) => {
    await fetch(ctx.endpoint, { method: 'POST', body: event.path });
}, { appUid });

await puter.events.handlers.list({ appUid });     // [{ name, hash, updatedAt, subscriptions }]
await puter.events.handlers.remove('indexDocument', { appUid });
```

## Handlers can't use outside variables

A handler is serialized with `Function.prototype.toString()` and run later, somewhere else, so nothing around the function comes with it.

Every identifier a handler uses must be a parameter, something the handler declares itself, a standard global (`fetch`, `JSON`, `Math`, `console`, `URL`, `crypto`, …), or reached through `ctx`. `puter` isn't available in the [events worker](/Events/workers/); use the `user` binding, which has the same access your app has for that user in a tab. The SDK checks this before sending and rejects with `events_handler_free_variable`, naming the identifier:

```js
const endpoint = 'https://example.com/ingest';

// Rejected: `endpoint` isn't a parameter, a local, or a known global.
await puter.events.handlers.publish('ingestUpload', ({ event }) => fetch(endpoint), { appUid });

// Accepted: the value travels with the subscription, not with the code.
await puter.events.handlers.publish('ingestUpload', ({ event, ctx }) => fetch(ctx.endpoint), { appUid });
await puter.events.onPersistent({ subject: 'fs:~/inbox', handlerName: 'ingestUpload', context: { endpoint } });
```

The check is strict on purpose: anything it can't resolve is refused now instead of failing on the first delivery.

## `publish()`

```js
puter.events.handlers.publish(name, handler)
puter.events.handlers.publish(name, handler, options)
```

- `name` (String) (required): The name subscriptions bind to. Letters, digits and `_ . : -`, starting with a letter or digit, up to 128 characters. Unique within the app.
- `handler` (Function | String | Object) (required): A function (serialized with `toString()`), a source string, or `{ file: '~/AppData/…/handler.js' }`. **A file is read now**, so later edits to it take effect only when you publish again.
- `options.replace` (Boolean): Overwrite whatever is published under the name.
- `options.appUid` (String): The app to publish into. Required for an account session.

Resolves to `{ name, hash, updatedAt, outcome, resumed }`. `outcome` is `'created'`, `'updated'`, or `'unchanged'` (the same source was already published). `resumed` counts suspended subscriptions this publish brought back.

### Concurrent publishes

Publishing the **same** source again does nothing. Publishing **different** source updates the handler, but only if you know what you're replacing.

The SDK remembers the hash it last saw for each name and sends it with the publish. If someone else published in between, the publish fails with `events_handler_conflict`. Pass `replace: true` to overwrite anyway. A client that has never published or listed the name sends no hash, so it can only create the name or republish identical source.

## `publishAll()`

```js
puter.events.handlers.publishAll(handlers)
puter.events.handlers.publishAll(handlers, options)
```

Publishes a set in one call, for build steps. `handlers` is an array of up to 50 `{ name, handler, replace? }`, published in order. If one is refused, publishing stops there: earlier items stay published, and the error says where it stopped.

Resolves to an array of `publish()` results.

## `list()`

```js
puter.events.handlers.list()
puter.events.handlers.list(options)
```

Resolves to `[{ name, hash, updatedAt, subscriptions }]` for every handler the app has published, sorted by name. `subscriptions` counts the subscriptions bound to that name, **including suspended ones**.

**Source is never returned.**

## `remove()`

```js
puter.events.handlers.remove(name)
puter.events.handlers.remove(name, options)
```

Resolves to `{ name, removed, suspended }`.

| Situation | What happens |
| --- | --- |
| No subscriptions use the name | The handler is deleted. |
| Subscriptions use it | The handler is deleted, and its subscriptions are *suspended* with `suspendedReason: 'handler_not_found'`, not deleted. The app's developer is notified. |

**Publishing the name again resumes them**, with the same ids and context. This is how you recover from a bad deploy.

Renaming is publishing the new name and removing the old one. Subscriptions don't follow: users have to subscribe again, so their subscriptions never silently switch to different code.

An app's first published handler creates its [events worker](/Events/workers/), and removing the last one takes it down.

### Refusing a delivery

In the events worker, a handler that returns takes the delivery, and one that throws is retried later. When retrying can't help (a malformed event, say), throw an error with `terminal: true` or `code: 'events_terminal'`. The delivery is dropped and replaced by a [gap marker](/Events/onLocal/#gaps) with `reason: 'handler_rejected'`.

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

See [`onPersistent()`](/Events/onPersistent/#where-the-handler-runs) for the full list of outcomes, and [suspended subscriptions](/Events/onPersistent/#suspended-subscriptions) for what happens to a suspended subscription's backlog.

## Errors

All four methods reject with `{ message, code }`:

| `code` | Meaning |
| --- | --- |
| `auth_canceled` | Nobody was signed in, and the user closed the sign-in without finishing it. |
| `events_handler_free_variable` | The handler uses an outside variable. The message names it. |
| `events_handler_invalid` | `handler` isn't a function, a source string, or `{ file }`. |
| `events_handler_name_invalid` | The name is empty, too long, or has characters that aren't allowed. |
| `events_handler_conflict` | Someone else published different source under this name since you last saw it. Pass `replace: true` to overwrite. |
| `events_handler_app_required` | An account session didn't pass `appUid`. |
| `events_handler_forbidden` | The caller doesn't own the app (or it doesn't exist), or is a scoped access token. |
| `events_handler_too_large` | The handler is over 64 KB. |
| `events_worker_too_large` | The app's handlers would exceed 5 MB combined. |
| `events_handler_source_invalid` | The handler source is empty. |
| `events_handler_limit` | The app already has the [maximum number of handlers](/rate-limits-and-quotas/#events). |
| `too_many_requests` | Over the publish/remove rate limit. |
| `events_disabled` | Events aren't enabled on this server. |
| `events_failed` | The server sent a response the SDK couldn't read. |

## Examples

<strong class="example-title">Publish a handler, bind a subscription to it, then take it away</strong>

```html;events-handlers
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

```html;events-handlers-publish-all
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
