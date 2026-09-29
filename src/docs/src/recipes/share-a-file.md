---
title: Share a File
description: "Learn how to add file sharing to your app with Puter.js, so users can share files in their Puter account with other people."
tags: [fs, auth]
order: 45
---

Every file in Puter lives inside one user's Puter account, and only that user
can open it. When another Puter user needs the same file, share it with them
using the [filesystem API](/FS/). They can then open it from their own account,
without anyone copying the file or sending a link.

This lets you build sharing right inside your app, so people can work together
on a file.

## Share with someone

Pass the path and who to share it with:

```js
await puter.fs.share('report.txt', 'alice');
```

A string with an `@` in it is read as an email address, anything else as a
username. You can also be explicit, which is worth doing when the value comes
from user input:

```js
await puter.fs.share('report.txt', { username: 'alice' });
await puter.fs.share('report.txt', { email: 'alice@example.com' });
```

Sharing with an email address that has no Puter account yet sends an
invitation instead, which grants access once that address is confirmed.

## Choose how much access

The third argument is the mode, and it defaults to `'read'`:

```js
await puter.fs.share('budget.xlsx', 'alice', 'write');
```

- `'read'`: open it.
- `'write'`: open and change it. Does **not** allow sharing it onward.
- `'manage'`: everything `'write'` allows, plus re-sharing it.
- `'list'`, `'see'`: weaker than `read`, for making something discoverable
  without exposing what is in it.

Sharing the same item with the same person again **replaces** their access
instead of adding a second share, so changing someone from read to write is one
more call:

```js
const [share] = await puter.fs.share('budget.xlsx', 'alice', 'write');

share.mode;    // 'write'
share.isNew;   // false, she already had access, at a different mode
```

The `isNew` field is `true` when the person did not have access before, and
`false` when they already had access. Use it to decide whether to show a
confirmation.

## See what has been shared with you

```js
const { items } = await puter.fs.listShared();

for (const item of items) {
    console.log(item.name, item.mode, item.owner);
}
```

This resolves to an object with an `items` array, not to an
array. Your own files are never in it.

Shared items appear at a **masked path** of the form `/<owner>/<uid>/<name>`.
It works with any `puter.fs` method, so you can read one directly from the
listing:

```js
const [first] = items;
const blob = await puter.fs.read(first.path);
console.log(await blob.text());
```

The masked path hides *where* the item is stored in the owner's account, and
what other files are next to it. Label the item with `name`, since the masked
path has no meaningful folder to show.

## See who you shared something with

```js
const shares = await puter.fs.getShares('report.txt');

for (const share of shares) {
    console.log(share.holder, share.mode);
}
```

This lists shares made by **anyone** holding `manage` on the item, not only
yours, so an owner can see who else it was shared with by the people they gave
`manage` to.

## Take access back

```js
const { revoked } = await puter.fs.unshare('report.txt', 'alice');
```

`revoked` counts the grants actually removed. `0` means there was nothing to
remove, which is not an error, so unsharing twice is safe.

To remove your own access to a file someone else shared with you, pass
**yourself** as the recipient.
