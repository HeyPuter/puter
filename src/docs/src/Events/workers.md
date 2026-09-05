---
title: puter.events.workers
description: List and destroy the events worker a published handler set stands up.
platforms: [websites, apps, nodejs, workers]
---

<div class="info">The Events API is in beta. Event shapes, limits, and behavior may change between releases.</div>

An [events worker](/Events/#events-worker) runs an app's published [handlers](/Events/handlers/). It is a per-app artifact, not a per-handler one: an app with five published handlers still has exactly one events worker behind them.

A hosted Puter deployment may bill an events worker as a standing monthly cost, one charge per app that has one — publishing handlers you no longer use keeps that meter running even if nothing ever delivers to them. This surface is where an app owner sees what it is running and stops paying for one it does not need.

```js
const { items } = await puter.events.workers.list();      // [{ appUid, appName, handlerCount, ... }]
await puter.events.workers.destroy(items[0].appUid);      // removes every handler that app published
```

Unlike `puter.events.handlers`, this is account-scoped rather than app-scoped: `list()` takes no `appUid` and always answers for every app *you* own, and an app token cannot list or destroy on its owner's behalf — only an account session, or the app itself destroying its own worker, may call these.

## `list()`

```js
puter.events.workers.list()
puter.events.workers.list(options)
```

- `options.limit` (Number): Apps per page.
- `options.cursor` (String): The `cursor` from a previous page. Omit to start from the first page.

Resolves to `{ items, cursor, deployable }`. Each item is `{ appUid, appName, appTitle, handlerCount, createdAt, updatedAt, script }` — `createdAt` is when the app's earliest handler was published (its events worker's birth), `updatedAt` is its most recently published or updated handler, and `script` names the deployed script, useful when reporting an issue. `cursor` is present only while more pages exist. `deployable` reports whether this server actually deploys events workers at all — `false` on a self-hosted install that has not turned the runtime on, in which case handlers can still be published but nothing ever runs a background delivery for them.

## `destroy()`

```js
puter.events.workers.destroy(appUid)
```

Removes **every** handler the named app has published, in one call — the same consequences as calling [`puter.events.handlers.remove()`](/Events/handlers/) on each of them: a name nothing is bound to is deleted outright, and a name with subscriptions on it is deleted with those subscriptions *suspended* (`suspendedReason: 'handler_not_found'`), never dropped. Publishing new handlers for the app afterwards resumes them, exactly as republishing a single removed handler would.

Resolves to `{ appUid, removed, suspended }` — `removed` is how many handlers were deleted, `suspended` how many subscriptions that left suspended across all of them. An app with nothing published rejects with `events_handler_not_found`.

## Errors

Both methods reject with `{ message, code }`:

| `code` | Meaning |
| --- | --- |
| `events_worker_owner_only` | `list()` was called by an app rather than an account session. |
| `events_handler_not_found` | `destroy()` named an app with no published handlers. |
| `events_handler_forbidden` | The caller does not own the app named to `destroy()` — and an app that is not there answers the same way. |
| `too_many_requests` | Over the handler publish/remove or listing budget. |
| `events_disabled` | Events are not enabled on this server. |
| `events_failed` | The server answered with something the SDK could not make sense of. |

## Example

<strong class="example-title">List an account's events workers, and destroy one that is no longer needed</strong>

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            const name = `retired-${puter.randName()}`;
            const app = await puter.apps.create(name, `https://example.com/${name}`);

            await puter.events.handlers.publish(
                'ingestUpload',
                async ({ event, ctx }) => {
                    await fetch(ctx.endpoint, { method: 'POST', body: event.path });
                },
                { appUid: app.uid },
            );

            const { items, deployable } = await puter.events.workers.list();
            puter.print(`this server deploys events workers: ${deployable}<br>`);
            for (const worker of items) {
                puter.print(`${worker.appName}: ${worker.handlerCount} handler(s)<br>`);
            }

            const destroyed = await puter.events.workers.destroy(app.uid);
            puter.print(`removed ${destroyed.removed}, suspended ${destroyed.suspended}<br>`);
        })();
    </script>
</body>
</html>
```
