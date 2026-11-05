---
title: puter.notifications.dismiss()
description: Dismiss one of your app's notifications, and close it on the user's other devices.
platforms: [websites, apps]
---

Marks one of your app's notifications as dismissed, such as when the user reads the message it's about. Every open page of your app hears about it through [`on('dismiss')`](/Notifications/on/), on any of the user's devices, and the notification closes there.

After you dismiss the newest notification in a [group](/Notifications/notify/#groups), the next send with that group creates a new notification instead of replacing it. To get that without closing anything, use [`markShown()`](/Notifications/markShown/).

## Closing it on other devices

On a website, the notification closes on each device where a page of your app has a live notification listener, meaning an [`onNotification()`](/Notifications/onNotification/), [`onPush()`](/Notifications/onPush/) or [`on('dismiss')`](/Notifications/on/) listener. The page that calls `dismiss()` closes its own copy when the call resolves, even when it resolves `false`.

On a device with no such page open, the notification stays on screen until a page of your app starts one of those listeners. The page then checks up to 50 notifications on screen and closes the ones already dismissed. It does the same check when its connection comes back after a drop. These checks don't call your [`on('dismiss')`](/Notifications/on/) handlers.

Puter doesn't send a push only to close a notification, since browsers show a notification for every push. For a push Puter shows, such as one for an app inside the Puter desktop, an open Puter desktop on that device closes it.

Dismissals reach other pages through [Events](/Events/), so a server without events doesn't deliver them.

## Syntax
```js
puter.notifications.dismiss(uid)
```

## Parameters

#### `uid` (String) (required)
The notification's `uid`. For an immediate notification to your app's own user, [`notify()`](/Notifications/notify/) resolves with it. Notifications delivered to [`onNotification()`](/Notifications/onNotification/) and [`on('click')`](/Notifications/on/) also carry it.

## Return value

A `Promise` that resolves to `true` when the notification is dismissed. It resolves to `false` when it was already dismissed, doesn't exist, or isn't one of your app's notifications for this user.

It rejects with an error carrying `message` and `code`:

| `code` | Meaning |
| --- | --- |
| `invalid_argument` | `uid` isn't a non-empty string. |
| `too_many_requests` | Too many notification calls in a short time. Try again later. |
| `auth_canceled` | Nobody was signed in, and the user closed the sign-in without finishing it. |
| `notifications_failed` | The server sent a response the SDK couldn't read. |

## Examples

<strong class="example-title">Dismiss a notification and hear about it</strong>

```html;notifications-dismiss
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            // (1) Every open page of the app hears about dismissals, on any device
            puter.notifications.on('dismiss', ({ uid }) => {
                puter.print(`dismissed ${uid}<br>`);
            });

            // (2) Send one, then dismiss it
            const uid = await puter.notifications.notify({ title: 'New message from Ana' });
            const dismissed = await puter.notifications.dismiss(uid);
            puter.print(`dismiss() resolved ${dismissed}<br>`);
        })();
    </script>
</body>
</html>
```

<strong class="example-title">Dismiss a notification once the user opens it</strong>

```js
puter.notifications.on('click', async ({ uid, target }) => {
    await puter.notifications.dismiss(uid);
    location.assign(target ?? '/');
});
```
