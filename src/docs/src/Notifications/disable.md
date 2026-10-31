---
title: puter.notifications.disable()
description: Turn off push notifications for your app in this browser.
platforms: [websites]
---

Ends this browser's push subscription for your app and removes it from Puter. Notifications still reach your app live while it's open. Pages of your site in this browser stop showing notifications themselves while they're in the background, including pages open in other tabs, so a notification goes out as a push to the user's other devices instead. The browser's permission isn't changed, so a later [`enable()`](/Notifications/enable/) turns pushes back on without a prompt.

The choice sticks. Page loads don't turn pushes back on, because [`onPush()`](/Notifications/onPush/) only keeps a subscription current after [`enable()`](/Notifications/enable/). Call [`enable()`](/Notifications/enable/) from a click to turn them on again.

## Syntax
```js
puter.notifications.disable()
puter.notifications.disable(options)
```

## Parameters

#### `options` (Object) (optional)
- `serviceWorker` (String): path of the worker passed to [`enable()`](/Notifications/enable/). Default `/puter-sw.js`.

## Return value
A `Promise` that resolves to `true` when a subscription was removed, and `false` when there was none. It also resolves `false` inside the Puter desktop and in a browser that can't receive pushes.

If Puter can't remove the subscription, it rejects with an error carrying `message` and `code`, such as `push_unavailable` when this server has no push notification service. This browser's subscription is ended either way.
