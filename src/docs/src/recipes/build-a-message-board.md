---
title: Build a Message Board
description: "Learn how to add a message board to your app with Puter.js, where every user can post, read the latest messages, and delete their own."
tags: [workers, kv, auth]
order: 41
---

A message board, guestbook or comment wall is shared by every user of your app.
Everything your app stores with [`puter.kv`](/KV/) in the page belongs to the
signed-in user, so a board goes behind a [serverless worker](/Workers/) that
keeps the messages in your account as the developer.
[Store Server-Side Data](/recipes/store-server-side-data/) explains that setup
with a leaderboard. This recipe builds on it. The board keeps its newest 100
messages, limits how often a user can post, and lets users delete their own
messages.

For a private chat between a few people that updates live, see
[Build a Group Chat](/recipes/build-a-group-chat/).

## Post a Message

Inside a worker, [`me.puter`](/Workers/router/#integration-with-puter-js) is
Puter.js signed in as you, and
[`user.puter`](/Workers/router/#integration-with-puter-js) is Puter.js signed in
as the user who called the worker. The route asks `user.puter` who is posting,
and saves the message in your [key-value store](/KV/) with `me.puter`:

```js
const PREFIX = 'board:msg:';

router.post('/messages', async ({ request, user }) => {
    if ( ! user ) {
        return new Response('sign in required', { status: 401 });
    }

    const { text } = await request.json();
    if ( typeof text !== 'string' || ! text.trim() || text.length > 500 ) {
        return new Response('invalid message', { status: 400 });
    }

    const { uuid, username } = await user.puter.getUser();
    const id = `${ Date.now() }-${ crypto.randomUUID().slice(0, 8) }`;
    const message = { username, text: text.trim() };

    await me.puter.kv.set(`${ PREFIX }${ id }`, { ...message, uuid });
    return { id, ...message };
});
```

Each message gets its own key, made from the time and a random part. Two users
who post at the same moment write two different keys, so both messages are
kept. With every message in one key, one of the two could be lost. The keys
sort by time, as in
[Keep an Activity Log](/recipes/keep-an-activity-log/#record-an-entry).

The `username` and `uuid` come from the caller's session, not from the request
body, so a user can't post under another name. The route gets a `user` only
when your app calls it with [`puter.workers.exec()`](/Workers/exec/). To also
answer `401` for an expired session, see
[Handle Errors in a Worker](/recipes/handle-worker-errors/#check-who-is-calling).

## Read the Board

List the prefix newest first with [`puter.kv.list()`](/KV/list/):

```js
router.get('/messages', async () => {
    const page = await me.puter.kv.list({
        pattern: PREFIX,
        returnValues: true,
        reverse: true,
        limit: 50,
    });

    return page.items.map(({ key, value }) => ({
        id: key.slice(PREFIX.length),
        username: value.username,
        text: value.text,
    }));
});
```

The route returns the newest 50 messages and leaves out each author's `uuid`.
It doesn't check for `user`, so anyone can read the board, even with a plain
`fetch()`.

## Keep the Board a Fixed Size

To keep only the newest 100 messages, list the keys again with `offset` and
delete what comes back. This function does that, and the post route calls it
after saving:

```js
const KEEP = 100;

async function trim () {
    const old = await me.puter.kv.list({
        pattern: PREFIX,
        reverse: true,
        offset: KEEP,
        limit: 20,
    });

    for ( const key of old.items ) {
        await me.puter.kv.del(key);
    }
}

router.post('/messages', async ({ request, user }) => {
    if ( ! user ) {
        return new Response('sign in required', { status: 401 });
    }

    const { text } = await request.json();
    if ( typeof text !== 'string' || ! text.trim() || text.length > 500 ) {
        return new Response('invalid message', { status: 400 });
    }

    const { uuid, username } = await user.puter.getUser();
    const id = `${ Date.now() }-${ crypto.randomUUID().slice(0, 8) }`;
    const message = { username, text: text.trim() };

    await me.puter.kv.set(`${ PREFIX }${ id }`, { ...message, uuid });
    await trim();
    return { id, ...message };
});
```

With `reverse: true` and `offset: 100`, the listing skips the newest 100 keys
and returns up to 20 of the ones after them. Without `returnValues` it returns
only the keys, which is all [`puter.kv.del()`](/KV/del/) needs. Once the board
is full, each post removes the one message that fell off the end.

A listing gets slower and costs more the more keys its `offset` skips, so on a
busy board call `trim()` for one post in ten instead of every post.

## Limit How Often a User Posts

To stop one user from filling the board, let each user post once every 10
seconds. Write a key per user that expires on its own, with `onlyIfAbsent` so
the write only succeeds when the key isn't there. This is the whole post route
with that added:

```js
const COOLDOWN_SECONDS = 10;

router.post('/messages', async ({ request, user }) => {
    if ( ! user ) {
        return new Response('sign in required', { status: 401 });
    }

    const { text } = await request.json();
    if ( typeof text !== 'string' || ! text.trim() || text.length > 500 ) {
        return new Response('invalid message', { status: 400 });
    }

    const { uuid, username } = await user.puter.getUser();
    const expireAt = Math.floor(Date.now() / 1000) + COOLDOWN_SECONDS;
    const allowed = await me.puter.kv.set(`board:cooldown:${ uuid }`, true, expireAt, { onlyIfAbsent: true });
    if ( ! allowed ) {
        return new Response('wait a few seconds before posting again', { status: 429 });
    }

    const id = `${ Date.now() }-${ crypto.randomUUID().slice(0, 8) }`;
    const message = { username, text: text.trim() };

    await me.puter.kv.set(`${ PREFIX }${ id }`, { ...message, uuid });
    await trim();
    return { id, ...message };
});
```

[`puter.kv.set()`](/KV/set/) resolves to `false` when the key already exists,
so the route answers `429` until the key expires. The third argument is when
that happens, as a Unix time in seconds.
[Store Temporary Data](/recipes/store-temporary-data/#set-a-lock-or-cooldown)
explains the pattern.

## Let Users Delete Their Own Messages

Each stored message has its author's `uuid`. The delete route compares it with
the caller's, so users can only delete what they posted:

```js
router.delete('/messages/:id', async ({ params, user }) => {
    if ( ! user ) {
        return new Response('sign in required', { status: 401 });
    }

    const { uuid } = await user.puter.getUser();
    const message = await me.puter.kv.get(`${ PREFIX }${ params.id }`);
    if ( message?.uuid !== uuid ) {
        return new Response('not your message', { status: 403 });
    }

    await me.puter.kv.del(`${ PREFIX }${ params.id }`);
    return { deleted: true };
});
```

The `:id` in the path is a [route parameter](/Workers/router/#route-parameters),
and the route gets its value as `params.id`. A message that doesn't exist reads
as `null`, so it gets the same `403`.

## Deploy the Worker

Put the routes in one file and create the worker once, which gives it a
permanent URL such as `https://message-board.puter.work`. See
[deployment](/Workers/#deployment) for the steps.

## Call It From Your App

Call the worker with [`puter.workers.exec()`](/Workers/exec/), which takes the
same arguments as `fetch()` and sends the signed-in user's session:

```js
const API = 'https://message-board.puter.work';

// Post a message
const res = await puter.workers.exec(`${ API }/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'Hello, board!' }),
});
const posted = await res.json();
// { id: '1795671596360-d39941f4', username: 'grace', text: 'Hello, board!' }

// Read the newest messages
const board = await (await puter.workers.exec(`${ API }/messages`)).json();
// [ { id: '1795671596360-d39941f4', username: 'grace', text: 'Hello, board!' },
//   { id: '1795671502118-0c1f7a52', username: 'ada',   text: 'First!' } ]

// Delete your own message
await puter.workers.exec(`${ API }/messages/${ posted.id }`, { method: 'DELETE' });
```

A post that's too soon after the last one gets status `429`, and `res.json()`
would fail on its plain text body, so check `res.ok` before reading the
message. To show a "Delete" button only on the user's own messages, compare
each message's `username` with the one from
[`puter.auth.getUser()`](/Auth/getUser/).

## Show an Unread Count

The messages belong to the whole app, but what each user has read belongs to
that user. Keep it in the user's own store, with
[`puter.kv`](/KV/) in the page:

```js
const lastRead = await puter.kv.get('board:lastRead') ?? '';
const unread = board.filter(message => message.id > lastRead).length;

showBadge(unread);
```

Message ids start with the time, so every id greater than `lastRead` is a
message the user hasn't seen. Here `showBadge()` is your own function. The route
returns 50 messages, so show a count of 50 as "50+".

When the user opens the board, save the newest id:

```js
if ( board.length > 0 ) {
    await puter.kv.set('board:lastRead', board[0].id);
}
```

## Full Code

The worker file:

```js
const PREFIX = 'board:msg:';
const KEEP = 100;
const COOLDOWN_SECONDS = 10;

async function trim () {
    const old = await me.puter.kv.list({
        pattern: PREFIX,
        reverse: true,
        offset: KEEP,
        limit: 20,
    });

    for ( const key of old.items ) {
        await me.puter.kv.del(key);
    }
}

router.post('/messages', async ({ request, user }) => {
    if ( ! user ) {
        return new Response('sign in required', { status: 401 });
    }

    const { text } = await request.json();
    if ( typeof text !== 'string' || ! text.trim() || text.length > 500 ) {
        return new Response('invalid message', { status: 400 });
    }

    const { uuid, username } = await user.puter.getUser();
    const expireAt = Math.floor(Date.now() / 1000) + COOLDOWN_SECONDS;
    const allowed = await me.puter.kv.set(`board:cooldown:${ uuid }`, true, expireAt, { onlyIfAbsent: true });
    if ( ! allowed ) {
        return new Response('wait a few seconds before posting again', { status: 429 });
    }

    const id = `${ Date.now() }-${ crypto.randomUUID().slice(0, 8) }`;
    const message = { username, text: text.trim() };

    await me.puter.kv.set(`${ PREFIX }${ id }`, { ...message, uuid });
    await trim();
    return { id, ...message };
});

router.get('/messages', async () => {
    const page = await me.puter.kv.list({
        pattern: PREFIX,
        returnValues: true,
        reverse: true,
        limit: 50,
    });

    return page.items.map(({ key, value }) => ({
        id: key.slice(PREFIX.length),
        username: value.username,
        text: value.text,
    }));
});

router.delete('/messages/:id', async ({ params, user }) => {
    if ( ! user ) {
        return new Response('sign in required', { status: 401 });
    }

    const { uuid } = await user.puter.getUser();
    const message = await me.puter.kv.get(`${ PREFIX }${ params.id }`);
    if ( message?.uuid !== uuid ) {
        return new Response('not your message', { status: 403 });
    }

    await me.puter.kv.del(`${ PREFIX }${ params.id }`);
    return { deleted: true };
});
```
