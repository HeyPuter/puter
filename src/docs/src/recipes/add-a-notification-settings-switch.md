---
title: Add a Notification Settings Switch
description: "Learn how to add a notifications switch to your app's settings, so users can turn push notifications on and off and know what to do when their browser blocks them."
tags: [notifications, ui]
order: 68
---

A settings screen is where users expect to decide whether your app can reach them while it's closed. With [`puter.notifications`](/Notifications/), pushes are turned on separately in each browser, so the switch shows and changes the browser the user is in. Turning it on in a laptop's browser doesn't turn it on on their phone.

This recipe assumes your site already serves the service worker and registers its [`onPush()`](/Notifications/onPush/) handlers on every page load, as in [Reach a User When Your App Is Closed](/recipes/reach-a-user-when-your-app-is-closed/). The same code works for an app inside the Puter desktop, which needs no service worker.

## Show the Current State

The settings page has a checkbox with the id `push-toggle`, and a paragraph with the id `push-hint` under it. Read the state with [`puter.notifications.status()`](/Notifications/status/). It never prompts, so call it on every page load:

```js
const toggle = document.getElementById('push-toggle');
const hint = document.getElementById('push-hint');

async function showPushState () {
    const state = await puter.notifications.status();
    toggle.checked = state === 'on';
    toggle.disabled = state === 'blocked' || state === 'unavailable';
}

await showPushState();
```

The state is `'on'` when your app's pushes reach this browser, and `'off'` when the user can turn them on. In the other two states, `'blocked'` and `'unavailable'`, the switch can't help, so it's disabled. [Tell the User What to Do](#tell-the-user-what-to-do) explains them to the user.

## Turn Pushes On and Off

Browsers only show their permission prompt from a user gesture, and the `change` event of a checkbox the user clicked counts. Call [`puter.notifications.enable()`](/Notifications/enable/) or [`puter.notifications.disable()`](/Notifications/disable/) in the handler, before any other `await`, then read the state again:

```js
toggle.addEventListener('change', async () => {
    let failed = null;
    try {
        if (toggle.checked) await puter.notifications.enable();
        else await puter.notifications.disable();
    } catch (error) {
        failed = error;
    }
    await showPushState();
    if (failed) hint.textContent = `Couldn't change notifications: ${failed.code}`;
});
```

[`enable()`](/Notifications/enable/) resolves `false` when the user says no to the browser's prompt, which is why the handler reads the state again instead of trusting the checkbox. [`disable()`](/Notifications/disable/) turns pushes off in this browser, and inside the Puter desktop on every device of the user. Notifications still reach your app live while it's open. The errors [`enable()`](/Notifications/enable/) can reject with are listed on its page.

## Handle an App the User Turned Off

The switch covers only this browser. The user sees every browser that gets their pushes, and every app that can send them, in the **Notifications** tab of their Puter dashboard. Your app can't list them, because [`listDevices()`](/Notifications/listDevices/) and [`removeDevice()`](/Notifications/removeDevice/) are for Puter's own apps and reject your app's token with `forbidden`.

When the user turns your app off in that tab, [`enable()`](/Notifications/enable/) rejects with `push_revoked` until they allow your app again. [`puter.notifications.requestPermission()`](/Notifications/requestPermission/) asks for that in Puter's own prompt. Turn pushes on through a function that handles it, and use this handler in place of the earlier one:

```js
async function turnOnPushes () {
    try {
        return await puter.notifications.enable();
    } catch (error) {
        if (error.code !== 'push_revoked') throw error;
        const allowed = await puter.notifications.requestPermission();
        return allowed && await puter.notifications.enable();
    }
}

toggle.addEventListener('change', async () => {
    let failed = null;
    try {
        if (toggle.checked) await turnOnPushes();
        else await puter.notifications.disable();
    } catch (error) {
        failed = error;
    }
    await showPushState();
    if (failed) hint.textContent = `Couldn't change notifications: ${failed.code}`;
});
```

## Tell the User What to Do

A disabled switch needs a reason next to it:

- A `'blocked'` state means the user blocked notifications for your site in this browser, or for Puter inside the desktop. The browser won't ask again, so only its site settings can undo it.
- An `'unavailable'` state means this browser can't receive pushes. On iPhone and iPad, that's the case until the user adds your site to the Home Screen and opens it from there. Your site also needs a web app manifest for that, as [iPhone and iPad](/Notifications/push/#iphone-and-ipad) describes.

Pick the hint from the state, and show it in the whole new version of `showPushState()`:

```js
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isHomeScreenApp = navigator.standalone === true
    || matchMedia('(display-mode: standalone)').matches;

function hintFor (state) {
    if (state === 'blocked') {
        return "Notifications are blocked in this browser. Allow them for this site in the browser's site settings, then reload the page.";
    }
    if (state === 'unavailable' && isIOS && !isHomeScreenApp) {
        return 'To get notifications on iPhone or iPad, tap Share, then Add to Home Screen, and open the app from there.';
    }
    if (state === 'unavailable') {
        return "This browser can't receive notifications.";
    }
    return '';
}

async function showPushState () {
    const state = await puter.notifications.status();
    toggle.checked = state === 'on';
    toggle.disabled = state === 'blocked' || state === 'unavailable';
    hint.textContent = hintFor(state);
}
```

The Home Screen app keeps its own storage, apart from Safari, so the user may have to sign in to Puter again there.

## Full Code

The settings page has a `push-toggle` checkbox and a `push-hint` paragraph. Your site serves `/puter-sw.js` and registers its [`onPush()`](/Notifications/onPush/) handlers, as in [Reach a User When Your App Is Closed](/recipes/reach-a-user-when-your-app-is-closed/).

```js
const toggle = document.getElementById('push-toggle');
const hint = document.getElementById('push-hint');

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isHomeScreenApp = navigator.standalone === true
    || matchMedia('(display-mode: standalone)').matches;

function hintFor (state) {
    if (state === 'blocked') {
        return "Notifications are blocked in this browser. Allow them for this site in the browser's site settings, then reload the page.";
    }
    if (state === 'unavailable' && isIOS && !isHomeScreenApp) {
        return 'To get notifications on iPhone or iPad, tap Share, then Add to Home Screen, and open the app from there.';
    }
    if (state === 'unavailable') {
        return "This browser can't receive notifications.";
    }
    return '';
}

async function showPushState () {
    const state = await puter.notifications.status();
    toggle.checked = state === 'on';
    toggle.disabled = state === 'blocked' || state === 'unavailable';
    hint.textContent = hintFor(state);
}

async function turnOnPushes () {
    try {
        return await puter.notifications.enable();
    } catch (error) {
        if (error.code !== 'push_revoked') throw error;
        const allowed = await puter.notifications.requestPermission();
        return allowed && await puter.notifications.enable();
    }
}

toggle.addEventListener('change', async () => {
    let failed = null;
    try {
        if (toggle.checked) await turnOnPushes();
        else await puter.notifications.disable();
    } catch (error) {
        failed = error;
    }
    await showPushState();
    if (failed) hint.textContent = `Couldn't change notifications: ${failed.code}`;
});

await showPushState();
```
