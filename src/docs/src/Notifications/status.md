---
title: puter.notifications.status()
description: Check whether push notifications from your app reach the browser the user is in, without asking.
platforms: [websites, apps]
---

Checks your app's push subscription in this browser. It never prompts, so call it on page load to decide whether to show your own "Turn on notifications" button, which calls [`enable()`](/Notifications/enable/).

On a website, it's `'on'` when the user turned pushes on in this browser with [`enable()`](/Notifications/enable/), this browser still holds the subscription, and Puter hasn't reported it removed or revoked. It's `'off'` after the user removes this browser in Puter's settings or turns your app off there. Pushes start once Puter confirms the browser, usually within seconds of [`enable()`](/Notifications/enable/) resolving. Inside the Puter desktop, it's `'on'` when pushes are on in this browser and the user allowed pushes from your app.

## Syntax
```js
puter.notifications.status()
puter.notifications.status(options)
```

## Parameters

#### `options` (Object) (optional)
- `serviceWorker` (String): The path of the worker passed to [`enable()`](/Notifications/enable/). Defaults to `/puter-sw.js`. Only used on a website.

## Return value
A `Promise` that resolves to one of these strings. It never rejects.

| Value | Meaning |
| --- | --- |
| `'on'` | This browser holds a subscription the user turned on here. Puter hasn't reported it removed or revoked. |
| `'off'` | Pushes aren't on in this browser. Call [`enable()`](/Notifications/enable/) from a click to turn them on. After the user turned your app off in Puter, [`enable()`](/Notifications/enable/) rejects with `push_revoked`. |
| `'blocked'` | The browser blocks notifications, for your site on a website or for Puter inside the desktop. The user unblocks them in the browser's site settings. |
| `'unavailable'` | This browser or environment can't receive pushes, such as a browser without Web Push or Node.js, or the desktop can't tell. |

On a website, it answers `'off'` when nobody is signed in. When it can't check the subscription with Puter, such as when Puter can't be reached or the server has no push notification service, it answers from this browser alone, so it can be `'on'` while pushes don't arrive.

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
