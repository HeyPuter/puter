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

The chat shares the room with each member with `notify: true`, which lets the
two sides of each share notify each other. With `to: { handle }`,
[`puter.notifications.notify()`](/Notifications/notify/) sends the notification
to the other side of that share instead of to the user your app runs for. Your
app calls it right after it sends a message. A member who's looking at the chat
gets the notification in the page without a push, as
[When a notification is pushed](/Notifications/push/#when-a-notification-is-pushed)
describes.

Each share connects the room's creator with one member, so the creator can
notify every member, and a member can notify the creator. For members to notify
each other as well, see [Let Members Notify Each Other](#let-members-notify-each-other).

This recipe uses the `room`, `prefix`, `handle`, `user` and `sendMessage()`
from [Build a Group Chat](/recipes/build-a-group-chat/). Your site also needs to
serve `/puter-sw.js`, as
[Reach a User When Your App Is Closed](/recipes/reach-a-user-when-your-app-is-closed/#serve-the-service-worker)
shows.

## Notify Through the Shares

A member reaches the creator through their own share's `handle`. The creator
reaches each member through that member's share, which
[`puter.kv.listSharedByMe()`](/KV/listSharedByMe/) lists a page at a time:

```js
async function memberHandles () {
    const handles = [];
    let cursor;
    do {
        const page = await puter.kv.listSharedByMe({ state: 'live', limit: 200, cursor });
        for (const share of page.items) {
            if (share.prefix === prefix && share.notify) handles.push(share.handle);
        }
        cursor = page.cursor;
    } while (cursor);
    return handles;
}

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

    const handles = handle ? [handle] : await memberHandles();
    await Promise.allSettled(handles.map((to) =>
        puter.notifications.notify({ ...notification, to: { handle: to } })));
}

const text = 'Who is bringing the tent?';
await sendMessage(text);
await notifyRoom(text);
```

The listing covers every room the creator shared, so the code keeps the shares
of this room. It uses `Promise.allSettled()` so that one member who can't be
notified doesn't stop the rest. A member can't be notified once their share
stopped, or after they blocked the creator.
[`notify()`](/Notifications/notify/#notify-the-other-side-of-a-share) lists the
errors.

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

While the chat is open, the notification reaches this handler in the page, and
the page shows it only when its tab is hidden or its window isn't focused. The
message itself arrives through the room's `watch()`. While the chat is closed,
the same handler runs in your service worker to decide what the push shows.

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

async function memberHandles () {
    const handles = [];
    let cursor;
    do {
        const page = await puter.kv.listSharedByMe({ state: 'live', limit: 200, cursor });
        for (const share of page.items) {
            if (share.prefix === prefix && share.notify) handles.push(share.handle);
        }
        cursor = page.cursor;
    } while (cursor);
    return handles;
}

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

    const handles = handle ? [handle] : await memberHandles();
    await Promise.allSettled(handles.map((to) =>
        puter.notifications.notify({ ...notification, to: { handle: to } })));
}

async function sendAndNotify (text) {
    await sendMessage(text);
    await notifyRoom(text);
}

document.getElementById('notify').addEventListener('click', async () => {
    const pushes = await puter.notifications.enable();
    console.log(pushes ? 'You will be notified' : 'Notifications are off');
});
```

The worker, at `/puter-sw.js`:

```js
importScripts('https://js.puter.com/push-sw.js');
```

## Let Members Notify Each Other

A member's share connects them with the creator only, so a member can't reach
the other members through it. When every member should hear about every
message, whoever sent it, give each member a persistent subscription to the
room's messages, with a handler that Puter runs for them even while your app is
closed. The handler calls [`notify()`](/Notifications/notify/) for its own
member, so it needs no share. Use this in place of `notifyRoom()`.

Publish the handler once, signed in to your site as the app's owner, with
[`puter.events.handlers.publish()`](/Events/handlers/).
[Run Code in the Background](/recipes/run-code-in-the-background/#publish-the-handler)
explains handlers in more detail:

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
Running a handler while the member is away needs their permission, which
[`puter.perms.request()`](/Perms/request/) asks for with the `backgroundEvents`
resource. Call this from the "Notify me" button, after
[`puter.notifications.enable()`](/Notifications/enable/):

```js
async function subscribeToRoom () {
    if (!await puter.perms.request('backgroundEvents')) return false;

    const subject = handle ? `kv:${handle}:msg:*` : `kv:${puter.appID}:${prefix}msg:*`;
    const subs = await puter.events.list();
    const subscribed = subs.some((sub) => sub.subject === subject
        && sub.handlerName === 'notifyNewMessage' && sub.suspendedReason !== 'permission_revoked');
    if (subscribed) return true;

    const { roomId, title } = await room.get('meta');
    await puter.events.onPersistent({
        subject,
        handlerName: 'notifyNewMessage',
        includeValue: true,
        context: { me: user.username, roomId, roomTitle: title },
    });
    return true;
}
```

The `me` check in the handler skips the member's own messages. When the creator
removes a member, or the member leaves, the member's subscription stops on its
own.
