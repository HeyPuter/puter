---
title: puter.notifications.dismiss()
description: Mark one of your app's notifications as dismissed.
platforms: [websites, apps]
---

Mark one of your app's notifications as dismissed. The notification must be visible to your app for the user it runs for.

After you mark the newest notification in a `group` as dismissed, the next send with that group creates a new notification.

Dismissal reaches your app's connected pages on other devices through its live notification feed. Pages listening through [`onNotification()`](/Notifications/onNotification/), [`onPush()`](/Notifications/onPush/) or [`on('dismiss')`](/Notifications/on/) close the matching browser notification. This page also closes its copy when the call resolves, including when it returns `false`.

A device with no connected page closes its copy the next time a page starts one of those listeners. Startup checks up to 50 displayed notifications and closes any already dismissed without calling dismissal handlers. A disconnected page performs the same check when its feed reconnects. Delivery needs [Events](/Events/) enabled on the server. Dismissal sends no push solely to close a notification.

## Syntax
```js
puter.notifications.dismiss(uid)
```

## Parameters

#### `uid` (String) (required)
The notification's `uid`. For an immediate notification to your app's own user, [`notify()`](/Notifications/notify/) resolves with it. Notifications delivered to [`onNotification()`](/Notifications/onNotification/) and [`on('click')`](/Notifications/on/) events also carry `uid`.

## Return value

A `Promise<boolean>` that resolves to `true` when the notification is marked dismissed. It resolves to `false` if it was already marked dismissed, doesn't exist, or isn't visible to this app and user.

It rejects with an error carrying `message` and `code`:

| `code` | Meaning |
| --- | --- |
| `invalid_argument` | The `uid` isn't a non-empty string. |
| `notifications_failed` | The server didn't return a boolean mark result. |
| `too_many_requests` | Over the notification driver rate limit. |
| `auth_canceled` | Nobody was signed in, and the user closed sign-in without finishing it. |

Other authentication and server errors pass through.

## Examples

```js
puter.notifications.on('click', async ({ uid }) => {
    const dismissed = await puter.notifications.dismiss(uid);
    console.log(dismissed);
});
```
