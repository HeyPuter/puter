---
title: puter.fs.unshare()
description: Withdraw a user's access to a shared file or directory.
platforms: [websites, apps, nodejs, workers]
---

This method withdraws a user's access to a file or directory.

> **What an app can share.** An app never gets more reach than it was given. It
> can share its own AppData, and files the user specifically granted it, at up
> to the level of access it holds itself — so an app with read access can grant
> read, and nothing more. Files its user owns but never handed to the app stay
> out of reach, and `listShared()` shows an app only the shares it can reach.
> Shares an app creates are attributed to the user and carry `issuedByApp`, so
> the owner can tell them apart in [`getShares()`](/FS/getShares/).

## Syntax

```js
puter.fs.unshare(path, recipient)
puter.fs.unshare(options)
```

## Parameters

#### `path` (String) (required)

The path to the file or directory. If `path` is not absolute, it will be resolved relative to the app's root directory.

#### `recipient` (String | Object) (required)

Whose access to withdraw. A string containing `@` is treated as an email address, and any other string as a username.

Pass **yourself** to leave a share someone else gave you.

#### `options` (Object) (optional)

An object with the following properties:

- `path` (String) - The item. Required when passing options as the only argument.
- `uid` (String) - The item, by UID. Can be used instead of `path`.
- `recipient` (String | Object) - Whose access to withdraw.

## Return value

A `Promise` that resolves to `{ revoked }`, where `revoked` is how many grants were actually removed. It is `0` when there was nothing to withdraw, which is not an error.

## Who can withdraw what

- The item's **owner** can withdraw any share of it, whoever granted it.
- Anyone else can withdraw the shares **they** granted.
- **Anyone** can withdraw their own access, whoever granted it.

An item's owner cannot be removed from their own item.

Withdrawing someone's access also withdraws whatever **they** re-shared of that item. Their authority to grant came from the access being removed, so it cannot outlive it.

Passing an email address that was **invited** but has not yet joined cancels the invitation. Nothing was granted, so nothing is revoked from anyone — the pending share simply stops waiting.

## Examples

<strong class="example-title">Stop sharing a file</strong>

```html;fs-unshare
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            await puter.fs.write('report.txt', 'Quarterly numbers');
            await puter.fs.share('report.txt', 'friend@example.com');

            const result = await puter.fs.unshare('report.txt', 'friend@example.com');
            puter.print(`Removed ${result.revoked} share(s)<br>`);
        })()
    </script>
</body>
</html>
```

<strong class="example-title">Leave a share someone gave you</strong>

```js
const me = await puter.auth.getUser();
await puter.fs.unshare('/alice/report.txt', me.username);
```

## Related

- [`puter.fs.share()`](/FS/share/) - Grant access
- [`puter.fs.getShares()`](/FS/getShares/) - See who can reach an item
