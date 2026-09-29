---
title: puter.events.unsubscribe()
description: End a persistent subscription.
platforms: [websites, apps, nodejs, workers]
---

<div class="info">The Events API is in beta. Event shapes, limits, and behavior may change between releases.</div>

Ends a subscription created with [`puter.events.onPersistent()`](/Events/onPersistent/). It stops immediately, and any undelivered backlog is dropped.

For a session subscription from [`puter.events.onLocal()`](/Events/onLocal/), use [`subscription.off()`](/Events/off/).

## Syntax
```js
puter.events.unsubscribe(subId)
```

## Parameters

#### `subId` (String) (required)
The `subId` of the subscription, from `onPersistent()` or [`puter.events.list()`](/Events/list/).

## Return value

A `Promise` that resolves when the subscription is gone.

An id this caller doesn't hold (already ended, or created by another app) is reported as not existing, so the call doesn't reveal which subscriptions exist. It rejects with `{ message, code }`:

| `code` | Meaning |
| --- | --- |
| `subscription_does_not_exist` | No such subscription, or it isn't this caller's. |
| `too_many_requests` | Over the subscribe/unsubscribe rate limit. |
| `events_disabled` | Events aren't enabled on this server. |
| `events_failed` | The server sent a response the SDK couldn't read. |

An app can only end subscriptions it created. An account session can end any of them, including ones left by deleted apps.

## Examples

<strong class="example-title">Create a persistent subscription, then end it</strong>

```html;events-unsubscribe
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            const dir = `~/${puter.randName()}`;
            await puter.fs.mkdir(dir);

            const sub = await puter.events.onPersistent({ subject: `fs:${dir}` });
            puter.print(`watching as ${sub.subId}<br>`);

            await puter.events.unsubscribe(sub.subId);
            puter.print('stopped<br>');

            // Ending it twice is refused the same way an unknown id is.
            try {
                await puter.events.unsubscribe(sub.subId);
            } catch (error) {
                puter.print(`second attempt: ${error.code}<br>`);
            }
        })();
    </script>
</body>
</html>
```
