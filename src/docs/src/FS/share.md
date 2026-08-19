---
title: puter.fs.share()
description: Give another Puter user access to a file or directory.
platforms: [websites, apps, nodejs, workers]
---

This method gives another Puter user access to a file or directory you own, or one you have been given `manage` access to.

> **What an app can share.** An app never gets more reach than it was given. It
> can share its own AppData, and files the user specifically granted it, at up
> to the level of access it holds itself — so an app with read access can grant
> read, and nothing more. Files its user owns but never handed to the app stay
> out of reach, and `listShared()` shows an app only the shares it can reach.
> Shares an app creates are attributed to the user and carry `issuedByApp`, so
> the owner can tell them apart in [`getShares()`](/FS/getShares/).

## Syntax

```js
puter.fs.share(path, recipient)
puter.fs.share(path, recipient, mode)
puter.fs.share(options)
```

## Parameters

#### `path` (String) (required)

The path to the file or directory to share.
If `path` is not absolute, it will be resolved relative to the app's root directory.

#### `recipient` (String | Object | Array) (required)

Who to share with. A string containing `@` is treated as an email address, and any other string as a username. You can also pass `{ email }` or `{ username }`, or an array to share with several people at once.

#### `mode` (String) (optional)

How much access to grant. Defaults to `'read'`.

- `'read'` - Read the item.
- `'write'` - Read and change the item. Does **not** allow re-sharing it.
- `'manage'` - Everything `'write'` allows, plus re-sharing the item with other people.
- `'list'`, `'see'` - Weaker than `read`; useful for making an item discoverable without exposing its contents.

#### `options` (Object) (optional)

An object with the following properties:

- `path` (String) - Item to share. Required when passing options as the only argument.
- `uid` (String) - Item to share, by UID. Can be used instead of `path`.
- `paths` (Array) - Several items to share in one call.
- `recipient` (String | Object | Array) - Who to share with.
- `mode` (String) - Access to grant. Defaults to `'read'`.

## Return value

A `Promise` that resolves to an array of share objects, one per recipient/item pair that succeeded. Each has:

- `uid` (String) - Identifier for this share.
- `mode` (String) - Access the recipient now has.
- `path` (String) - Path of the shared item, masked when you do not own it (see [`listShared()`](/FS/listShared/)).
- `name` (String) - Name of the shared item. The masked path hides the folder it sits in, so this is what to label it with.
- `entryUid` (String) - UID of the shared item.
- `isDir` (Boolean) - Whether the shared item is a directory.
- `issuer` (String) - Username of whoever granted the share.
- `holder` (String) - Username of whoever received it.
- `inheritedFrom` (String) - Path of the shared ancestor this access comes from, or `null` when the share is on the item itself.
- `pending` (Boolean) - Present and `true` when the recipient's email has no confirmed Puter account. See below.
- `recipientEmail` (String) - Address a pending share was sent to. Only set when `pending`.
- `modified` (Number) - Last-modified time of the item, in unix seconds.
- `size` (Number) - Size of the item in bytes; `null` for a directory.

Sharing the same item with the same person again **replaces** their access rather than adding a second share, so raising someone from `read` to `write` is just another call.

If some recipients succeed and others fail, the promise resolves with the ones that worked. It rejects only when every pair failed.

## Errors

A rejection carries `{ message, code }`. Because each recipient/item pair succeeds or fails on its own, these are the codes of the *pairs* that failed — you only see one as a rejection when every pair failed.

| `code` | Meaning |
| --- | --- |
| `subject_does_not_exist` | No such item, or you cannot see it. Also what a caller without permission to share gets, so the response never reveals which. |
| `forbidden` | You can see the item but may not share it at the level you asked for. |
| `user_does_not_exist` | The username has no account. (An unknown *email* is invited instead — see below.) |
| `recipient_not_accepting_shares` | The recipient is not accepting this share — they have blocked you, or turned off new shares from everyone. Nothing is granted and they are not notified. Which of the two it is is not reported. |
| `email_not_allowed` | The address can't receive an invite — malformed, or refused by the deployment's policy. |
| `cannot_share_with_self` | You are the recipient. |
| `cannot_share_with_owner` | The recipient already owns the item. |
| `invalid_mode` | `mode` is not one of `see`, `list`, `read`, `write`, `manage`. |
| `share_daily_limit_reached` | You have handed out as many new shares as one account may per day (see [rate limits](/rate-limits-and-quotas/)). |
| `too_many_recipients`, `too_many_items` | One call's fan-out cap; split the request. |

## Sharing with someone who has no account

A **well-formed** email address with no confirmed Puter account is **invited** rather than refused. The share is recorded and the recipient is emailed, but it grants nothing yet — the returned share carries `pending: true` and a `null` `holder`. An address that could never receive that invite is rejected with `email_not_allowed` instead of becoming an invite nobody can claim.

Access is written when they create an account with that address **and confirm it**. Signing up alone is not enough: until the address is confirmed it is a claim rather than an identity, and honouring it would hand the share to whoever registered it first.

An invite shows up in [`getShares()`](/FS/getShares/) with `pending: true`, and [`unshare()`](/FS/unshare/) cancels it.

```js
const [share] = await puter.fs.share('report.txt', 'newcomer@example.com');

if ( share.pending ) {
    puter.print(`Invited ${share.recipientEmail} — access starts when they join`);
} else {
    puter.print(`Shared with ${share.holder}`);
}
```

## Examples

<strong class="example-title">Share a file with another user</strong>

```html;fs-share
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            // (1) create a file
            await puter.fs.write('report.txt', 'Quarterly numbers');

            // (2) share it, read-only
            const shares = await puter.fs.share('report.txt', 'friend@example.com');
            puter.print(`Shared with ${shares[0].holder} as ${shares[0].mode}<br>`);
        })()
    </script>
</body>
</html>
```

<strong class="example-title">Let someone edit, and let someone else re-share</strong>

```js
// An editor can change the file but cannot pass it on.
await puter.fs.share('report.txt', 'editor@example.com', 'write');

// A manager can edit it AND share it with other people.
await puter.fs.share('report.txt', 'manager@example.com', 'manage');
```

<strong class="example-title">Share one item with several people</strong>

```js
await puter.fs.share({
    path: 'report.txt',
    recipient: ['a@example.com', 'b@example.com'],
    mode: 'read',
});
```

## Live updates

Changes inside a shared item are not pushed to recipients in real time —
filesystem socket events go to the item's owner only. A client that shows
shared content and needs it current should re-read it (`readdir`/`stat`)
when freshness matters, for example on focus or an explicit refresh.

## What sharing does not promise

Three things are worth knowing before you share something sensitive.

**A signed URL outlives the share.** Anyone who can read a shared item can
mint a signed URL for it, and that URL is a bearer token: it works for whoever
holds it, signed in or not. Signatures over an item you do not own expire after
an hour, but withdrawing access does not invalidate one that has already been
issued. Treat an hour as the floor on how long a recipient can keep, or pass
on, what you gave them.

**An app you have authorized can share on your behalf.** Sharing is done in
your name, so an app acting for you can share the items it can already reach —
its own AppData, and whatever you handed it — with anyone, and at any level it
holds itself. It cannot reach past that into the rest of your files. Shares an
app issued are marked with `issued_by_app` in
[`getShares()`](/FS/getShares/), so you can tell them apart from your own.

**Moving an item into someone else's folder hands it over.** The folder's owner
becomes the item's owner, its bytes start counting against their storage rather
than yours, and any shares you had on it are withdrawn — they were yours to
give, and it is no longer yours. The same applies in reverse: files a recipient
creates inside a folder you shared belong to you and count against your
storage.

## Related

- [`puter.fs.unshare()`](/FS/unshare/) - Withdraw access
- [`puter.fs.getShares()`](/FS/getShares/) - See who can reach an item
- [`puter.fs.listShared()`](/FS/listShared/) - See what others have shared with you
