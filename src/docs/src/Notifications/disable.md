---
title: puter.notifications.disable()
description: Turn off push notifications for your app in this browser.
platforms: [websites]
---

Ends this browser's push subscription for your app and removes it from Puter. Notifications still reach your app live while it's open. The browser's permission isn't changed, so a later [`enable()`](/Notifications/enable/) turns pushes back on without a prompt.

## Syntax
```js
puter.notifications.disable()
puter.notifications.disable(options)
```

## Parameters

#### `options` (Object) (optional)
- `serviceWorker` (String): path of the worker passed to `enable()`. Default `/puter-sw.js`.

## Return value
A `Promise` that resolves to `true` when a subscription was removed, and `false` when there was none.
