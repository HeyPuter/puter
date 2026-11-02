---
title: puter.notifications.enablePush()
description: Turn on push notifications through Puter in the browser the user is in.
platforms: [websites, apps]
---

Offers to turn on Puter's push notifications in the browser the user is in, so your app's pushes can reach that browser through Puter. Puter shows them with your app's name and icon, and a tap opens your app inside the Puter desktop. [Where a push goes](/Notifications/push/#where-a-push-goes) says when pushes go through Puter. Call it from a user gesture such as a click.

Inside the Puter desktop, it shows a dialog with a "Turn on notifications" button, and [`enable()`](/Notifications/enable/) is the same call. When your app doesn't hold the permission yet, it shows Puter's permission dialog instead, and allowing it also turns pushes on in this browser, so the user answers one dialog.

On a website, it opens a small popup on the Puter origin with the same button. Your app needs the permission first, so call [`requestPermission()`](/Notifications/requestPermission/) before it. Without the permission, it resolves `false`. To get pushes on your own domain instead, use [`enable()`](/Notifications/enable/).

When pushes are already on in this browser and your app holds the permission, it resolves `true` without asking. When the browser blocks notifications for Puter, or the server has no push service, it resolves `false` without asking.

## Syntax
```js
puter.notifications.enablePush()
```

## Parameters
None.

## Return value
A `Promise` that resolves to `true` when this browser receives push notifications after the call, and `false` otherwise. It never rejects.

On a website that is cross-origin isolated, the popup can't report back, so the promise resolves `false` while the popup stays open for the user. Treat `false` as not confirmed.

## Examples

<strong class="example-title">Turn on pushes in this browser from a button</strong>

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <button id="allow">Notify me in this browser</button>
    <script>
        document.getElementById('allow').addEventListener('click', async () => {
            const on = await puter.notifications.enablePush();
            puter.print(on ? 'Pushes reach this browser<br>' : 'Pushes are off in this browser<br>');
        });
    </script>
</body>
</html>
```
