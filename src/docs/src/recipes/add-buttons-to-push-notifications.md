---
title: Add Buttons to Push Notifications
description: "Learn how to add buttons to push notifications, so users can respond to invitations as soon as your app opens."
tags: [notifications]
order: 70
---

An invitation can offer Accept and Decline buttons on its push notification. Pressing either opens or focuses your app, where your code saves the response. With [`puter.notifications`](/Notifications/), your app adds the buttons in its push handler and reads the pressed button's id in its click handler.

This recipe assumes your website has [push notifications set up](/Notifications/push/#a-website-on-its-own-domain), with the user's permission and a service worker. Buttons are shown on your website's notifications where the browser supports them.

## Show the Buttons and Save the Response

Register [`on('click')`](/Notifications/on/) early on every page load so it can receive the click that opened your app. Register [`onPush()`](/Notifications/onPush/) for the `invites` channel, then send an invitation with [`notify()`](/Notifications/notify/):

```js
puter.notifications.on('click', ({ uid, target, data, action }) => {
    if (data?.kind !== 'invite' || typeof data.eventId !== 'string') return;
    if (action !== 'accept' && action !== 'decline') {
        location.assign(target ?? '/');
        return;
    }
    void puter.kv.set(`rsvp:${data.eventId}`, action)
        .then(() => puter.notifications.dismiss(uid))
        .catch(console.error);
});

await puter.notifications.onPush('invites', (n) => {
    if (n.data?.kind !== 'invite') return;
    return {
        actions: [
            { action: 'accept', title: 'Accept' },
            { action: 'decline', title: 'Decline' },
        ],
    };
});

await puter.notifications.notify({
    title: 'RSVP for Friday lunch',
    text: 'Would you like to join?',
    channel: 'invites',
    target: '/events/friday-lunch',
    data: { kind: 'invite', eventId: 'friday-lunch' },
});
```

This sends an invitation to the current user. The page saves their response with [`puter.kv.set()`](/KV/set/) and calls [`dismiss()`](/Notifications/dismiss/) after saving succeeds. Replace that save with your app's RSVP operation when the response also needs to reach an organizer. The push handler is self-contained so it also runs when your app is closed.

The body tap has `action: null` and opens the event page, where your app can show its RSVP form. Browsers without button support show only the notification body, so this route also lets those users respond. The first two valid buttons are kept, as described in [`onPush()`](/Notifications/onPush/). Pressing a button runs the response code in the page after it opens or gains focus.
