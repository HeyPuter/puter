---
title: puter.notifications.listDevices()
description: List the devices registered for the user's push notifications. For Puter's own web and mobile apps.
platforms: [websites, apps]
---

<div class="info">This is for Puter's own web and mobile apps. It needs a signed-in Puter session; an app's token is refused with <code>forbidden</code>.</div>

Lists the devices that receive the user's push notifications, newest first.

## Syntax
```js
puter.notifications.listDevices()
```

## Parameters
None.

## Return value

A `Promise` that resolves to an array of devices, each shaped as [`registerDevice()`](/Notifications/registerDevice/#return-value) returns it. `current` marks the device registered from this session.

It rejects with `push_unavailable` if this deployment has no push notification service, as on most self-hosted servers.
