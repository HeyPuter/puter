---
title: Share a File
description: "Give another Puter user access to a file or folder, see what has been shared with you, and take access back again."
tags: [fs, auth]
order: 45
---

**Use this when** two people need the same file. Sharing hands a named person
access to something in your storage, so they reach it from their own account
without you copying anything or minting a link.

For a temporary URL to one file — an `<img>` tag, a download button — you want
[`puter.fs.getReadURL()`](/FS/getReadURL/) instead; see
[storing files](/recipes/store-files/).

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

## Choose how much access

The third argument is the mode, and it defaults to `'read'`:

```js
await puter.fs.share('budget.xlsx', 'alice', 'write');
```

- `'read'` — open it.
- `'write'` — open and change it. Does **not** allow sharing it onward.
- `'manage'` — everything `'write'` allows, plus re-sharing it.
- `'list'`, `'see'` — weaker than `read`, for making something discoverable
  without exposing what is in it.

Sharing the same item with the same person again **replaces** their access
rather than stacking up, so raising someone from read to write is just another
call:

```js
const [share] = await puter.fs.share('budget.xlsx', 'alice', 'write');

share.mode;    // 'write'
share.isNew;   // false — she already had access, at a different mode
```

`isNew` is how you tell "I just gave this to someone" from "they already had
it", which is the difference between showing a confirmation and staying quiet.

## See what has been shared with you

```js
const { items } = await puter.fs.listShared();

for (const item of items) {
    console.log(item.name, item.mode, item.owner);
}
```

Note the shape: this resolves to an object with an `items` array, not to an
array. Your own files are never in it.

Shared items appear at a **masked path** of the form `/<owner>/<uid>/<name>`.
It works with any `puter.fs` method, so you can read one straight off the
listing:

```js
const [first] = items;
const blob = await puter.fs.read(first.path);
console.log(await blob.text());
```

What the mask withholds is *where* the item lives in the owner's storage, and
what sits next to it. Label the item with `name` — the masked path has no
meaningful folder to show.

## See who you shared something with

```js
const shares = await puter.fs.getShares('report.txt');

for (const share of shares) {
    console.log(share.holder, share.mode);
}
```

This lists shares made by **anyone** holding `manage` on the item, not only
yours, so an owner can see what someone they trusted has passed on.

## Take access back

```js
const { revoked } = await puter.fs.unshare('report.txt', 'alice');
```

`revoked` counts the grants actually removed. `0` means there was nothing to
withdraw, which is not an error — so unsharing twice is safe.

Pass **yourself** as the recipient to walk away from something someone else
shared with you.

## Notes

- Sharing with an email address that has no Puter account yet sends an
  **invitation** instead. It appears in `getShares()` with `pending: true` and a
  `null` `holder`, and grants nothing until that address is confirmed.
- One call can take an array of recipients. If some succeed and others fail, the
  promise still resolves with the ones that worked — it rejects only when every
  one failed.
- Rejections carry a `code`. The ones worth handling by name are
  `user_does_not_exist`, `cannot_share_with_self`, `cannot_share_with_owner` and
  `recipient_not_accepting_shares` (the recipient has blocked you or turned off
  new shares; nothing is granted and they are not told).
- Handing out access needs a verified phone or card on deployments that can
  verify either, so a first share may reject with `phone_verification_required`.
  Listing and withdrawing never ask for this.
- Access that comes from a shared parent folder shows `inheritedFrom` set to
  that folder. It is managed there — you cannot withdraw it from the item
  itself.
