---
title: puter.notifications.status()
description: Check whether push notifications from your app reach the browser the user is in, without asking.
platforms: [websites, apps]
---

Whether your app's push notifications reach the browser the user is in right now. It never prompts and never changes anything, so call it on page load to decide whether to show your own "Turn on notifications" button, which calls [`enable()`](/Notifications/enable/).

On a website, it's `'on'` when the user turned pushes on in this browser with [`enable()`](/Notifications/enable/), and this browser still holds the subscription. Pushes start once Puter confirms the browser, usually within seconds of [`enable()`](/Notifications/enable/) resolving. Inside the Puter desktop, it's `'on'` when pushes are on in this browser and your app holds the [`notifications:push`](/Notifications/requestPermission/) permission.

## Syntax
```js
puter.notifications.status()
puter.notifications.status(options)
```

## Parameters

#### `options` (Object) (optional)
- `serviceWorker` (String): path of the worker passed to [`enable()`](/Notifications/enable/). Default `/puter-sw.js`. Only used on a website.

## Return value
A `Promise` that resolves to one of these strings. It never rejects.

| Value | Meaning |
| --- | --- |
| `'on'` | Pushes from your app reach this browser. |
| `'off'` | They don't yet. Call [`enable()`](/Notifications/enable/) from a click to turn them on. |
| `'blocked'` | The browser blocks notifications, for your site on a website or for Puter inside the desktop. The user unblocks them in the browser's site settings. |
| `'unavailable'` | This browser or page can't receive pushes, such as a browser without Web Push, or the server has no push notification service. |

On a website, the call doesn't ask the server, so it answers `'off'` on a server without a push notification service, and [`enable()`](/Notifications/enable/) then rejects with `push_unavailable`. It also answers `'off'` when nobody is signed in.

## Examples

<strong class="example-title">Show the button only when it can help</strong>

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <button id="enable" hidden>Turn on notifications</button>
    <script>
        const button = document.getElementById('enable');

        (async () => {
            const state = await puter.notifications.status();
            button.hidden = state !== 'off';
            if (state === 'blocked') {
                puter.print('Notifications are blocked in this browser<br>');
            }
        })();

        button.addEventListener('click', async () => {
            try {
                const on = await puter.notifications.enable();
                button.hidden = on;
                puter.print(on ? 'Notifications are on<br>' : 'Notifications are off<br>');
            } catch (error) {
                puter.print(`Could not turn on notifications: ${error.code}<br>`);
            }
        });
    </script>
</body>
</html>
```
