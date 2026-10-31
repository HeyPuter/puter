---
title: puter.notifications.enable()
description: Turn on push notifications for your app in this browser.
platforms: [websites, apps]
---

Turns on push notifications for your app in the browser the user is in. Call it from a click. It asks for the browser's permission first, before anything else, because browsers only show that prompt from a user gesture.

On a website, the browser asks on your own origin, and pushes arrive through your service worker (see [`onPush()`](/Notifications/onPush/)). Puter then sends a confirmation push to that browser, which shows once as "Notifications are on". Allowing it also lets your app's notifications go out as pushes.

The call resolves as soon as the browser has answered and Puter has its subscription. It doesn't wait for the confirmation. Pushes start once your page hands the confirmation back, usually within seconds. If the confirmation doesn't arrive within 30 seconds, the `onError` of [`onPush()`](/Notifications/onPush/) gets `push_verification_timeout`, or the console does without one, and the next page load tries again.

The choice sticks. Once enabled, [`onPush()`](/Notifications/onPush/) keeps the subscription current on later page loads without asking again. After [`disable()`](/Notifications/disable/), after the user turns your app off in Puter, or after [`puter.auth.signOut()`](/Auth/signOut/), page loads don't subscribe again until your page calls [`enable()`](/Notifications/enable/) again from a click.

If the user turned your app off in Puter's settings, the call rejects with `push_revoked`. To ask again, call [`requestPermission()`](/Notifications/requestPermission/) from a click, which opens Puter's permission prompt, and then call [`enable()`](/Notifications/enable/) again.

Pushes on a website need HTTPS, or `localhost` while you develop. On iOS and iPadOS they need version 16.4 or later and a site the user added to their Home Screen, with a web app manifest that sets `"display": "standalone"`. In a browser that can't receive pushes, the call resolves `false`.

Inside the Puter desktop it does what [`enablePush()`](/Notifications/enablePush/) does. When your app doesn't hold the [`notifications:push`](/Notifications/requestPermission/) permission yet, that's Puter's permission dialog, and allowing it also turns push on in this browser.

## Syntax
```js
puter.notifications.enable()
puter.notifications.enable(options)
```

## Parameters

#### `options` (Object) (optional)
- `serviceWorker` (String): path of the worker that imports `push-sw.js`. Default `/puter-sw.js`. Pass the same path to [`onPush()`](/Notifications/onPush/) and [`disable()`](/Notifications/disable/).

## Return value
A `Promise` that resolves to `true` when this browser receives pushes for your app, and `false` when the user didn't allow notifications or the browser can't receive pushes, such as a private window or an iPhone page that isn't opened from the Home Screen. [Where pushes work](/Notifications/push/#where-pushes-work) lists what each browser needs.

It rejects with an error carrying `message` and `code`:

| `code` | Meaning |
| --- | --- |
| `push_unavailable` | This server has no push notification service, as on most self-hosted servers. |
| `push_disabled` | This server has push notifications turned off. |
| `push_revoked` | The user turned your app off in Puter's settings. Call [`requestPermission()`](/Notifications/requestPermission/) from a click, then call [`enable()`](/Notifications/enable/) again. |
| `push_worker_unavailable` | The service worker couldn't be registered or didn't start, for example because nothing is served at its path. |
| `push_worker_conflict` | Another service worker controls the scope. Add the `importScripts()` line to that worker and pass its path as `serviceWorker`. |
| `push_subscription_conflict` | The worker already has a push subscription from another service, such as Firebase or OneSignal. Give Puter its own worker in a folder, such as `/puter/puter-sw.js`, and pass that path as `serviceWorker`. |
| `push_subscribe_failed` | The browser's push service refused to create a subscription. |
| `push_endpoint_revoked` | Another Puter account turned your app off on this browser's subscription, and a fresh subscription couldn't replace it. Rare: `enable()` replaces it on its own first. |
| `push_verification_canceled` | [`disable()`](/Notifications/disable/) was called before this call finished. |
| `user_gesture_required` | The call wasn't made from a user gesture, such as a click. |
| `too_many_requests` | Pushes were turned on too many times in a short time. Try again later. |
| `auth_canceled` | Nobody was signed in, and the user closed the sign-in without finishing it. |

On a website with nobody signed in, it opens the sign-in after the browser's prompt. Signing the user in first avoids a blocked popup.

## Examples

<strong class="example-title">Turn on pushes from a button</strong>

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <button id="enable">Turn on notifications</button>
    <script>
        document.getElementById('enable').addEventListener('click', async () => {
            try {
                const on = await puter.notifications.enable();
                puter.print(on ? 'Notifications are on<br>' : 'Notifications are off<br>');
            } catch (error) {
                puter.print(`Could not turn on notifications: ${error.code}<br>`);
            }
        });
    </script>
</body>
</html>
```
