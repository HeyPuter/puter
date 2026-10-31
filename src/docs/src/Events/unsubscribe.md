---
title: puter.events.unsubscribe()
description: End a persistent subscription.
platforms: [websites, apps, nodejs, workers]
---

<div class="info">The Events API is in beta. Event shapes, limits, and behavior may change between releases.</div>

Ends a subscription created with [`puter.events.onPersistent()`](/Events/onPersistent/). It stops right away, and any undelivered backlog is dropped. For a session subscription from [`puter.events.onLocal()`](/Events/onLocal/), use [`subscription.off()`](/Events/off/).

An app can end only the subscriptions it created. Outside an app, you can end any of yours, including ones left by deleted apps. A scoped access token, such as the one in a [`getReadURL()`](/FS/getReadURL/) URL, can't end any.

On a website with nobody signed in, it asks the user to sign in first, as other Puter.js calls do. An app running on Puter is always signed in.

## Syntax
```js
puter.events.unsubscribe(subId)
```

## Parameters

#### `subId` (String) (required)
The `subId` of the subscription, from [`onPersistent()`](/Events/onPersistent/) or [`puter.events.list()`](/Events/list/).

## Return value

A `Promise` that resolves when the subscription is gone.

An id you don't hold, because it already ended or another app created it, is reported as not existing, so the call doesn't reveal which subscriptions exist. If the call rejects with any other code, the subscription is still running, and so is any handler it runs on this page.

The promise rejects with `{ message, code }`:

| `code` | Meaning |
| --- | --- |
| `subscription_does_not_exist` | No such subscription, or it isn't yours to end. |
| `auth_canceled` | Nobody was signed in, and the user closed the sign-in without finishing it. |
| `too_many_requests` | Over the unsubscribe rate limit, which is separate from the subscribe one. |
| `events_disabled` | Events aren't enabled on this server. |
| `events_failed` | The server sent a response the SDK couldn't read. |

## Examples

<strong class="example-title">Create a persistent subscription, then end it</strong>

```html;events-unsubscribe
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            const dir = puter.randName();
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
