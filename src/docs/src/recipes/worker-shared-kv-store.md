---
title: Share key-value data between users with a worker
description: Deploy a worker with puter.workers.create() so puter.kv runs under your account instead of each user's own — one shared store behind an HTTP API you call with puter.workers.exec(), for a leaderboard, guestbook or any multi-user backend.
tags: [workers, kv, auth]
order: 40
---

**Use this when** every user of your app has to see the same data: a
leaderboard, a guestbook, a comment thread, a shared room, a global counter.
This is the job a traditional backend's database does, and a
[worker](/Workers/) plus [`puter.kv`](/KV/) does it here.

The worked example is a leaderboard: anyone signed in reads the whole board,
and each player writes their own row.

## Two stores, and which one you get

`puter.kv` in browser code reads and writes the store belonging to *the user
running your app*, one per app per account. User A calls
`puter.kv.set('score', 120)` and user B calls `puter.kv.get('score')`; B gets
whatever B wrote, which is `null` until B writes something. That is what you
want for private state, and it is why a leaderboard belongs somewhere else.

Inside a worker, `me.puter` is the **worker owner's** account — you, the
developer. Every request that reaches the worker touches that one store, so
`me.puter.kv` is a database shared by all your users. The worker's route
handlers are the API in front of it.

## Read the shared board

Give each player one entry under a common prefix, and the whole board is one
prefix listing:

```js
// leaderboard.js
const PREFIX = 'leaderboard:score:';

router.get('/scores', async () => {
    const rows = await me.puter.kv.list(PREFIX, true);
    return rows
        .map(row => row.value)
        .sort((a, b) => b.score - a.score)
        .slice(0, 20);
});
```

A handler returning a plain object or array is sent as JSON. See
[`router`](/Workers/router/) for the rest of the handler surface.

## Identify the caller

A request that arrives with a Puter session gets a `user` property on the
handler's event, and `user.puter` acts as that caller. `user.puter.getUser()`
is who they are:

```js
router.post('/scores', async ({ request, user }) => {
    if ( ! user ) {
        return new Response(JSON.stringify({ error: 'sign_in_required' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const { uuid, username } = await user.puter.getUser();
    // ...
});
```

`user` is present only when the request carries a session, which is what
[`puter.workers.exec()`](/Workers/exec/) attaches for you. A plain `fetch()` of
the same URL arrives without one, so the `! user` branch is how a route becomes
sign-in-only.

That pairing — one shared store plus the caller's identity — is the whole
backend model: `me.puter.kv` says *where* the data lives, `uuid` says *whose
row this is*.

## Let each caller write their own row

The `uuid` comes from the caller's session, so build the key from it and the
route can only ever touch that caller's entry, whatever the request body says.
Validate the value while you are there:

```js
    // ...same handler, after the identity check
    const { score } = await request.json();
    if ( typeof score !== 'number' || ! Number.isFinite(score) || score < 0 ) {
        return new Response(JSON.stringify({ error: 'invalid_score' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const key = `${ PREFIX }${ uuid }`;
    const best = await me.puter.kv.get(key);
    if ( best && best.score >= score ) {
        return { username, score: best.score, updated: false };
    }

    await me.puter.kv.set(key, { username, score, at: Date.now() });
    return { username, score, updated: true };
});
```

Read-all, write-own falls out of the key: the `GET` handler lists the prefix,
the `POST` handler addresses exactly one key inside it. Authorization rules
that are more involved than this go in the same place — the worker owns the
store, so its handlers are the only path to the data.

## Deploy it

Write the file to your Puter account and create the worker once:

```js
await puter.fs.write('leaderboard.js', workerCode);

const deployment = await puter.workers.create('leaderboard-api', 'leaderboard.js');
deployment.url;      // https://leaderboard-api.puter.work
```

The name and URL are permanent. Ship changes by overwriting `leaderboard.js`
with [`puter.fs.write()`](/FS/write/) — [`puter.workers.create()`](/Workers/create/)
covers updating in more detail.

## Call it from your app

[`puter.workers.exec()`](/Workers/exec/) takes the same arguments as `fetch()`
and adds the signed-in user's session:

```js
const API = 'https://leaderboard-api.puter.work';

const res = await puter.workers.exec(`${ API }/scores`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ score: 120 }),
});
await res.json();    // { username: 'grace', score: 120, updated: true }

const board = await (await puter.workers.exec(`${ API }/scores`)).json();
// [ { username: 'ada',  score: 450, at: 1788820000000 },
//   { username: 'grace', score: 120, at: 1788827048741 } ]
```

Every user of your app now reads the same board, because every one of these
requests lands on the same store.

## Lay out the keys

The shared store holds every user's data at once, so the prefix does the work
a table name does elsewhere:

```
leaderboard:score:<uuid>      one row per player
guestbook:entry:<timestamp>   one entry per post
room:<roomId>:member:<uuid>   membership of one room
```

Everything in [managing a collection of key-value
entries](/recipes/kv-prefix-listing/) applies — a prefix is one filter
dimension, results sort lexicographically by key, and paging is how a
collection stays affordable once it is large. Put a prefix on shared keys even
when the worker has a store to itself: it keeps the leaderboard separate from
whatever the worker stores next.

## Keep private state in the app

Data only its owner reads has no reason to make the trip. Settings, drafts, a
personal history — leave those on `puter.kv` in app code, where they are
already per-user and cost no round trip through your worker:

```js
await puter.kv.set('settings', { sound: false });     // stays with this user
```

A worker can also reach the caller's own store as `user.puter.kv`, which runs
against their account and bills them (the [user-pays
model](/user-pays-model/)). Reach for it when server-side logic needs to touch
private data; `me.puter.kv` stays the shared one.

## Notes

- A worker's `puter.kv` namespace belongs to the app the worker runs as.
  Deployed with a user token it gets its own `sandbox-<name>` app, so its keys
  sit apart from your app's own store — a key written by the worker is not
  visible to `puter.kv.get()` in the app, and vice versa. See
  [`puter.workers.create()`](/Workers/create/) for binding a worker to a
  specific app.
- `puter kv connect <worker-name>` in the [CLI](/cli/) opens a shell directly
  on that store, which is the quickest way to see what your worker has written.
- Every route is a public HTTPS URL. Routes that check `user` are sign-in-only;
  a route that skips the check answers anyone who has the URL, which is often
  right for a public board and worth deciding deliberately.
- `user.puter.getUser()` is a network request per call. Call it once at the top
  of a handler and pass the `uuid` around.
- `get()` then `set()` in a handler is two operations, so two requests landing
  together can both read the old value. For a plain tally,
  [`puter.kv.incr()`](/KV/incr/) is a single atomic operation.
- Keys cap at [1 KB](/KV/MAX_KEY_SIZE/) and values at
  [400 KB](/KV/MAX_VALUE_SIZE/). One entry per user keeps every row far below
  that; a single entry holding all users is the shape that runs into it.
- Listing the prefix is metered per page, so cap the board with `limit` and
  [page through it](/recipes/kv-prefix-listing/) once it grows past a screenful.
- A create or an update propagates across edge servers in 5-30 seconds. Give a
  freshly deployed worker a moment before the first call.
