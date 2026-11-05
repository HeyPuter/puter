---
title: puter.notifications.requestPermission()
description: Ask the user to allow push notifications from your app.
platforms: [websites, apps]
---

Asks the user to let your app send push notifications. Your notifications always reach your app live while it's open. This permission decides whether they also go out as pushes.

It asks for the `'pushNotifications'` resource of [`puter.perms.request()`](/Perms/request/#push-notifications). To ask in the same prompt as other access, such as `'backgroundEvents'` for an [events handler](/Events/handlers/), pass both to [`puter.perms.request()`](/Perms/request/#batching) instead.

Inside the Puter desktop the prompt is a dialog. On a website it opens in a popup on the Puter origin, so call it from a user gesture such as a click. If the user already allowed it, it resolves `true` without asking.

When the user allows it, Puter also turns its own pushes on in the browser they answered in, unless they're on there already or the browser blocks them. Pushes through Puter show with your app's name and icon, and a tap opens your app inside the Puter desktop. A website that wants pushes on its own domain calls [`enable()`](/Notifications/enable/) instead, which allows pushes from your app without this prompt. [Where a push goes](/Notifications/push/#where-a-push-goes) has the rule.

You need this call on a website after the user turned your app off in Puter's settings. Until the user allows your app again, [`enable()`](/Notifications/enable/) rejects with `push_revoked`.

The user can turn your app's pushes off later in Puter's settings. Your notifications still reach your app live either way.

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
            puter.print(allowed ? 'Pushes allowed<br>' : 'Pushes not allowed<br>');
        });
    </script>
</body>
</html>
```
