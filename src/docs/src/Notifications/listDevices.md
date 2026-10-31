---
title: puter.notifications.listDevices()
description: List the devices registered for the user's push notifications. For Puter's own apps.
platforms: [websites, apps]
---

<div class="info">This is for Puter's own apps. It needs a signed-in Puter session, and it rejects an app's token with <code>forbidden</code>.</div>

Lists the browsers and devices that receive the user's push notifications, newest first, up to 50. It includes the browsers registered for Puter itself and for each app.

## Syntax
```js
puter.notifications.listDevices()
```

## Parameters
None.

## Return value

A `Promise` that resolves to an array of devices:

- `uid` (String): Pass it to [`removeDevice()`](/Notifications/removeDevice/).
- `platform` (String): `'webpush'` for a browser subscribed with Web Push. A `'web'` device is an older browser registration that gets no pushes and is removed once it goes unseen.
- `label` (String | null)
- `userAgent` (String | null): The browser's user agent when it was registered.
- `createdAt` (Number): Unix seconds.
- `lastSeenAt` (Number): Unix seconds. When a push last reached it, or a page last renewed it.
- `current` (Boolean): Registered from the session making the call.

The push token itself is never returned.

It rejects with `push_unavailable` if this deployment has no push notification service, as on most self-hosted servers.
