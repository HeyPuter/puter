---
title: Build a Group Chat
description: "Learn how to build a group chat where the messages live in your users' own Puter accounts, with live updates and invites, and no server to run."
tags: [kv, events, perms]
order: 22
---

<div class="info">KV sharing is in beta. Method shapes, limits, and behavior may change between releases.</div>

A group chat usually needs a server that stores the messages and sends each new
one to everyone in the room. With [`puter.kv.share()`](/KV/share/), the room can
live in the Puter account of the user who creates it instead. Each member gets
write access to the room, reads and sends messages through it, and gets new
messages as [events](/Events/).

Write access lets any member change or delete any message. To let members
change only their own, see
[Let Members Change Only Their Own Messages](#let-members-change-only-their-own-messages).
For rules that a server checks, use a [worker](/Workers/) as in
[Store Server-Side Data](/recipes/store-server-side-data/).
[Share a List With Someone](/recipes/share-a-list-with-someone/) explains the
basics of sharing in more detail.

## Create a Room

The user who creates the room keeps it under `room:<id>:` in their account. Your
app asks them once for permission to share rooms with
[`puter.perms.request()`](/Perms/request/), naming the `room:` prefix so the
approval covers every room they create:

```js
await puter.perms.request('kvShare', { prefix: 'room:', access: 'write' });

const roomId = crypto.randomUUID();
const prefix = `room:${roomId}:`;
await puter.kv.set(`${prefix}meta`, { roomId, title: 'Weekend trip' });
```

A share doesn't say who made it or what its prefix is, so members' apps show the
room's title from `meta`.

## Invite Members

Share the room with every member in one call by passing `recipients`. With
`notify: true`, each member is told about the room right away, and the creator
and each member can notify each other through the share, as
[Notify Chat Members of New Messages](/recipes/notify-chat-members-of-new-messages/)
shows:

```js
const invites = await puter.kv.share({
    prefix,
    recipients: ['alice', 'bob'],
    access: 'write',
    label: 'Weekend trip',
    notify: true,
});

for (const invite of invites) {
    if (invite.error) showError(`Couldn't invite ${invite.recipient}`);
}
```

The call resolves to one item per recipient. A recipient who couldn't be
invited, such as a username that doesn't exist, has an `error` on their item,
and the others are still invited.

Each member finds their rooms with [`puter.kv.listShared()`](/KV/listShared/). A
member who has your app open also gets a
[`kv.share.received` notification](/KV/share/#what-the-holder-sees) for each new
room, which [`puter.events.onLocal()`](/Events/onLocal/) receives:

```js
let cursor;
do {
    const page = await puter.kv.listShared({ cursor });
    for (const { handle } of page.items) addRoom(handle);
    cursor = page.cursor;
} while (cursor);

await puter.events.onLocal('notif:app-user', ({ event }) => {
    if (event.type === 'kv.share.received') addRoom(event.notification.handle);
});
```

Here `addRoom()` is your app's function that reads the room's `meta` through
the handle and lists the room.

## Open the Room

The creator uses the room's full keys, and members use relative keys and the
share's `handle`. This helper hides the difference, so the rest of the chat
works the same for everyone:

```js
const openRoom = ({ prefix = '', handle }) => {
    const optConfig = handle ? { handle } : {};
    const relative = (key) => key?.slice(prefix.length);
    return {
        get: (key) => puter.kv.get(prefix + key, optConfig),
        set: (key, value) => puter.kv.set(prefix + key, value, optConfig),
        latest: async (pattern, { limit = 50, cursor } = {}) => {
            const page = await puter.kv.list({
                pattern: prefix + pattern,
                reverse: true,
                limit,
                cursor,
                returnValues: true,
                optConfig,
            });
            const items = page.items.map(({ key, value }) => ({ key: relative(key), value }));
            return { items, cursor: page.cursor };
        },
        watch: (pattern, onChange) => puter.events.onLocal(
            `kv:${handle ?? puter.appID}:${prefix}${pattern}`,
            ({ event }) => onChange({ ...event, key: relative(event.key) }),
            { includeValue: true },
        ),
    };
};

// The creator opens the room by its prefix, and a member by their share's handle.
const room = handle ? openRoom({ handle }) : openRoom({ prefix });
```

## Send a Message

Give each message its own key, made from the time and a random part:

```js
const user = await puter.auth.getUser();

const sendMessage = (text) => room.set(
    `msg:${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
    { text, from: user.username },
);

await sendMessage('Who is bringing the tent?');
```

Keys sort by the time, so the newest messages come last. The random part keeps
two messages sent in the same millisecond on different keys. Two members who
send at about the same time can get the same number from a counter kept with
[`puter.kv.incr()`](/KV/incr/), so a counter can't replace the random part.

## Load the Latest Messages

List the room's messages newest first, 50 at a time:

```js
const page = await room.latest('msg:*');
showMessages(page.items.reverse());   // oldest first, for display
```

The page includes a `cursor` if there are older messages to load. Pass it back
to get the next 50:

```js
const older = await room.latest('msg:*', { cursor: page.cursor });
```

## Get New Messages Live

Subscribe to the room's messages with the helper's `watch()`, which uses
[`puter.events.onLocal()`](/Events/onLocal/). New messages only need to reach
people with the chat open, so a subscription that ends with the page is enough:

```js
await room.watch('msg:*', (event) => {
    if (event.op === 'gap') return reloadMessages();
    if (event.op === 'set') showMessage(event.key, event.value);
    if (event.op === 'del') removeMessage(event.key);
});
```

Every message arrives this way, including the sender's own, so sending doesn't
need to draw anything. A `gap` event means some messages weren't delivered, for
example during a reconnect, so load the latest page again.

## Remove a Member or Leave the Room

The creator removes a member by passing their share's handle to
[`puter.kv.unshare()`](/KV/unshare/). Find it by paging through
[`puter.kv.listSharedByMe()`](/KV/listSharedByMe/):

```js
const findShare = async (prefix, holder) => {
    let cursor;
    do {
        const page = await puter.kv.listSharedByMe({ state: 'live', limit: 200, cursor });
        const share = page.items.find((s) => s.prefix === prefix && s.holder === holder);
        if (share) return share;
        cursor = page.cursor;
    } while (cursor);
    return null;
};

const bobs = await findShare(prefix, 'bob');
if (bobs) await puter.kv.unshare(bobs.handle);
```

Bob loses access right away, and his subscription to the room ends. A member
leaves the room the same way, by calling [`puter.kv.unshare()`](/KV/unshare/)
with their own handle.
[Manage Who Has Access to Shared Data](/recipes/manage-who-has-access-to-shared-data/)
shows the full lists.

## What Members Can Do

The room lives in the creator's account, so if the creator deletes the room's
keys or their account, the room is gone for everyone. Each member pays for their
own reads and writes.

Every member can change or delete any message, and `meta`. The `from` field is
whatever the sender's app wrote, so a member can put any name there. The next
section fixes both.

## Let Members Change Only Their Own Messages

Give each member two shares. A read share of the whole room lets them read
everything, and a write share of their own part, `room:<id>:u:<memberId>:`,
lets them write there and nowhere else:

```js
const memberId = crypto.randomUUID();
const part = `${prefix}u:${memberId}:`;

await puter.kv.set(`${prefix}member:${memberId}`, { username: 'alice' });
await puter.kv.set(`${part}meta`, { roomId });
await puter.kv.share({ prefix, recipient: 'alice', access: 'read', label: 'Weekend trip', notify: true });
await puter.kv.share({ prefix: part, recipient: 'alice', access: 'write', label: 'Weekend trip' });
```

Only the creator can write the `member:` keys, so they're a reliable record of
who each `memberId` belongs to. The creator gives themselves a part and a
`member:` key the same way, and writes to their part with full keys.

Alice gets both shares from [`puter.kv.listShared()`](/KV/listShared/). Her app
pairs them by the `roomId` in each `meta`, and tells them apart by `access`:

```js
const { items } = await puter.kv.listShared();
const rooms = new Map();
for (const share of items) {
    const { roomId } = await puter.kv.get('meta', { handle: share.handle });
    rooms.set(roomId, { ...rooms.get(roomId), [share.access]: share.handle });
}
const { read, write } = rooms.get(roomId);
```

She sends through her write share, and her messages land in her part:

```js
await puter.kv.set(`msg:${Date.now()}-${crypto.randomUUID().slice(0, 8)}`, { text: 'I am!' }, { handle: write });
```

She reads the whole room through her read share. Each message key starts with
`u:<memberId>:`, which says who wrote it:

```js
const members = new Map((await puter.kv.list('member:*', true, { handle: read }))
    .map(({ key, value }) => [key.slice('member:'.length), value.username]));

const messages = (await puter.kv.list('u:*', true, { handle: read }))
    .filter(({ key }) => key.includes(':msg:'))
    .map(({ key, value }) => ({
        from: members.get(key.split(':')[1]),
        sentAt: key.split(':msg:')[1],
        ...value,
    }))
    .sort((a, b) => a.sentAt.localeCompare(b.sentAt));
```

This loads every message in the room, which suits rooms with a short history.
To get new messages live, subscribe to `kv:<read handle>:u:*`, which gets every
member's writes.

A write through the read share is rejected with `kv_handle_access_denied`, even
for a key inside Alice's own part, so her app always writes through the write
share. When the creator removes Alice's read share, or Alice leaves it, her
write share stops with it.

Without a creator who holds the room, each member can keep their own messages
in their own account and share read access with every other member. That takes
a share for every pair of members, so it suits small groups.

## Full Code

The creator, when they create a room:

```js
await puter.perms.request('kvShare', { prefix: 'room:', access: 'write' });

const roomId = crypto.randomUUID();
const prefix = `room:${roomId}:`;
await puter.kv.set(`${prefix}meta`, { roomId, title: 'Weekend trip' });

const invites = await puter.kv.share({
    prefix,
    recipients: ['alice', 'bob'],
    access: 'write',
    label: 'Weekend trip',
    notify: true,
});

for (const invite of invites) {
    if (invite.error) showError(`Couldn't invite ${invite.recipient}`);
}
```

A member, to find their rooms:

```js
let cursor;
do {
    const page = await puter.kv.listShared({ cursor });
    for (const { handle } of page.items) addRoom(handle);
    cursor = page.cursor;
} while (cursor);

await puter.events.onLocal('notif:app-user', ({ event }) => {
    if (event.type === 'kv.share.received') addRoom(event.notification.handle);
});
```

The room, for the creator and members alike:

```js
const openRoom = ({ prefix = '', handle }) => {
    const optConfig = handle ? { handle } : {};
    const relative = (key) => key?.slice(prefix.length);
    return {
        get: (key) => puter.kv.get(prefix + key, optConfig),
        set: (key, value) => puter.kv.set(prefix + key, value, optConfig),
        latest: async (pattern, { limit = 50, cursor } = {}) => {
            const page = await puter.kv.list({
                pattern: prefix + pattern,
                reverse: true,
                limit,
                cursor,
                returnValues: true,
                optConfig,
            });
            const items = page.items.map(({ key, value }) => ({ key: relative(key), value }));
            return { items, cursor: page.cursor };
        },
        watch: (pattern, onChange) => puter.events.onLocal(
            `kv:${handle ?? puter.appID}:${prefix}${pattern}`,
            ({ event }) => onChange({ ...event, key: relative(event.key) }),
            { includeValue: true },
        ),
    };
};

// The creator opens the room by its prefix, and a member by their share's handle.
const room = handle ? openRoom({ handle }) : openRoom({ prefix });
const user = await puter.auth.getUser();

const sendMessage = (text) => room.set(
    `msg:${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
    { text, from: user.username },
);

const page = await room.latest('msg:*');
showMessages(page.items.reverse());

await room.watch('msg:*', (event) => {
    if (event.op === 'gap') return reloadMessages();
    if (event.op === 'set') showMessage(event.key, event.value);
    if (event.op === 'del') removeMessage(event.key);
});
```
