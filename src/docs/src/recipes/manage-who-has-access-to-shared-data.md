---
title: Manage Who Has Access to Shared Data
description: "Learn how to show users who they shared data with in your app, so they can change or remove anyone's access, and leave data other people shared with them."
tags: [kv, perms]
order: 21
---

<div class="info">KV sharing is in beta. Method shapes, limits, and behavior may change between releases.</div>

Once users share data in your app, they need a way to see who has it and to
take it back. This recipe builds two screens, a "People with access" panel for
the data a user shared and a "Shared with me" list for the data other people
shared with them. It works with any share made by
[`puter.kv.share()`](/KV/share/), like the ones in
[Share a List With Someone](/recipes/share-a-list-with-someone/).

In an app, both lists include only shares of that app's data.

## List Who Has Access

To list the live shares the user made, call
[`puter.kv.listSharedByMe()`](/KV/listSharedByMe/) with `state: 'live'`, a page
at a time. Keep the ones for the prefix the panel is about:

```js
const shares = [];
let cursor;
do {
    const page = await puter.kv.listSharedByMe({ state: 'live', limit: 50, cursor });
    shares.push(...page.items.filter((share) => share.prefix === prefix));
    cursor = page.cursor;
} while (cursor);

for (const share of shares) addRow(share.holder, share.access, share.handle);
```

Each share has the `holder`'s username, their `access` and the share's `handle`.
A share that stopped stays listed for 30 days with `revokedAt` and `revokedBy`
set. To show who left, list with `state: 'revoked'`, where `revokedBy` is
`'holder'` for someone who removed their own access and `'owner'` for someone
the user removed.

## Change Someone's Access

Share the same prefix with the same person again, at the new level. This
changes the existing share and keeps its handle, so nothing changes on their
side except what they can do. For a `share` from the list above:

```js
await puter.kv.share(prefix, share.holder, 'read');
```

To raise someone above the level your app has permission for, ask again with
[`puter.perms.request()`](/Perms/request/) first, as in
[Let Them Edit Later](/recipes/let-someone-view-your-data/#let-them-edit-later).

## Remove Someone

Pass the share's handle to [`puter.kv.unshare()`](/KV/unshare/):

```js
await puter.kv.unshare(share.handle);
```

The handle stops working right away. Any narrower share the user made with the
same person inside the prefix stops too. The keys stay in the user's account.

## Show What's Been Shared With You

To list the shares other users made with the current user, call
[`puter.kv.listShared()`](/KV/listShared/) a page at a time:

```js
const shared = [];
let cursor;
do {
    const page = await puter.kv.listShared({ limit: 50, cursor });
    shared.push(...page.items);
    cursor = page.cursor;
} while (cursor);
```

A share doesn't say who made it or what its prefix is. Show its `label`, which
the owner set, or a key such as `meta` that the owner keeps for this, read
through its `handle`, as
[Find the Lists Shared With You](/recipes/share-a-list-with-someone/#find-the-lists-shared-with-you)
shows.

## Leave a Share

The holder removes their own access with the same call,
[`puter.kv.unshare()`](/KV/unshare/):

```js
await puter.kv.unshare(handle);
```

The share leaves their list, and shows in the owner's list with
`revokedBy: 'holder'`. Any narrower share they hold from the same owner inside
it stops too. Calling it again for a share that already stopped resolves the
same way, so a retry is safe.

## Remove Shares That Stopped

When the owner removes someone, the holder's app finds out the next time it
uses the handle. A call through it is rejected with `kv_handle_not_found`, and
a [`puter.events.onLocal()`](/Events/onLocal/) subscription on it ends, calling
`onError` with the reason `permission_revoked`. Take the share off the "Shared
with me" list in both cases:

```js
await puter.events.onLocal(`kv:${handle}:*`, ({ event }) => showChange(event), {
    onError: (error) => {
        if (error.reason === 'permission_revoked') removeShared(handle);
    },
});

try {
    await puter.kv.get('meta', { handle });
} catch (error) {
    if (error.code === 'kv_handle_not_found') removeShared(handle);
}
```
