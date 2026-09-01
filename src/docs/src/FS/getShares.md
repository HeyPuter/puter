---
title: puter.fs.getShares()
description: List who has access to a shared file or directory.
platforms: [websites, apps, nodejs, workers]
---

This method lists who can reach a file or directory you own, or one you have `manage` access to.

> **What an app can share.** An app never gets more reach than it was given. It
> can share its own AppData, and files the user specifically granted it, at up
> to the level of access it holds itself — so an app with read access can grant
> read, and nothing more. Files its user owns but never handed to the app stay
> out of reach, and `listShared()` shows an app only the shares it can reach.
> Shares an app creates are attributed to the user and carry `issuedByApp`, so
> the owner can tell them apart in [`getShares()`](/FS/getShares/).

## Syntax

```js
puter.fs.getShares(path)
puter.fs.getShares(options)
```

## Parameters

#### `path` (String) (required)

The path to the file or directory. If `path` is not absolute, it will be resolved relative to the app's root directory.

#### `options` (Object) (optional)

An object with the following properties:

- `path` (String) - The item. Required when passing options as the only argument.
- `uid` (String) - The item, by UID. Can be used instead of `path`.

## Return value

A `Promise` that resolves to an array of share objects, each with `uid`, `mode`, `path`, `entryUid`, `isDir`, `issuer`, `holder`, `inheritedFrom`, `issuedByApp`, `modified` and `size`.

`issuedByApp` is the UID of the app that asked for the share, or `null` when a person made it directly.

`inheritedFrom` is the path of the shared ancestor an access comes from, or `null` when the share is on the item itself. Like `path`, it is masked when you are not the owner. Access inherited from a parent folder is **managed on that folder** — withdrawing it here is not possible, because the grant does not live on this item.

The list includes shares granted by **anyone** holding `manage` on the item, not only your own. That is how an owner sees what someone they trusted has re-shared.

It also includes **invitations** — shares aimed at an email address with no confirmed account yet. Those carry `pending: true`, a `null` `holder`, and the address in `recipientEmail`. They grant nothing until the recipient confirms that address, and [`unshare()`](/FS/unshare/) cancels one before it is claimed.

If you cannot see the item at all, this rejects the same way a missing file would — it will not confirm that the item exists.

## Examples

<strong class="example-title">See who can reach a file</strong>

```html;fs-getShares
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            await puter.fs.write('report.txt', 'Quarterly numbers');
            await puter.fs.share('report.txt', 'friend@example.com', 'read');

            const shares = await puter.fs.getShares('report.txt');
            for (const share of shares) {
                puter.print(`${share.holder}: ${share.mode} (from ${share.issuer})<br>`);
            }
        })()
    </script>
</body>
</html>
```

<strong class="example-title">Withdraw everyone's access</strong>

```js
const shares = await puter.fs.getShares('report.txt');
for (const share of shares) {
    await puter.fs.unshare('report.txt', share.holder);
}
```

## Related

- [`puter.fs.share()`](/FS/share/) - Grant access
- [`puter.fs.unshare()`](/FS/unshare/) - Withdraw access
