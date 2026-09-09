---
title: Store Server-Side Data
description: "Learn how to store data that every user of your app can read and update, instead of each user only accessing their own storage."
tags: [workers, kv, auth]
order: 40
---

Everything you store with [`puter.kv`](/KV/) or [`puter.fs`](/FS/) lives in the
user's own account, which works differently than a traditional backend. If your app requires users reading and writing to the same data, use a [serverless worker](/Workers/) instead. This allows you to run server-side JavaScript code and you can have your users accessing the same data, which belongs to you as the developer.

## Worker Context and User Context

Inside a worker you get your own Puter context in the `me.puter` global object,
so you can store data in your [key-value database](/KV/). That centralizes the
data and keeps it server-side for your users.

You also get the caller's Puter context in the `user.puter` parameter when the
request is authenticated, which is how you get information about the user.

Data only its owner reads has no reason to make this trip.
[Store data](/recipes/store-data/) covers [`puter.kv`](/KV/) in app code, which
is already per-user and costs no round trip through your worker.

## Write a Record

The handler writes to your own [key-value database](/KV/) through `me.puter`, so
every player's row lands in the same store, and it uses `user.puter` to find out
who is calling:

```js
// leaderboard.js
const PREFIX = 'leaderboard:score:';

router.post('/scores', async ({ request, user }) => {
    if ( ! user ) {
        return new Response('sign in required', { status: 401 });
    }

    const { uuid, username } = await user.puter.getUser();
    const { score } = await request.json();
    if ( typeof score !== 'number' ) {
        return new Response('invalid score', { status: 400 });
    }

    await me.puter.kv.set(`${ PREFIX }${ uuid }`, { username, score, at: Date.now() });
    return { username, score };
});
```

The key is built from the caller's `uuid`, so a request can only ever touch its
own row, whatever the request body says.

For `user` to be there at all, your app has to call the worker with the
[`puter.workers.exec()`](/Workers/exec/) method, which attaches the signed-in
user's session:

```js
await puter.workers.exec(`${ API }/scores`, { method: 'POST', body });
```

A plain `fetch()` of the same URL arrives without a session, so the `! user`
branch is how a route becomes sign-in-only. The last section covers the client
side in full.

## Read the Records

To read the data back, use the same `me.puter` context and list it with the
[`puter.kv.list()`](/KV/list/) method:

```js
router.get('/scores', async () => {
    const rows = await me.puter.kv.list(PREFIX, true);
    return rows
        .map(row => row.value)
        .sort((a, b) => b.score - a.score)
        .slice(0, 20);
});
```

A handler returning a plain object or array is sent as JSON. Read-all and
write-own both fall out of the key, since the `GET` handler lists the prefix and
the `POST` handler addresses exactly one key inside it. See
[`router`](/Workers/router/) for the rest of the handler surface.

## Deploy the Worker

The worker is one file you write to your Puter account and create once, which
gives it a permanent URL such as `https://leaderboard-api.puter.work`. See
[deployment](/Workers/#deployment) for the steps.

## Call It From Your App

To call the worker with the signed-in user's session attached, use the
[`puter.workers.exec()`](/Workers/exec/) method, which takes the same arguments
as `fetch()`:

```js
const API = 'https://leaderboard-api.puter.work';

// Submit this player's score
const res = await puter.workers.exec(`${ API }/scores`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ score: 120 }),
});
await res.json();    // { username: 'grace', score: 120 }

// Read the whole board
const board = await (await puter.workers.exec(`${ API }/scores`)).json();
// [ { username: 'ada',   score: 450, at: 1788820000000 },
//   { username: 'grace', score: 120, at: 1788827048741 } ]
```

Every user of your app now reads and writes the same board, because every one of
these requests lands on the same store.
