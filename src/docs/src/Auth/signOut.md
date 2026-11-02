---
title: puter.auth.signOut()
description: Sign out the current user from your application.
platforms: [websites, apps]
---

Signs the user out of the application.

On a website, signing out also turns push notifications off in this browser. It ends the push subscription Puter made for your app here and removes it from Puter, and [`onPush()`](/Notifications/onPush/) doesn't subscribe again until the next user calls [`enable()`](/Notifications/enable/). The user is signed out as soon as you call it. The returned promise resolves once the subscription is ended, so wait for it before you reload the page.

## Syntax

```js
puter.auth.signOut()
```

## Parameters

None

## Return value

A `Promise` that resolves with nothing once the user is signed out and, on a website, this browser's push subscription for your app is ended. It doesn't reject.

## Example

```html;auth-sign-out
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        puter.auth.signOut();
    </script>
</body>
</html>
```
