---
title: puter.notifications.registerDevice()
description: Register a device to receive the user's push notifications. For Puter's own web and mobile apps.
platforms: [websites, apps]
---

<div class="info">This is for Puter's own web and mobile apps, which decide where pushes go. It needs a signed-in Puter session; an app's token is refused with <code>forbidden</code>. Apps send notifications with <a href="/Notifications/notify/"><code>notify()</code></a> and never need it.</div>

Registers a device to receive the user's push notifications, or refreshes it if its token is already registered. A user can have up to 20 devices. Registering another removes the one seen least recently.

On puter.com, this call doesn't register devices. It rejects with `push_platform_unavailable` for every platform. A browser turns pushes on with [`enable()`](/Notifications/enable/) instead.

## Syntax
```js
puter.notifications.registerDevice({ platform, token, label })
```

## Parameters

#### `registration` (Object) (required)

- `platform` (String) (required): `'web'`, `'ios'` or `'android'`.
- `token` (String) (required): The push token the platform issued for this device.
- `label` (String): A name the user will recognize, such as `Pixel 8`. Up to 64 characters.

## Return value

A `Promise` that resolves to the device:

- `uid` (String)
- `platform` (String)
- `label` (String | null)
- `userAgent` (String | null)
- `createdAt` (Number): Unix seconds.
- `lastSeenAt` (Number): Unix seconds.
- `current` (Boolean): Registered from this session.

The push token itself is never returned.

It rejects with an error carrying `message` and `code`:

| `code` | Meaning |
| --- | --- |
| `invalid_argument` | `registration` isn't an object. |
| `bad_request` | `platform`, `token` or `label` isn't valid. |
| `forbidden` | Not called from a signed-in Puter session. |
| `push_platform_unavailable` | This server has no push provider for `platform`. On puter.com, every platform gets it. |
| `push_device_conflict` | The token is registered to another account. |
| `push_disabled` | This server doesn't send push notifications. |
| `push_unavailable` | This deployment has no push notification service, as on most self-hosted servers. |
