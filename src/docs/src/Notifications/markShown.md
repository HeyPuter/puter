---
title: puter.notifications.markShown()
description: Mark one of your app's notifications as shown.
platforms: [websites, apps]
---

Mark one of your app's notifications as shown. The notification must be visible to your app for the user it runs for.

After you mark the newest notification in a `group` as shown, the next send with that group creates a new notification. Marking doesn't close an OS notification already shown on other devices.

## Syntax
```js
puter.notifications.markShown(uid)
```

## Parameters

#### `uid` (String) (required)
The notification's `uid`. For an immediate notification to your app's own user, [`notify()`](/Notifications/notify/) resolves with it. Notifications delivered to [`onNotification()`](/Notifications/onNotification/) and [`on('click')`](/Notifications/on/) events also carry `uid`.

## Return value

A `Promise<boolean>` that resolves to `true` when the notification is marked shown. It resolves to `false` if it was already marked shown, doesn't exist, or isn't visible to this app and user.

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
const uid = await puter.notifications.notify({ title: 'Your export is ready' });
const marked = await puter.notifications.markShown(uid);
console.log(marked);
```
