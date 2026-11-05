---
title: Notify Users of Incoming Calls
description: "Learn how to alert users to an incoming call on their phone or computer right away, with Answer and Decline buttons that stay on screen until they respond."
tags: [notifications]
order: 71
---

An incoming call has to reach the user within seconds, even when their phone is idle, and stop alerting once nobody can answer it. A normal push can wait while a device saves battery, and it can still show up after the call is over. With [`puter.notifications`](/Notifications/), your app sends the call as a high-priority notification that expires after 30 seconds, and the push stays on screen with Answer and Decline buttons until the user responds.

This recipe assumes your website has push notifications set up, as [Reach a User When Your App Is Closed](/recipes/reach-a-user-when-your-app-is-closed/) shows. A call goes from one user to another, so the caller sends it through a [key-value share](/KV/share/) made with `notify: true`, as [Notify Chat Members of New Messages](/recipes/notify-chat-members-of-new-messages/) sets up. Here `handle` is that share's handle.

## Show the Call

On every page load, the callee's app registers an [`onPush()`](/Notifications/onPush/) handler for the `calls` channel:

```js
await puter.notifications.onPush('calls', (n) => ({
    title: n.title,
    body: 'Incoming call',
    requireInteraction: true,
    actions: [
        { action: 'answer', title: 'Answer' },
        { action: 'decline', title: 'Decline' },
    ],
}));
```

With `requireInteraction: true`, the notification stays on screen until the user taps or closes it, where the browser supports it. The `actions` add the two buttons. Some browsers show no buttons, and there a tap on the notification counts as answering, as the next section shows.

## Send the Call

The caller's app sends the call with [`notify()`](/Notifications/notify/):

```js
async function ring (handle, callId, callerName) {
    await puter.notifications.notify({
        title: `${callerName} is calling`,
        channel: 'calls',
        group: `call:${callId}`,
        priority: 'high',
        ttl: 30,
        data: { callId },
        to: { handle },
    });
}
```

With `priority: 'high'`, the push is delivered right away, even to an idle phone or computer. With `ttl: 30`, a device that's offline gets it only if it comes back within 30 seconds, so a missed call doesn't alert the user later. Each user gets at most 60 high-priority pushes an hour from your app, and pushes past that go out at normal priority, so keep `priority: 'high'` for calls. The `group` lets the next section replace the call with a missed-call notice.

## Answer or Decline

The callee's app adds an [`on('click')`](/Notifications/on/) handler early on every page load. The pressed button's id comes as `action`, and a tap on the notification body gives `null`:

```js
puter.notifications.on('click', async ({ uid, action, data }) => {
    if (!data?.callId) return;
    await puter.notifications.dismiss(uid);
    if (action === 'decline') return;
    location.assign(`/calls/${data.callId}`);
});
```

[`dismiss()`](/Notifications/dismiss/) closes the call on the user's other devices where a page of your app is open, so a call answered on the laptop stops showing on the phone. Your app tells the caller about the answer through its own call connection, such as the one [Send Live Updates to Other Users](/recipes/send-live-updates-to-other-users/) builds.

## Stop Alerting When the Caller Hangs Up

When the caller hangs up before anyone answers, send a missed-call notice in the same group:

```js
async function hangUp (handle, callId, callerName) {
    await puter.notifications.notify({
        title: `Missed call from ${callerName}`,
        channel: 'missed-calls',
        group: `call:${callId}`,
        data: { callId },
        to: { handle },
    });
}
```

A notification shown with a `group` takes the place of the one on screen with the same group, so the notice replaces the call on the callee's devices. It's on its own channel, so it shows its own title without buttons and doesn't stay on screen. It's sent at normal priority, since it isn't urgent.

## Full Code

The callee's page:

```js
await puter.notifications.onPush('calls', (n) => ({
    title: n.title,
    body: 'Incoming call',
    requireInteraction: true,
    actions: [
        { action: 'answer', title: 'Answer' },
        { action: 'decline', title: 'Decline' },
    ],
}));

puter.notifications.on('click', async ({ uid, action, data }) => {
    if (!data?.callId) return;
    await puter.notifications.dismiss(uid);
    if (action === 'decline') return;
    location.assign(`/calls/${data.callId}`);
});
```

The caller's page:

```js
async function ring (handle, callId, callerName) {
    await puter.notifications.notify({
        title: `${callerName} is calling`,
        channel: 'calls',
        group: `call:${callId}`,
        priority: 'high',
        ttl: 30,
        data: { callId },
        to: { handle },
    });
}

async function hangUp (handle, callId, callerName) {
    await puter.notifications.notify({
        title: `Missed call from ${callerName}`,
        channel: 'missed-calls',
        group: `call:${callId}`,
        data: { callId },
        to: { handle },
    });
}
```
