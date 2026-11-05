---
title: Add Buttons to Push Notifications
description: "Learn how to add buttons to push notifications, so users can answer an invitation right from the notification on their phone or computer."
tags: [notifications]
order: 70
---

An invitation is quicker to answer when its notification has Accept and Decline buttons. With [`puter.notifications`](/Notifications/), your push handler adds the buttons, and your click handler gets the id of the button the user pressed. Pressing a button opens or focuses your app, so the response is saved by your page.

This recipe assumes your website already has push notifications set up, with a service worker and the user's permission. [Reach a User When Your App Is Closed](/recipes/reach-a-user-when-your-app-is-closed/) sets that up.

## Add the Buttons

On every page load, register an [`onPush()`](/Notifications/onPush/) handler for the `invites` channel that returns the buttons as `actions`. Each button has an `action` id and a `title` label:

```js
await puter.notifications.onPush('invites', (n) => ({
    title: n.title,
    body: n.text ?? '',
    actions: [
        { action: 'accept', title: 'Accept' },
        { action: 'decline', title: 'Decline' },
    ],
}));
```

The handler also runs in your service worker when a push arrives, so it uses only its argument. A notification shows at most two buttons, and some browsers show none. [`onPush()`](/Notifications/onPush/#parameters) lists the rules for `actions`.

## Send an Invitation

Send the invitation with [`notify()`](/Notifications/notify/), with the handler's key as `channel`. Put the id of what it's about in `data`, so the click handler knows what the user answered:

```js
await puter.notifications.notify({
    title: 'Lunch on Friday?',
    text: 'Ana invited you to lunch at noon.',
    channel: 'invites',
    target: '/events/friday-lunch',
    data: { eventId: 'friday-lunch' },
});
```

This sends the invitation to the user your app runs for. To invite another user, send it through a share, as [Notify Chat Members of New Messages](/recipes/notify-chat-members-of-new-messages/) shows.

## Save the Response

Add an [`on('click')`](/Notifications/on/) handler early on every page load, so it also gets the click that opened your app. The pressed button's id comes as `action`. A tap on the notification body, which is all a browser without buttons offers, gives `action: null`, so that case opens the invitation's page for the user to answer there:

```js
puter.notifications.on('click', async ({ uid, action, target, data }) => {
    if (action !== 'accept' && action !== 'decline') {
        location.assign(target ?? '/');
        return;
    }

    try {
        await puter.kv.set(`rsvp:${data.eventId}`, action);
        await puter.notifications.dismiss(uid);
    } catch (error) {
        console.error('Could not save the response', error);
    }
});
```

The page saves the response with [`puter.kv.set()`](/KV/set/), then calls [`dismiss()`](/Notifications/dismiss/), which closes the invitation on the user's other devices too. [Mark Notifications as Read](/recipes/mark-notifications-as-read/) covers dismissing in more detail.

## Full Code

```js
await puter.notifications.onPush('invites', (n) => ({
    title: n.title,
    body: n.text ?? '',
    actions: [
        { action: 'accept', title: 'Accept' },
        { action: 'decline', title: 'Decline' },
    ],
}));

puter.notifications.on('click', async ({ uid, action, target, data }) => {
    if (action !== 'accept' && action !== 'decline') {
        location.assign(target ?? '/');
        return;
    }

    try {
        await puter.kv.set(`rsvp:${data.eventId}`, action);
        await puter.notifications.dismiss(uid);
    } catch (error) {
        console.error('Could not save the response', error);
    }
});

await puter.notifications.notify({
    title: 'Lunch on Friday?',
    text: 'Ana invited you to lunch at noon.',
    channel: 'invites',
    target: '/events/friday-lunch',
    data: { eventId: 'friday-lunch' },
});
```
