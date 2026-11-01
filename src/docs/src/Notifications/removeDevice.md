---
title: puter.notifications.removeDevice()
description: Stop push notifications to one of the user's devices. For Puter's own apps.
platforms: [websites, apps]
---

<div class="info">This is for Puter's own apps. It needs a signed-in Puter session; an app's token is refused with <code>forbidden</code>.</div>

Removes one of the user's devices, so it gets no more push notifications. Signing out of a session also removes the devices registered from it.

Removing a `'webpush'` device sticks. The website that subscribed that browser doesn't register it again on page loads. The site turns pushes off in that browser the next time a page with [`onPush()`](/Notifications/onPush/) loads or calls [`status()`](/Notifications/status/). Calling [`enable()`](/Notifications/enable/) on the site turns them back on.

## Syntax
```js
puter.notifications.removeDevice(uid)
```

## Parameters

#### `uid` (String) (required)
The device's `uid`, from [`listDevices()`](/Notifications/listDevices/).

## Return value

A `Promise` that resolves once the device is removed. It rejects with `device_not_found` if the user has no device with that `uid`, and with `push_unavailable` if this deployment has no push notification service, as on most self-hosted servers.
