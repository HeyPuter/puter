---
title: puter.events.workers
description: List and destroy the events worker a published handler set stands up, for an app or for one user.
platforms: [websites, apps, nodejs, workers]
---

<div class="info">The Events API is in beta. Event shapes, limits, and behavior may change between releases.</div>

An **events worker** runs published [handlers](/Events/handlers/), the app's own or one user's in a [user scope](/Events/handlers/#user-scope). It runs them for every event on a subscription with a `handlerName`, whether or not a client is connected, for a [`queue`](/Events/onPersistent/#choosing-a-mode) delivery once no connected client takes it, and for every run of a [schedule](/Events/onSchedule/). Each app has at most one for its own handlers, created when it publishes its first handler. Each user scope is a unit of its own, created when the user's first handler in an app is published, whether by publishing it or by passing an inline `handler`.

A hosted Puter server may bill each app's events worker as a monthly cost, even if nothing ever delivers to it, and bills a user scope to the user the same way. Use this API to see which apps and scopes have one and remove the ones you don't need.

```js
const { items } = await puter.events.workers.list();      // [{ appUid, appName, handlerCount, ... }]
await puter.events.workers.destroy(items[0].appUid);      // removes every handler that app published
```

Outside an app, such as in Node.js with your account token, you see the workers of every app you own, and the user scopes you hold in any app. Inside an app, you see only that app's own worker, if the signed-in user owns the app, and the signed-in user's scope of that app.

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

- `items`: One `{ scope, appUid, appName, appTitle, handlerCount, createdAt, updatedAt, script }` per app worker, then one per user scope you hold. `scope` is `'app'` for an app's own worker and `'user'` for your scope of that app. In each item, `createdAt` is when the first handler was published, `updatedAt` is the latest publish, and `script` names the deployed script, which is useful when reporting an issue. A `'user'` item has no `script`.
- `cursor`: Present while more pages exist.
- `deployable`: `false` when this server doesn't run events workers, such as a self-hosted install without the runtime turned on. Handlers can still be published there, but background deliveries never run.

## `destroy()`

```js
puter.events.workers.destroy(appUid)
puter.events.workers.destroy(appUid, options)
```

- `options.scope` (String): `'app'` or `'user'`. Defaults to `'app'`. `'user'` removes the signed-in user's own scope of the app. Inside an app, `appUid` can only name that app. With an account session, outside an app such as the desktop or Node.js with your account token, `appUid` can name any app you hold a user scope in, and it works even when the server has user-scope handlers turned off.

Removes every handler the app has published, or every handler in the user's scope with `scope: 'user'`, the same as calling [`puter.events.handlers.remove()`](/Events/handlers/) on each. Their subscriptions and schedules are suspended with `handler_not_found`, not deleted, and publishing the handlers again resumes them.

It also ends the worker session background deliveries ran under, for every user, or for the one user with `scope: 'user'`. The next delivery after a new publish starts a new one.

Resolves to `{ appUid, removed, suspended }`, plus `scope: 'user'` for a user scope, the number of handlers deleted and the number of subscriptions and schedules suspended. An app with nothing published rejects with `events_handler_not_found`.

## Errors

Both methods reject with `{ message, code }`:

| `code` | Meaning |
| --- | --- |
| `auth_canceled` | Nobody was signed in, and the user closed the sign-in without finishing it. |
| `events_worker_owner_only` | `list()` was called with a scoped access token, such as the one in a [`getReadURL()`](/FS/getReadURL/) URL. |
| `events_handler_not_found` | `destroy()` named an app with no published handlers. |
| `events_handler_forbidden` | The signed-in user doesn't own the app, the app doesn't exist, the call came from a different app, or the caller is a scoped access token. For `scope: 'user'`, the caller is a scoped access token, a temporary account, or an app naming a different app than its own. |
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

<strong class="example-title">Remove the signed-in user's scope of your app</strong>

The user scope belongs to the user, so it needs no owner step. In your app, name the app itself. With an account session outside an app, name any app you hold a scope in.

```js
const destroyed = await puter.events.workers.destroy(puter.appID, { scope: 'user' });
console.log(`removed ${destroyed.removed}, suspended ${destroyed.suspended}`);
```
