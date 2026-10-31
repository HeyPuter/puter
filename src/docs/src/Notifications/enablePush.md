---
title: puter.notifications.enablePush()
description: Offer to turn on push notifications in the browser the user is in.
platforms: [websites, apps]
---

Offers to turn on push notifications in the browser the user is using right now. A push only reaches a browser once the user has turned push notifications on there, and the browser asks for that from a click on the Puter origin. This call provides that click. Inside the Puter desktop it shows a dialog with a "Turn on notifications" button, and on a website it opens a small popup on the Puter origin with the same button. Call it from a user gesture such as a click.

When push notifications are already on in this browser and your app holds the [`notifications:push`](/Notifications/requestPermission/) permission, it resolves `true` without showing anything. When the browser has blocked notifications for Puter, or the server has no push service, it resolves `false` without showing anything either.

When your app doesn't hold the permission yet, inside the Puter desktop it shows Puter's permission dialog instead of the button. Allowing it also turns push on in this browser, so the user answers one dialog. If the user declines, it resolves `false`. On a website it resolves `false` without showing anything, so call [`requestPermission()`](/Notifications/requestPermission/) first there.

Puter also turns push on in the browser by itself where it can. When the user allows [`notifications:push`](/Notifications/requestPermission/) in the permission prompt, that prompt turns push on in the same browser. When the browser already allows notifications from Puter and your app holds the permission, the Puter desktop registers the browser without asking. This call is for the remaining case, a website on its own domain in a browser that has not allowed notifications from Puter yet.

Whether your app's notifications go out as pushes at all is decided by [`requestPermission()`](/Notifications/requestPermission/). Ask for that first.

## Syntax
```js
puter.notifications.enablePush()
```

## Parameters
None.

## Return value
A `Promise` that resolves to `true` when this browser receives push notifications after the call, and `false` otherwise. It never rejects.

On a website that is cross-origin isolated, the popup cannot report back and the promise resolves `false` while the popup stays open for the user. Treat `false` as "not confirmed".

## Examples

<strong class="example-title">Offer pushes after the user allowed them</strong>

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <button id="allow">Notify me</button>
    <script>
        document.getElementById('allow').addEventListener('click', async () => {
            const allowed = await puter.notifications.requestPermission();
            if ( ! allowed ) return;
            const on = await puter.notifications.enablePush();
            puter.print(on ? 'Pushes reach this browser<br>' : 'Pushes reach your other devices<br>');
        });
    </script>
</body>
</html>
```
