---
title: Store Server-Side Data
description: "Learn how to store data that every user of your app can read and update with Puter.js."
tags: [workers, kv, auth]
order: 40
---

Everything your app stores with [`puter.kv`](/KV/) or [`puter.fs`](/FS/) lives
in the signed-in user's own account, so each user only sees their own data.
Some data belongs to the whole app instead, such as a leaderboard that every
player reads and adds to. That data goes behind a
[serverless worker](/Workers/), which runs your code on the server and keeps
the data in your account as the developer.

A worker has two Puter.js objects. Inside it,
[`me.puter`](/Workers/router/#integration-with-puter-js) is Puter.js signed in as you,
the worker's owner, so every request reads and writes the same store. The
[`user.puter`](/Workers/router/#integration-with-puter-js) object belongs to the user
who called the worker, which is how a route finds out who is calling.

Data that only its owner reads needs no worker, as in
[Store Data](/recipes/store-data/). To let specific people see a user's data,
the user can share it with them, as in
[Share a List With Someone](/recipes/share-a-list-with-someone/).

## Write a Record

This leaderboard worker saves each player's score in your
[key-value store](/KV/) with [`me.puter`](/Workers/router/#integration-with-puter-js),
and asks [`user.puter`](/Workers/router/#integration-with-puter-js) who the player
is:

```js
const PREFIX = 'leaderboard:score:';

router.post('/scores', async ({ request, user }) => {
    if ( ! user ) {
        return new Response('sign in required', { status: 401 });
    }

    const { score } = await request.json();
    if ( typeof score !== 'number' ) {
        return new Response('invalid score', { status: 400 });
    }

    const { uuid, username } = await user.puter.getUser();
    await me.puter.kv.set(`${ PREFIX }${ uuid }`, { username, score, at: Date.now() });
    return { username, score };
});
```

The key is built from the caller's `uuid`, so a request can only change its own
row, whatever the request body says.

The route gets a `user` only when your app calls it with
[`puter.workers.exec()`](/Workers/exec/), which sends the signed-in user's
session. A plain `fetch()` arrives without one, so the `! user` check makes the
route sign-in only. To also answer `401` for an expired session, see
[Handle Errors in a Worker](/recipes/handle-worker-errors/#check-who-is-calling).

## Read the Records

To read the board, list the prefix with [`puter.kv.list()`](/KV/list/) through
the same [`me.puter`](/Workers/router/#integration-with-puter-js):

```js
router.get('/scores', async () => {
    const rows = await me.puter.kv.list(PREFIX, true);
    return rows
        .map(row => row.value)
        .sort((a, b) => b.score - a.score)
        .slice(0, 20);
});
```

A handler that returns a plain object or array is sent as JSON. This route
doesn't check for `user`, so anyone can read the board, even with a plain
`fetch()`.

The route reads every player's row on each request. For a board with thousands
of players, also write a key per player with the score in it, zero-padded as in
[Query a Collection](/recipes/query-collection/#filter-by-number). Then read the
top 20 by passing `reverse: true` and `limit: 20` to
[`puter.kv.list()`](/KV/list/).
[Keep an Index in Sync](/recipes/keep-an-index-in-sync/) shows how to keep the
extra key up to date.

## Deploy the Worker

Put both routes in one file and create the worker once, which gives it a
permanent URL such as `https://leaderboard-api.puter.work`. See
[deployment](/Workers/#deployment) for the steps.

## Call It From Your App

Call the worker with [`puter.workers.exec()`](/Workers/exec/), which takes the
same arguments as `fetch()`:

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

Every user of your app now reads and writes the same board.

## Full Code

The worker file:

```js
const PREFIX = 'leaderboard:score:';

router.post('/scores', async ({ request, user }) => {
    if ( ! user ) {
        return new Response('sign in required', { status: 401 });
    }

    const { score } = await request.json();
    if ( typeof score !== 'number' ) {
        return new Response('invalid score', { status: 400 });
    }

    const { uuid, username } = await user.puter.getUser();
    await me.puter.kv.set(`${ PREFIX }${ uuid }`, { username, score, at: Date.now() });
    return { username, score };
});

router.get('/scores', async () => {
    const rows = await me.puter.kv.list(PREFIX, true);
    return rows
        .map(row => row.value)
        .sort((a, b) => b.score - a.score)
        .slice(0, 20);
});
```
