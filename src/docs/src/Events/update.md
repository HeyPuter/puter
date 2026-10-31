---
title: puter.events.update()
description: Change the context of a persistent subscription without ending it.
platforms: [websites, apps, nodejs, workers]
---

<div class="info">The Events API is in beta. Event shapes, limits, and behavior may change between releases.</div>

Changes the `context` of a subscription created with [`puter.events.onPersistent()`](/Events/onPersistent/). The subscription keeps its `subId`, its handler, and any events it hasn't delivered yet, and every delivery after the call runs with the new `context` as `ctx`. Ending the subscription and subscribing again would give it a new `subId` and drop its undelivered events.

An app can change only the subscriptions it created. Outside an app, you can change any of yours. A scoped access token, such as the one in a [`getReadURL()`](/FS/getReadURL/) URL, can't change any.

On a website with nobody signed in, it asks the user to sign in first, as other Puter.js calls do. An app running on Puter is always signed in.

## Syntax
```js
puter.events.update(subId, { context })
```

## Parameters

#### `subId` (String) (required)
The `subId` of the subscription, from [`onPersistent()`](/Events/onPersistent/) or [`puter.events.list()`](/Events/list/).

#### `context` (Object | null) (required)
The new context. It replaces the old one completely and is evaluated once, at this call, like the `context` you pass to [`onPersistent()`](/Events/onPersistent/#context-is-captured-once-up-to-4-kb). Pass `null` to clear it. Over 4 KB serialized, the call fails with `events_context_too_large` before any request is made.

## Return value

A `Promise` that resolves to the updated subscription, in the same shape [`puter.events.list()`](/Events/list/) returns. Its `contextKeys` and `contextHash` describe the new context, never its values.

A delivery already running when you call `update()` finishes with the old context. A suspended subscription stays suspended and uses the new context once it resumes. If this page runs a function `handler` for the subscription, that handler gets the new context too.

The promise rejects with `{ message, code }`:

| `code` | Meaning |
| --- | --- |
| `subscription_does_not_exist` | No such subscription, or it isn't yours to change. |
| `invalid_request` | `context` is missing. |
| `events_context_too_large` | `context` is over 4 KB serialized. |
| `events_context_invalid` | `context` can't be serialized as JSON. |
| `auth_canceled` | Nobody was signed in, and the user closed the sign-in without finishing it. |
| `too_many_requests` | Over the subscribe rate limit, which `update()` counts toward. See [Rate Limits and Quotas](/rate-limits-and-quotas/#call-budgets). |
| `events_disabled` | Events aren't enabled on this server. |
| `events_failed` | The server sent a response the SDK couldn't read. |

## Examples

<strong class="example-title">Point a subscription at a new endpoint</strong>

```html;events-update
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            const dir = puter.randName();
            await puter.fs.mkdir(dir);

            const sub = await puter.events.onPersistent({
                subject: `fs:${dir}`,
                context: { endpoint: 'https://old.example/ingest' },
            });
            puter.print(`watching as ${sub.subId}<br>`);

            const updated = await puter.events.update(sub.subId, {
                context: { endpoint: 'https://new.example/ingest', retries: 3 },
            });
            puter.print(`same id: ${updated.subId === sub.subId}<br>`);
            puter.print(`context keys: ${updated.contextKeys.join(', ')}<br>`);

            await puter.events.unsubscribe(sub.subId);
        })();
    </script>
</body>
</html>
```
