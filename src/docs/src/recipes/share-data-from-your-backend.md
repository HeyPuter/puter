---
title: Share Data From Your Backend
description: "Learn how to let your app or its backend share a user's data with other people on its own, after asking the user for permission once."
tags: [kv, perms, workers]
order: 23
---

<div class="info">KV sharing is in beta. Method shapes, limits, and behavior may change between releases.</div>

Some apps share data without the user clicking a share button. A team chat app
can share each new room with the whole team as soon as it's created, or a
backend can add a member to a room when your own rules say so. In both cases
your app calls [`puter.kv.share()`](/KV/share/) for the user. The user gives
your app permission once, and after that it shares without a prompt each time.

## Ask for Permission Once

Ask with [`puter.perms.request()`](/Perms/request/), naming the part of your
app's data the shares will cover and the highest access level they'll give:

```js
await puter.perms.request('kvShare', { prefix: 'room:', access: 'write' });
```

The user sees a prompt asking whether your app may let other Puter users it
picks read and change the `room:` part of its data. The call resolves to `true`
once they allow it, and later calls resolve to `true` without asking again.

- **Prefix.** The permission covers the prefix and every key under it, so
  `room:` covers `room:<id>:` for every room. It has to name part of your app's
  data. A prefix that covers all of it, such as `''`, is rejected with
  `invalid_argument`.
- **Level.** The permission covers the level you ask for and the levels below
  it, so `'write'` also covers `'read'` and `'watch'` shares. The default is
  `'read'`, the same as for [`puter.kv.share()`](/KV/share/). Asking for a
  higher level later shows the user a new prompt.
- **Your app's data only.** An app can share only the data it keeps for the
  user, never another app's.

Sharing outside the prefix or above the level is rejected with
`events_kv_handle_not_delegated`. After the user withdraws the permission, your
app gets the same error when it shares or stops a share under that prefix, and
the shares it already made stay in place.

## Share From Your App

Once the user allows it, your app can share any room under `room:` with no
prompt. This creates a room and shares it with everyone on the team in one call:

```js
const team = ['alice', 'bob', 'carol'];
const prefix = `room:${crypto.randomUUID()}:`;

await puter.kv.set(`${prefix}meta`, { title: 'Launch planning' });
const results = await puter.kv.share({
    prefix,
    recipients: team,
    access: 'write',
    label: 'Launch planning',
});
```

The call resolves to one item per recipient. A recipient your app couldn't share
with, such as a username that doesn't exist, has an `error` on their item, and
the others still get the share.

## Share From a Worker

A [worker](/Workers/) can share for the user too, which keeps the logic on your
server. In a worker, [`user.puter`](/Workers/router/#integration-with-puter-js)
acts as the user who called it, from the app that called it. So the share is of
your app's data in the user's account, and the permission from the first step
applies:

```js
router.post('/rooms/:roomId/members', async ({ request, params, user }) => {
    const { username } = await request.json();
    const share = await user.puter.kv.share({
        prefix: `room:${params.roomId}:`,
        recipient: username,
        access: 'write',
        label: 'Launch planning',
    });
    return { holder: share.holder, access: share.access };
});
```

Your app calls it with [`puter.workers.exec()`](/Workers/exec/), which sends the
user's token so the worker gets
[`user.puter`](/Workers/router/#integration-with-puter-js). In this call,
`workerUrl` is your worker's URL:

```js
const response = await puter.workers.exec(`${workerUrl}/rooms/${roomId}/members`, {
    method: 'POST',
    body: JSON.stringify({ username: 'dave' }),
});
const added = await response.json();
```

In the same worker, [`me.puter`](/Workers/router/#integration-with-puter-js) is
your own account as the worker's owner, so it can't share the user's data.

The permission belongs to your app, not to the worker, so your app can still
share directly. A check in the worker only applies to the shares that go
through the worker.

The holder finds these shares with [`puter.kv.listShared()`](/KV/listShared/) in
your app, as in
[Share a List With Someone](/recipes/share-a-list-with-someone/#find-the-lists-shared-with-you),
and needs no permission to use them.
