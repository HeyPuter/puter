---
title: puter.events.workers
description: List and destroy the events worker a published handler set stands up.
platforms: [websites, apps, nodejs, workers]
---

<div class="info">The Events API is in beta. Event shapes, limits, and behavior may change between releases.</div>

An **events worker** runs an app's published [handlers](/Events/handlers/). It runs them for every event on a subscription with a `handlerName`, whether or not a client is connected, and for a [`queue`](/Events/onPersistent/#choosing-a-mode) delivery once no connected client takes it. Each app has at most one, created when it publishes its first handler, however many handlers it publishes.

A hosted Puter server may bill each app's events worker as a monthly cost, even if nothing ever delivers to it. Use this API to see which apps have one and remove the ones you don't need.

```js
const { items } = await puter.events.workers.list();      // [{ appUid, appName, handlerCount, ... }]
await puter.events.workers.destroy(items[0].appUid);      // removes every handler that app published
```

Outside an app, such as in Node.js with your account token, you see the workers of every app you own. Inside an app, you see only that app's own worker (0 or 1 item), and only if the signed-in user owns the app.

On a website with nobody signed in, each method asks the user to sign in first, as other Puter.js calls do. An app running on Puter is always signed in.

The worker starts on the first delivery that needs it, and again after it's been idle long enough to be shut down, so the first background delivery after a publish has a short cold start. Only Puter can invoke it.

## `list()`

```js
puter.events.workers.list()
puter.events.workers.list(options)
```

- `options.limit` (Number): Apps per page.
- `options.cursor` (String): The `cursor` from a previous page. Leave it off to start from the first page.

Resolves to `{ items, cursor, deployable }`:

- `items`: One `{ appUid, appName, appTitle, handlerCount, createdAt, updatedAt, script }` per app. In each item, `createdAt` is when the app's first handler was published, `updatedAt` is its latest publish, and `script` names the deployed script, which is useful when reporting an issue.
- `cursor`: Present while more pages exist.
- `deployable`: `false` when this server doesn't run events workers, such as a self-hosted install without the runtime turned on. Handlers can still be published there, but background deliveries never run.

## `destroy()`

```js
puter.events.workers.destroy(appUid)
```

Removes every handler the app has published, the same as calling [`puter.events.handlers.remove()`](/Events/handlers/) on each. Their subscriptions are suspended with `handler_not_found`, not deleted, and publishing the handlers again resumes them.

It also ends the worker session background deliveries ran under, for every user. The next delivery after a new publish starts a new one.

Resolves to `{ appUid, removed, suspended }`, the number of handlers deleted and the number of subscriptions suspended. An app with nothing published rejects with `events_handler_not_found`.

## Errors

Both methods reject with `{ message, code }`:

| `code` | Meaning |
| --- | --- |
| `auth_canceled` | Nobody was signed in, and the user closed the sign-in without finishing it. |
| `events_worker_owner_only` | `list()` was called with a scoped access token, such as the one in a [`getReadURL()`](/FS/getReadURL/) URL. |
| `events_handler_not_found` | `destroy()` named an app with no published handlers. |
| `events_handler_forbidden` | The signed-in user doesn't own the app, the app doesn't exist, the call came from a different app, or the caller is a scoped access token. |
| `too_many_requests` | Over the publish and remove rate limit, or the listing rate limit. |
| `events_disabled` | Events aren't enabled on this server. |
| `events_failed` | The server sent a response the SDK couldn't read. |

## Example

<strong class="example-title">List your events workers, and destroy one you no longer need</strong>

This runs in Node.js signed in with your account token.

```js
const { items, deployable } = await puter.events.workers.list();
console.log(`this server runs events workers: ${deployable}`);
for (const worker of items) {
    console.log(`${worker.appName}: ${worker.handlerCount} handler(s)`);
}

const destroyed = await puter.events.workers.destroy(appUid);   // an app you own
console.log(`removed ${destroyed.removed}, suspended ${destroyed.suspended}`);
```
