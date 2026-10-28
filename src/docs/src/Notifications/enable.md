---
title: puter.notifications.enable()
description: Turn on push notifications for your app in this browser.
platforms: [websites, apps]
---

Turns on push notifications for your app in the browser the user is in. Call it from a click: it asks the browser's permission first, before anything else, because browsers only show that prompt from a user gesture.

On a website, the browser asks on your own origin, and pushes arrive through your service worker (see [`onPush()`](/Notifications/onPush/)). Puter then sends a confirmation push to that browser, and the device is registered once your page hands the confirmation back. Allowing it also lets your app's notifications go out as pushes. If the user later turns your app off in Puter's settings, that stands and the call rejects with `push_revoked`. To ask again, call [`requestPermission()`](/Notifications/requestPermission/) from a click, which opens Puter's permission prompt, and then call `enable()` again.

Inside the Puter desktop it does what [`enablePush()`](/Notifications/enablePush/) does.

Once enabled, [`onPush()`](/Notifications/onPush/) keeps the subscription current on later visits without asking again.

## Syntax
```js
puter.notifications.enable()
puter.notifications.enable(options)
```

## Parameters

#### `options` (Object) (optional)
- `serviceWorker` (String): path of the worker that imports `push-sw.js`. Default `/puter-sw.js`.

## Return value
A `Promise` that resolves to `true` when this browser receives pushes for your app, and `false` when the user didn't allow notifications or the browser can't receive pushes. It rejects with `push_unavailable` when the server has no push service, `push_revoked` when the user turned your app off in Puter's settings, `push_worker_unavailable` when the service worker can't be registered, and `push_verification_timeout` when the confirmation push didn't arrive.

On a website with nobody signed in, it opens the sign-in after the browser's prompt. Signing the user in first avoids a blocked popup.
