---
title: puter.notifications.requestPermission()
description: Ask the user to allow push notifications from your app.
platforms: [websites, apps]
---

Asks the user to let your app send push notifications. Your notifications always show in the user's Puter notifications panel. This decides whether they also reach the user's devices when the user isn't looking at your app.

It asks for the [`notifications:push`](/Perms/request/#push-notifications) permission. Inside the Puter desktop the prompt is a dialog; on a website it opens in a popup on the Puter origin, so call it from a user gesture such as a click. If the user already allowed it, it resolves `true` without asking.

When the user allows it, Puter also turns push notifications on in the browser they answered in, unless they are on there already or the browser blocks them. To offer that in a browser where your app already holds the permission, call [`enablePush()`](/Notifications/enablePush/).

The user can change their mind later. Your notifications still show in Puter either way.

## Syntax
```js
puter.notifications.requestPermission()
```

## Parameters
None.

## Return value
A `Promise` that resolves to `true` if your app may send pushes, and `false` if the user declined.

## Examples

<strong class="example-title">Ask from a button</strong>

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <button id="allow">Notify me on my phone</button>
    <script>
        document.getElementById('allow').addEventListener('click', async () => {
            const allowed = await puter.notifications.requestPermission();
            puter.print(allowed ? 'Pushes on<br>' : 'Pushes off<br>');
        });
    </script>
</body>
</html>
```
