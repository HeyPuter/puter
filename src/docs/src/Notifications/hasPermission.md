---
title: puter.notifications.hasPermission()
description: Check whether the user lets your app send push notifications, without asking.
platforms: [websites, apps]
---

Whether the user lets your app send push notifications. It never prompts, so use it to decide whether to show your own "turn on notifications" button, which calls [`requestPermission()`](/Notifications/requestPermission/).

The answer is about the app making the call. Called from an account session with no app, such as Node.js with an account token, it's always `true`.

## Syntax
```js
puter.notifications.hasPermission()
```

## Parameters
None.

## Return value
A `Promise` that resolves to `true` or `false`.

## Examples

<strong class="example-title">Only offer the button when it's needed</strong>

```js
if ( ! await puter.notifications.hasPermission() ) {
    showEnablePushesButton();
}
```
