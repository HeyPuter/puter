---
title: puter.notifications.onNotification()
description: Receive your app's notifications while it's open, including the ones sent while it was closed.
platforms: [websites, apps]
---

Calls `handler` for each of your app's notifications while the app is open. It first hands over the notifications your app already has, oldest first, then each new one as it's sent. If the connection drops, the ones sent meanwhile are read back when it returns. Each notification reaches a listener once, however it arrived. A notification [replaced through its `group`](/Notifications/notify/#groups) keeps its `uid`, so a listener isn't called again for the replacement.

It only receives notifications your app sent, never the user's other notifications. It needs to run as an app (an app on Puter, or a website using Puter.js); with an account session and no app, such as the Puter desktop itself or Node.js with an account token, it rejects with `app_required`.

It runs on [Events](/Events/), so the server needs events turned on. Where they're off, it rejects with `events_disabled`.

## Syntax
```js
puter.notifications.onNotification(handler)
puter.notifications.onNotification(handler, options)
```

## Parameters

#### `handler` (Function) (required)
Called with one notification:

- `uid` (String): The notification's id. Use it to skip ones you already handled.
- `title` (String)
- `text` (String | null)
- `icon` (String | null)
- `target` (String | null)
- `data` (any): `null` when it was sent without one.
- `group` (String | null)
- `channel` (String | null)
- `createdAt` (Number): When it was sent, in milliseconds since the epoch.
- `app` (Object | null): The app that sent it, as `{ uid, name, icon }`.

A handler that throws is logged to the console; the listener keeps going.

#### `options` (Object) (optional)

- `catchUp` (Boolean): Hand over the notifications your app already has before the new ones. Defaults to `true`. With `false`, only notifications sent from now on are delivered.
- `since` (Number): Milliseconds since the epoch. Notifications read back (when catching up, or after a reconnect) are handed over only if they were sent in or after this second. Pass the `createdAt` of the last one you handled; that one can come again, so skip it by `uid`. Live notifications are always handed over.
- `onError` (Function): Called with `{ message, code }` when the listener stops on its own: the connection couldn't be restored, reading what was missed after a reconnect failed, or the signed-in account or app changed (`code: 'auth_changed'`). The listener is already stopped by then, and nothing more is handed over; call `onNotification()` again to resume. It's also called, without stopping, with `code: 'catch_up_truncated'` if reading back had to stop early. Without it, errors are logged to the console.

## Return value

A `Promise` that resolves, once the listener is live and caught up, to an object with:

- `off()` (Function): Stops the listener. Returns a `Promise`; calling it again does nothing.

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
