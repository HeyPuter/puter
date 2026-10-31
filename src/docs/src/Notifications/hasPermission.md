---
title: puter.notifications.hasPermission()
description: Check whether the user lets your app send push notifications, without asking.
platforms: [websites, apps]
---

Whether the user lets your app send push notifications. It never prompts, so use it to decide whether to ask with [`requestPermission()`](/Notifications/requestPermission/).

The user gives this permission in Puter's prompt, or on a website by turning pushes on with [`enable()`](/Notifications/enable/). It says nothing about the browser the user is in. To check whether pushes reach this browser, use [`status()`](/Notifications/status/).

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

<strong class="example-title">Ask only when the app isn't allowed yet</strong>

```js
if (!await puter.notifications.hasPermission()) {
    showAllowPushesButton();
}
```
