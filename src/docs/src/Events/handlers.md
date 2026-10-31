---
title: puter.events.handlers
description: Publish, list and remove the named handlers a persistent subscription runs.
platforms: [websites, apps, nodejs, workers]
---

<div class="info">The Events API is in beta. Event shapes, limits, and behavior may change between releases.</div>

A **handler** is a function your app publishes once, under a name, for persistent subscriptions to run. A handler runs only when a subscription bound to its name has a delivery. Nothing else can trigger it.

Only the app's owner can publish, list, and remove its handlers. Inside an app, including a website using Puter.js, these calls act on that app, and work only while the signed-in user owns it. Outside an app, such as in Node.js with your account token, name the app with `appUid`.

On a website with nobody signed in, each method asks the user to sign in first, as other Puter.js calls do. An app running on Puter is always signed in.

```js
await puter.events.handlers.publish('ingestUpload', async ({ event, ctx }) => {
    await fetch(ctx.endpoint, { method: 'POST', body: event.path });
}, { appUid });

await puter.events.handlers.list({ appUid });     // [{ name, hash, updatedAt, subscriptions }]
await puter.events.handlers.remove('ingestUpload', { appUid });
```

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

## `publish()`

```js
puter.events.handlers.publish(name, handler)
puter.events.handlers.publish(name, handler, options)
```

- `name` (String) (required): The name subscriptions bind to. Letters, digits, and `_ . : -`, starting with a letter or digit, up to 128 characters. Unique within the app.
- `handler` (Function | String | Object) (required): A function (serialized with `toString()`), a source string, or `{ file: '~/AppData/…/handler.js' }`. A file is read at this call, so later edits to it take effect only when you publish again.
- `options.replace` (Boolean): Overwrite whatever is published under the name.
- `options.appUid` (String): The app to publish into. Required outside an app. Inside an app, it can only name that app.

Resolves to `{ name, hash, updatedAt, outcome, resumed }`. Its `outcome` is `'created'`, `'updated'`, or `'unchanged'` (the same source was already published), and `resumed` counts the suspended subscriptions this publish brought back.

### Concurrent publishes

Publishing the same source again does nothing. Publishing different source updates the handler, but only if you know what you're replacing.

The SDK remembers the hash it last saw for each name and sends it with the publish. If someone else published in between, the publish fails with `events_handler_conflict`. Pass `replace: true` to overwrite anyway. A client that has never published or listed the name sends no hash, so it can only create the name or publish the same source again.

## `publishAll()`

```js
puter.events.handlers.publishAll(handlers)
puter.events.handlers.publishAll(handlers, options)
```

Publishes a set in one call, for build steps. Pass `handlers` as an array of up to 50 `{ name, handler, replace? }`, published in order. The `options.appUid` option works as it does for `publish()`. If one is refused, publishing stops there. Earlier items stay published, and the error says where it stopped.

Resolves to an array of `publish()` results.

## `list()`

```js
puter.events.handlers.list()
puter.events.handlers.list(options)
```

Resolves to `[{ name, hash, updatedAt, subscriptions }]` for every handler the app has published, sorted by name. Each `subscriptions` count includes the suspended subscriptions bound to that name. The `options.appUid` option works as it does for `publish()`.

The source is never returned.

## `remove()`

```js
puter.events.handlers.remove(name)
puter.events.handlers.remove(name, options)
```

Resolves to `{ name, removed, suspended }`, where `removed` is `false` when nothing was published under the name. The `options.appUid` option works as it does for `publish()`.

| Situation | What happens |
| --- | --- |
| No subscriptions use the name | The handler is deleted. |
| Subscriptions use it | The handler is deleted, and its subscriptions are suspended with `suspendedReason: 'handler_not_found'`, not deleted. The app's developer gets an `app.events.suspended` notification. |

Publishing the name again resumes them, with the same ids and context. This is how you recover from a bad deploy.

To rename a handler, publish the new name and remove the old one. Subscriptions don't follow the rename. Users have to subscribe again, so their subscriptions never switch to different code without them knowing.

An app's first published handler creates its [events worker](/Events/workers/), and removing the last one takes it down.

## Failed runs

A handler that throws on a `queue` subscription drops the event, unless the error is temporary or thrown with `retry: true`. See [What happens when a handler fails](/Events/onPersistent/#what-happens-when-a-handler-fails) for the outcomes and the retry schedule, and [Suspended subscriptions](/Events/onPersistent/#suspended-subscriptions) for what happens after repeated failures.

## Errors

All four methods reject with `{ message, code }`:

| `code` | Meaning |
| --- | --- |
| `auth_canceled` | Nobody was signed in, and the user closed the sign-in without finishing it. |
| `events_handler_free_variable` | The handler uses an outside variable. The message names it. |
| `events_handler_invalid` | `handler` isn't a function, a source string, or `{ file }`. |
| `events_handler_name_invalid` | The name is empty, too long, or has characters that aren't allowed. |
| `events_handler_conflict` | Someone else published different source under this name since you last saw it. Pass `replace: true` to overwrite. |
| `events_handler_app_required` | The call was made outside an app without `appUid`. |
| `events_handler_forbidden` | The signed-in user doesn't own the app, the app doesn't exist, `appUid` names a different app than the one making the call, or the caller is a scoped access token. |
| `events_handler_too_large` | The handler is over 64 KB. |
| `events_worker_too_large` | The app's handlers would exceed 5 MB combined. |
| `events_handler_source_invalid` | The handler source is empty. |
| `events_handler_limit` | The app already has the [maximum number of handlers](/rate-limits-and-quotas/#handlers). |
| `invalid_request` | `publishAll()` got something other than a non-empty array. |
| `too_many_requests` | Over the publish and remove rate limit. |
| `events_disabled` | Events aren't enabled on this server. |
| `events_failed` | The server sent a response the SDK couldn't read. |

## Examples

These examples run in Node.js signed in with your account token, and `appUid` names an app you own. Inside your own app, leave out `appUid`.

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
