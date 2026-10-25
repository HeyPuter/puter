---
title: Build a Group Chat
description: "Learn how to build a group chat where the messages live in your users' own Puter accounts, with live updates and invites, and no server to run."
tags: [kv, events, perms]
order: 22
---

A group chat usually needs a server that stores the messages and sends each new
one to everyone in the room. With [`puter.kv.share()`](/KV/share/), the room can
live in the Puter account of the user who creates it instead. Each member gets
write access to the room, reads and sends messages through it, and gets new
messages as [events](/Events/).

This recipe puts the other sharing recipes together.
[Share a List With Someone](/recipes/share-a-list-with-someone/) explains the
basics in more detail.

| Members can… | Layout |
| --- | --- |
| Read, send, change and delete any message | A write share of the room for each member, as in the first part of this recipe |
| Read every message, and change only their own | [A part of the room for each member](#let-members-change-only-their-own-messages) |
| Only do what rules on your server allow | A [worker](/Workers/) that checks each write, as in [Store Server-Side Data](/recipes/store-server-side-data/) |

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

The `meta` key is how members' apps show the room's title, since a share
doesn't say who made it or what its prefix is.

## Invite Members

Share the room with each member at write access:

```js
for (const username of ['alice', 'bob']) {
    await puter.kv.share({ prefix, recipient: username, access: 'write', label: 'Weekend trip' });
}
```

Each member finds the room with [`puter.kv.listShared()`](/KV/listShared/). A
member who has your app open also gets a
[`kv.share.received` notification](/KV/share/#what-the-holder-sees) right away:

```js
await puter.events.onLocal('notif:app-user', ({ event }) => {
    if (event.type === 'kv.share.received') addRoom(event.notification.handle);
});
```

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
two messages sent in the same millisecond from landing on the same key.

Use the time and a random part rather than a number from a shared counter.
Two members who send at about the same time can get the same number from
[`puter.kv.incr()`](/KV/incr/), and can both succeed with
[`puter.kv.set()`](/KV/set/) and `onlyIfAbsent` on the same key. One message
would then replace the other.

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
[`puter.events.onLocal()`](/Events/onLocal/):

```js
await room.watch('msg:*', (event) => {
    if (event.op === 'gap') return reloadMessages();
    if (event.op === 'set') showMessage(event.key, event.value);
    if (event.op === 'del') removeMessage(event.key);
});
```

Every member's messages arrive this way, including the creator's. A `gap` event
means some messages weren't delivered, for example during a reconnect, so load
the latest page again.

## Remove a Member or Leave the Room

The creator removes a member by passing their share's handle to
[`puter.kv.unshare()`](/KV/unshare/). Find it with
[`puter.kv.listSharedByMe()`](/KV/listSharedByMe/):

```js
const { items } = await puter.kv.listSharedByMe();
const bobs = items.find((share) =>
    share.prefix === prefix && share.holder === 'bob' && share.revokedAt === null);

await puter.kv.unshare(bobs.handle);
```

Bob loses access right away and stops getting messages. A member leaves the
room the same way, by calling [`puter.kv.unshare()`](/KV/unshare/) with their
own handle. [Manage Who Has Access to Shared Data](/recipes/manage-who-has-access-to-shared-data/)
shows the full lists, with paging.

## What Members Can Do

- Write access includes delete, so members can change or delete each other's
  messages, and `meta`.
- The `from` field is whatever the sender's app wrote, so a member can put any
  name there. The next section shows how to know who wrote each message.
- The room lives in the creator's account. If the creator deletes the room's
  keys or their account, the room is gone for everyone.
- Each member pays for their own reads and writes.
- Each invite takes one of the creator's shares. How many an account can hold
  depends on its plan, as listed in
  [Rate Limits and Quotas](/rate-limits-and-quotas/#events).

## Let Members Change Only Their Own Messages

To stop members from changing or deleting each other's messages, give each
member two shares. A read share of the whole room lets them read everything,
and a write share of their own part, `room:<id>:u:<memberId>:`, lets them write
there and nowhere else:

```js
const memberId = crypto.randomUUID();
const part = `${prefix}u:${memberId}:`;

await puter.kv.set(`${prefix}member:${memberId}`, { username: 'alice' });
await puter.kv.set(`${part}meta`, { roomId });
await puter.kv.share({ prefix, recipient: 'alice', access: 'read', label: 'Weekend trip' });
await puter.kv.share({ prefix: part, recipient: 'alice', access: 'write', label: 'Weekend trip' });
```

Only the creator can write the `member:` keys, so they're a reliable record of
who each `memberId` belongs to. The creator gives themselves a part and a
`member:` key the same way, and writes to their part with full keys.

Alice gets both shares in [`puter.kv.listShared()`](/KV/listShared/). Her app
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
share. To remove Alice, the creator unshares her read share, and her write
share stops with it. When Alice leaves by unsharing the read share, her write
share stops too. Each member takes two of the creator's shares in this layout.

Without a creator who holds the room, each member can keep their own messages
in their own account and share read access with every other member. That takes
a share for every pair of members, so it suits small groups.
