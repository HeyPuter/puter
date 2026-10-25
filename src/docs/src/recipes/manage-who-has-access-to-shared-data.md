---
title: Manage Who Has Access to Shared Data
description: "Learn how to show users who they shared data with in your app, so they can change or remove anyone's access, and leave data other people shared with them."
tags: [kv, perms]
order: 21
---

Once users share data in your app, they need a way to see who has it and to
take it back. This recipe builds two screens, a "People with access" panel for
the data a user shared and a "Shared with me" list for the data other people
shared with them. It works with any share made by
[`puter.kv.share()`](/KV/share/), like the ones in
[Share a List With Someone](/recipes/share-a-list-with-someone/).

In an app, both lists include only shares of that app's data.

## List Who Has Access

To list the shares the user made, call
[`puter.kv.listSharedByMe()`](/KV/listSharedByMe/) a page at a time. Keep the
ones for the prefix the panel is about:

```js
const shares = [];
let cursor;
do {
    const page = await puter.kv.listSharedByMe({ limit: 50, cursor });
    shares.push(...page.items.filter((share) => share.prefix === prefix));
    cursor = page.cursor;
} while (cursor);
```

Each share has the `holder`'s username, their `access` and the share's `handle`.
A share that stopped stays in the list as a record, with `revokedAt` set to when
it stopped and `revokedBy` set to who stopped it. This shows "Left" when the
other person removed their own access:

```js
for (const share of shares) {
    const status = share.revokedBy === 'holder'
        ? 'Left'
        : share.revokedAt ? 'Removed' : share.access;
    addRow(share.holder, status, share.handle);
}
```

When the other person deletes their account, their shares are deleted with it
and leave the list.

## Change Someone's Access

Share the same prefix with the same person again, at the new level. This
changes the existing share and keeps its handle, so nothing changes on their
side except what they can do:

```js
await puter.kv.share(prefix, share.holder, 'read');
```

To raise someone to a level above the one your app has permission for, ask
again with [`puter.perms.request()`](/Perms/request/) first, as in
[Let Them Edit Later](/recipes/let-someone-view-your-data/#let-them-edit-later).

## Remove Someone

Pass the share's handle to [`puter.kv.unshare()`](/KV/unshare/):

```js
await puter.kv.unshare(share.handle);
```

The handle stops working right away for every [`puter.kv`](/KV/) call, and persistent
subscriptions on it end. Any narrower share you made with the same person
inside the same prefix stops too. The share stays in your list with
`revokedBy: 'owner'`, and the keys stay in your account.

## Show What's Been Shared With You

To list the live shares other users made with the current user, call
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
through its `handle`. [Share a List With Someone](/recipes/share-a-list-with-someone/#find-the-lists-shared-with-you)
shows how. Set the text with `textContent` so it's never read as HTML.

## Leave a Share

The holder removes their own access with the same call:

```js
await puter.kv.unshare(handle);
```

The share leaves their list, and shows in the owner's list with
`revokedBy: 'holder'`. Any narrower share they hold from the same owner inside
it stops too. Calling it again for a share that already stopped resolves the
same way, so a retry is safe.
