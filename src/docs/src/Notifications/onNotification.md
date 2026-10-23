---
title: puter.notifications.onNotification()
description: Receive your app's notifications while it's open, including the ones sent while it was closed.
platforms: [websites, apps]
---

Calls `handler` for each of your app's notifications while the app is open. It first hands over the notifications your app already has, oldest first, then each new one as it's sent. If the connection drops, the ones sent meanwhile are read back when it returns. Each notification reaches a listener once, however it arrived.

It only receives notifications your app sent, never the user's other notifications.

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
- `since` (Number): With `catchUp`, only hand over notifications sent after this time, in milliseconds since the epoch. Pass the `createdAt` of the last one you handled.
- `onError` (Function): Called with `{ message, code }` if the listener stops after it started, because the connection couldn't be restored, or reading what was missed failed. Without it, the error is logged to the console.

## Return value

A `Promise` that resolves, once the listener is live and caught up, to an object with:

- `off()` (Function): Stops the listener. Returns a `Promise`; calling it again does nothing.

It rejects with an error carrying `message` and `code`:

| `code` | Meaning |
| --- | --- |
| `invalid_handler` | `handler` isn't a function. |
| `invalid_argument` | `since` isn't a number. |
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
