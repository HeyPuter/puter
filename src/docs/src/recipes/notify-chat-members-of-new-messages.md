---
title: Notify Chat Members of New Messages
description: "Learn how to send chat members a notification on their phone or computer for each new message, even after they close your app."
tags: [notifications, kv, events]
order: 69
---

<div class="info">KV sharing is in beta. Method shapes, limits, and behavior may change between releases.</div>

[Build a Group Chat](/recipes/build-a-group-chat/) shows new messages to members
who have the chat open. This recipe notifies everyone else, with a push on their
phone or computer.

[Build a Group Chat](/recipes/build-a-group-chat/) shares the room with each
member with `notify: true`. That lets the two sides of each share notify each
other. With `to: { handle }`,
[`puter.notifications.notify()`](/Notifications/notify/) sends the notification
to the other side of that share instead of to the user your app runs for. Your
app calls it right after it sends a message. A member who has the chat open gets
the notification in the page, and Puter doesn't push it.

Each share connects the room's creator with one member. So the creator can
notify every member, and a member can notify the creator. For members to notify
each other as well, see [Let Members Notify Each Other](#let-members-notify-each-other).

This recipe uses the room, `room`, `prefix`, `handle`, `user` and
`sendMessage()` from [Build a Group Chat](/recipes/build-a-group-chat/). Your
site also needs to serve `/puter-sw.js`, as in
[Push notifications for your app](/Notifications/push/#1-serve-the-service-worker).

## Notify Through the Shares

A member reaches the creator through their own share's `handle`. The creator
reaches each member through that member's share, which
[`puter.kv.listSharedByMe()`](/KV/listSharedByMe/) lists:

```js
async function notifyRoom (text) {
    const { roomId, title } = await room.get('meta');
    const notification = {
        title: `${user.username} in ${title}`.slice(0, 120),
        text: text.slice(0, 240),
        channel: 'chat',
        group: `room:${roomId}`,
        target: `/rooms/${roomId}`,
        data: { roomId },
    };

    if (handle) {
        await puter.notifications.notify({ ...notification, to: { handle } });
        return;
    }
    const { items } = await puter.kv.listSharedByMe({ state: 'live', limit: 200 });
    const members = items.filter((share) => share.prefix === prefix && share.notify);
    await Promise.allSettled(members.map((share) =>
        puter.notifications.notify({ ...notification, to: { handle: share.handle } })));
}

const text = 'Who is bringing the tent?';
await sendMessage(text);
await notifyRoom(text);
```

The creator uses `Promise.allSettled()` so that one member who can't be notified
doesn't stop the rest. A member can't be notified once their share stopped, or
after they blocked the creator. [`notify()`](/Notifications/notify/#notify-the-other-side-of-a-share)
lists the errors.

The notification names your app, not the sender, so the title says who wrote
the message. The `group` makes a new message replace the member's notification
for the same room instead of adding another, so a busy room doesn't use up the
daily notification limit.

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

## Turn Notifications On

Give the room a "Notify me" button. Browsers only show their permission prompt
from a click, so call [`puter.notifications.enable()`](/Notifications/enable/)
there:

```js
document.getElementById('notify').addEventListener('click', async () => {
    const pushes = await puter.notifications.enable();
    console.log(pushes ? 'You will be notified' : 'Notifications are off');
});
```

[`puter.notifications.enable()`](/Notifications/enable/) turns pushes on in this
browser only. A member who wants them on their phone too presses the button
there. On iPhone and iPad, that's from your site added to the Home Screen, as
[Where pushes work](/Notifications/push/#where-pushes-work) explains. A push is
billed to the member who receives it.

## Full Code

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

async function notifyRoom (text) {
    const { roomId, title } = await room.get('meta');
    const notification = {
        title: `${user.username} in ${title}`.slice(0, 120),
        text: text.slice(0, 240),
        channel: 'chat',
        group: `room:${roomId}`,
        target: `/rooms/${roomId}`,
        data: { roomId },
    };

    if (handle) {
        await puter.notifications.notify({ ...notification, to: { handle } });
        return;
    }
    const { items } = await puter.kv.listSharedByMe({ state: 'live', limit: 200 });
    const members = items.filter((share) => share.prefix === prefix && share.notify);
    await Promise.allSettled(members.map((share) =>
        puter.notifications.notify({ ...notification, to: { handle: share.handle } })));
}

document.getElementById('notify').addEventListener('click', async () => {
    const pushes = await puter.notifications.enable();
    console.log(pushes ? 'You will be notified' : 'Notifications are off');
});

async function sendAndNotify (text) {
    await sendMessage(text);
    await notifyRoom(text);
}
```

The worker, at `/puter-sw.js`:

```js
importScripts('https://js.puter.com/push-sw.js');
```

## Let Members Notify Each Other

A member's share connects them with the creator only, so a member can't reach
the other members through it. When every member should hear about every
message, whoever sent it, each member needs a handler that Puter runs for them
when a message lands, even while your app is closed. The handler calls
[`notify()`](/Notifications/notify/) for its own member, so the notification
needs no share. Use this in place of `notifyRoom()`.

A handler is a function your app publishes once, under a name, with
[`puter.events.handlers.publish()`](/Events/handlers/). Only the account that
owns the app can publish, so run this once yourself, signed in to your site as
the owner:

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

Each member, the creator included, subscribes to the room's messages with
[`puter.events.onPersistent()`](/Events/onPersistent/), naming the handler.
Running a handler while the user is away needs their consent, which
[`puter.perms.request()`](/Perms/request/) asks for with the `backgroundEvents`
resource. Call this from the "Notify me" button, after
[`puter.notifications.enable()`](/Notifications/enable/):

```js
async function subscribeToRoom () {
    const subject = handle ? `kv:${handle}:msg:*` : `kv:${puter.appID}:${prefix}msg:*`;
    const subs = await puter.events.list();
    const subscribed = subs.some((sub) =>
        sub.subject === subject && sub.handlerName === 'notifyNewMessage' && !sub.suspendedAt);
    if (subscribed) return true;

    const { roomId, title } = await room.get('meta');
    const options = {
        subject,
        handlerName: 'notifyNewMessage',
        includeValue: true,
        context: { me: user.username, roomId, roomTitle: title },
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

The handler can't use variables from around it, because Puter runs it later,
somewhere else. Everything it needs comes from `event`, `user`, and `ctx`, the
values each subscription is created with. The `me` check skips the member's own
messages. When the creator removes a member, or the member leaves, the member's
subscription stops on its own.
