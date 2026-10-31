---
title: puter.notifications.onNotification()
description: Receive your app's notifications while it's open, including the ones sent while it was closed.
platforms: [websites, apps]
---

Calls `handler` for each of your app's notifications while the app is open. It first hands over the notifications your app already has, oldest first, then each new one as it's sent. When the connection drops, it reads back the ones sent or replaced meanwhile once the connection returns. Each notification reaches a listener once. A notification [replaced through its `group`](/Notifications/notify/#groups) keeps its `uid` and reaches the listener again, once per replacement, with the new content and `replaced: true`.

It receives only notifications your app sent, never the user's other notifications. It has to run as an app, meaning an app on Puter or a website using Puter.js. With an account session and no app, such as Node.js with an account token, it rejects with `app_required`. On a website with nobody signed in, it asks the user to sign in first.

It runs on [Events](/Events/) and reads the `notif:app-user` [subject](/Events/subjects/#notifications), so the server needs events turned on. Where they're off, it rejects with `events_disabled`.

While a page has a listener, it tells Puter that it received each notification, and whether the user is looking at the page. That can keep the notification from going out as a push, as [When a notification is pushed](/Notifications/push/#when-a-notification-is-pushed) describes.

## Syntax
```js
puter.notifications.onNotification(handler)
puter.notifications.onNotification(handler, options)
```

## Parameters

#### `handler` (Function) (required)
Called with one notification:

- `uid` (String): The notification's id. A replacement has the same `uid` as the notification it replaced.
- `title` (String)
- `text` (String | null)
- `icon` (String | null)
- `target` (String | null)
- `data` (any): `null` when it was sent without one.
- `group` (String | null)
- `channel` (String | null)
- `sensitive` (Boolean): `true` when it was sent with `sensitive: true`. The handler still gets its title and text.
- `createdAt` (Number): When it was sent, in milliseconds since the epoch. For a replacement, when it was replaced.
- `replaced` (Boolean): `true` when it replaced an earlier notification in its `group` and kept that one's `uid`. Show it in place of the one you already have with that `uid`.
- `app` (Object | null): The app that sent it, as `{ uid, name, icon }`.

A handler that throws or rejects is logged to the console, and the listener keeps going.

#### `options` (Object) (optional)

- `catchUp` (Boolean): Hand over the notifications your app already has before the new ones. Defaults to `true`. With `false`, only notifications sent after the call are handed over.
- `since` (Number): Milliseconds since the epoch. Notifications read back, when catching up or after a reconnect, are handed over only if they were sent in or after that second. Pass the `createdAt` of the last one you handled. That one can come again, so skip it by `uid`. Live notifications are always handed over.
- `onError` (Function): Called with `{ message, code }` when the listener stops on its own. That happens when the connection couldn't be restored, when reading what was missed after a reconnect failed, or when the signed-in account or app changed (`code: 'auth_changed'`). The listener has already stopped by then, and nothing more is handed over. Call [`onNotification()`](/Notifications/onNotification/) again to resume. It's also called, without stopping the listener, with `code: 'catch_up_truncated'` if reading back had to stop early. Without `onError`, errors are logged to the console.

## Return value

A `Promise` that resolves, once the listener is live and caught up, to an object with:

- `off()` (Function): Stops the listener. Returns a `Promise`. Calling it again does nothing.

It rejects with an error carrying `message` and `code`:

| `code` | Meaning |
| --- | --- |
| `invalid_handler` | `handler` isn't a function. |
| `invalid_argument` | `since` isn't a number. |
| `app_required` | The call isn't made as an app. |
| `events_disabled` | This server doesn't have events turned on. |
| `auth_canceled` | Nobody was signed in, and the user closed the sign-in without finishing it. |

## Examples

<strong class="example-title">Show new notifications as they arrive</strong>

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            const listener = await puter.notifications.onNotification((n) => {
                puter.print(`${n.title}: ${n.text ?? ''}<br>`);
            });

            await puter.notifications.notify({ title: 'Hello from the app' });

            setTimeout(() => listener.off(), 5000);
        })();
    </script>
</body>
</html>
```
