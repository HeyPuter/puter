---
title: Notify Chat Members of New Messages
description: "Learn how to send chat members a notification on their phone or computer for each new message, even after they close your app."
tags: [notifications, events, kv]
order: 69
---

<div class="info">The Events API and KV sharing are in beta. Method shapes, limits, and behavior may change between releases.</div>

[Build a Group Chat](/recipes/build-a-group-chat/) shows new messages to members
who have the chat open. This recipe notifies everyone else, with a push on their
phone or computer.

[`puter.notifications.notify()`](/Notifications/notify/) only notifies the user
your app runs for, so the sender's app can't notify the other members. Instead,
each member's app subscribes to the room with a handler that Puter runs for that
member, even while your app is closed. When a message arrives, the handler calls
[`notify()`](/Notifications/notify/) for its member. A member who has the chat
open gets the notification in the page, and Puter doesn't push it.

This recipe uses the room, `room`, `prefix`, `handle` and `user` from
[Build a Group Chat](/recipes/build-a-group-chat/). Your site also needs to serve
`/puter-sw.js`, as in
[Push notifications for your app](/Notifications/push/#1-serve-the-service-worker).

## Publish the Handler

A handler is a function your app publishes once, under a name, with
[`puter.events.handlers.publish()`](/Events/handlers/). Puter runs it in your
app's [events worker](/Events/workers/), where `user` is the member the
subscription belongs to:

```js
await puter.events.handlers.publish('notifyNewMessage', async ({ event, user, ctx }) => {
    const message = event.value;
    if (event.op !== 'set' || !message || message.from === ctx.me) return;

    await user.notifications.notify({
        title: `${message.from} in ${ctx.roomTitle}`.slice(0, 120),
        text: String(message.text).slice(0, 240),
        channel: 'chat',
        group: `room:${ctx.roomId}`,
        target: `/rooms/${ctx.roomId}`,
        data: { roomId: ctx.roomId },
    });
});
```

Only the account that owns the app can publish, so run this once yourself,
signed in to your site as the owner. The browser console is enough. Publishing
the same source again does nothing.

The handler can't use variables from around it, because Puter runs it later,
somewhere else. Everything it needs comes from `event`, `user`, and `ctx`, the
values each subscription is created with. The `me` check skips the member's own
messages, since their subscription sees those too.

## Say What a Push Shows

On every page load, register a handler for the `chat` channel with
[`puter.notifications.onPush()`](/Notifications/onPush/), and open the room
when the user taps a notification with
[`puter.notifications.on('click')`](/Notifications/on/):

```js
await puter.notifications.onPush('chat', (n) => ({
    title: n.title,
    body: n.text ?? '',
    url: n.target ?? '/',
}));

puter.notifications.on('click', ({ data }) => {
    if (data?.roomId) openRoomById(data.roomId);
});
```

Here `openRoomById()` is your app's own function that shows a room.

While the chat is open, the notification reaches this handler in the page
instead of being pushed. The page shows it only when its tab is hidden or its
window isn't focused, and the message itself arrives through the room's
`watch()`. While the chat is closed, the same handler runs in your service
worker to decide what the push shows.

## Subscribe Each Member

Each member subscribes to the room's messages with
[`puter.events.onPersistent()`](/Events/onPersistent/), naming the handler. A
persistent subscription is stored on the member's account and keeps running
after they close your app. The creator watches the room by its prefix, and a
member watches it through their share's handle:

```js
const roomSubject = handle
    ? `kv:${handle}:msg:*`
    : `kv:${puter.appID}:${prefix}msg:*`;
```

Running a handler while the user is away needs the user's consent, which
[`puter.perms.request()`](/Perms/request/) asks for with the `backgroundEvents`
resource. Check [`puter.events.list()`](/Events/list/) first, so a member who
already subscribed doesn't get a second subscription:

```js
async function subscribeToRoom (subject, roomId, roomTitle) {
    const subs = await puter.events.list();
    const subscribed = subs.some((sub) =>
        sub.subject === subject && sub.handlerName === 'notifyNewMessage' && !sub.suspendedAt);
    if (subscribed) return true;

    const options = {
        subject,
        handlerName: 'notifyNewMessage',
        includeValue: true,
        context: { me: user.username, roomId, roomTitle },
    };
    try {
        await puter.events.onPersistent(options);
    } catch (error) {
        if (error.code !== 'events_background_consent_required') throw error;
        if (!await puter.perms.request('backgroundEvents')) return false;
        await puter.events.onPersistent(options);
    }
    return true;
}
```

With `includeValue: true`, the new message comes in `event.value`, so the
handler doesn't have to read it. When the creator removes a member, or the member
leaves, the member's subscription stops on its own.

## Turn Notifications On

Give the room a "Notify me" button. Browsers only show their permission prompt
from a click, so call [`puter.notifications.enable()`](/Notifications/enable/)
first, then subscribe:

```js
document.getElementById('notify').addEventListener('click', async () => {
    const pushes = await puter.notifications.enable();
    const { roomId, title } = await room.get('meta');
    const subscribed = await subscribeToRoom(roomSubject, roomId, title);
    console.log(pushes && subscribed ? 'You will be notified' : 'Notifications are off');
});
```

[`puter.notifications.enable()`](/Notifications/enable/) turns pushes on in this
browser only. A member who wants them on their phone too presses the button
there. On iPhone and iPad, that's from your site added to the Home Screen, as
[Where pushes work](/Notifications/push/#where-pushes-work) explains.

## Full Code

The handler, published once by the app's owner:

```js
await puter.events.handlers.publish('notifyNewMessage', async ({ event, user, ctx }) => {
    const message = event.value;
    if (event.op !== 'set' || !message || message.from === ctx.me) return;

    await user.notifications.notify({
        title: `${message.from} in ${ctx.roomTitle}`.slice(0, 120),
        text: String(message.text).slice(0, 240),
        channel: 'chat',
        group: `room:${ctx.roomId}`,
        target: `/rooms/${ctx.roomId}`,
        data: { roomId: ctx.roomId },
    });
});
```

The page, after the room is open:

```js
await puter.notifications.onPush('chat', (n) => ({
    title: n.title,
    body: n.text ?? '',
    url: n.target ?? '/',
}));

puter.notifications.on('click', ({ data }) => {
    if (data?.roomId) openRoomById(data.roomId);
});

const roomSubject = handle
    ? `kv:${handle}:msg:*`
    : `kv:${puter.appID}:${prefix}msg:*`;

async function subscribeToRoom (subject, roomId, roomTitle) {
    const subs = await puter.events.list();
    const subscribed = subs.some((sub) =>
        sub.subject === subject && sub.handlerName === 'notifyNewMessage' && !sub.suspendedAt);
    if (subscribed) return true;

    const options = {
        subject,
        handlerName: 'notifyNewMessage',
        includeValue: true,
        context: { me: user.username, roomId, roomTitle },
    };
    try {
        await puter.events.onPersistent(options);
    } catch (error) {
        if (error.code !== 'events_background_consent_required') throw error;
        if (!await puter.perms.request('backgroundEvents')) return false;
        await puter.events.onPersistent(options);
    }
    return true;
}

document.getElementById('notify').addEventListener('click', async () => {
    const pushes = await puter.notifications.enable();
    const { roomId, title } = await room.get('meta');
    const subscribed = await subscribeToRoom(roomSubject, roomId, title);
    console.log(pushes && subscribed ? 'You will be notified' : 'Notifications are off');
});
```

The worker, at `/puter-sw.js`:

```js
importScripts('https://js.puter.com/push-sw.js');
```
