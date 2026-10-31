---
title: puter.notifications.listDevices()
description: List the devices registered for the user's push notifications. For Puter's own apps.
platforms: [websites, apps]
---

<div class="info">This is for Puter's own apps. It needs a signed-in Puter session; an app's token is refused with <code>forbidden</code>.</div>

Lists the devices that receive the user's push notifications, newest first.

## Syntax
```js
puter.notifications.listDevices()
```

## Parameters
None.

## Return value

A `Promise` that resolves to an array of devices:

- `uid` (String)
- `platform` (String): `'webpush'` for a browser subscribed with Web Push. `'web'` is an older browser registration that gets no pushes and is removed once it goes unseen.
- `label` (String | null)
- `userAgent` (String | null)
- `createdAt` (Number): Unix seconds.
- `lastSeenAt` (Number): Unix seconds.
- `current` (Boolean): Registered from this session.

The push token itself is never returned.

It rejects with `push_unavailable` if this deployment has no push notification service, as on most self-hosted servers.
