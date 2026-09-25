---
title: puter.events.unsubscribe()
description: End a persistent subscription.
platforms: [websites, apps, nodejs, workers]
---

<div class="info">The Events API is in beta. Event shapes, limits, and behavior may change between releases.</div>

Ends a subscription created with [`puter.events.onPersistent()`](/Events/onPersistent/). It stops matching immediately, and any backlog it was still owed is dropped with it.

For a session subscription made with [`puter.events.onLocal()`](/Events/onLocal/), use [`subscription.off()`](/Events/off/) instead.

## Syntax
```js
puter.events.unsubscribe(subId)
```

## Parameters

#### `subId` (String) (required)
The `subId` of the subscription to end, as `onPersistent()` returned it or as [`puter.events.list()`](/Events/list/) reports it.

## Return value

A `Promise` that resolves when the subscription is gone.

An id this caller does not hold — one already ended, or one another app created — **reads as absent** rather than refused, so the call cannot be used to find out which subscriptions exist. It rejects with `{ message, code }`:

| `code` | Meaning |
| --- | --- |
| `subscription_does_not_exist` | No such subscription, or not this caller's. |
| `too_many_requests` | Over the subscribe/unsubscribe call budget. |
| `events_disabled` | Events are not enabled on this server. |
| `events_failed` | The server answered with something the SDK could not make sense of. |

An app may only end the subscriptions it created. A session acting for the account may end any of them, including ones left behind by an app that is gone.

## Examples

<strong class="example-title">Create a persistent subscription, then end it</strong>

```html
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
