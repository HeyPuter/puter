---
title: puter.fs.share()
description: Give another Puter user access to a file or directory.
platforms: [websites, apps, nodejs, workers]
---

This method gives another Puter user access to a file or directory you own, or one you have been given `manage` access to.

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
- `'manage'` - Re-share the item with other people. Does **not** by itself allow writing.
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
- `path` (String) - Path of the shared item.
- `entryUid` (String) - UID of the shared item.
- `isDir` (Boolean) - Whether the shared item is a directory.
- `issuer` (String) - Username of whoever granted the share.
- `holder` (String) - Username of whoever received it.
- `inheritedFrom` (String) - Path of the shared ancestor this access comes from, or `null` when the share is on the item itself.
- `modified` (Number) - Last-modified time of the item, in unix seconds.
- `size` (Number) - Size of the item in bytes; `null` for a directory.

Sharing the same item with the same person again **replaces** their access rather than adding a second share, so raising someone from `read` to `write` is just another call.

If some recipients succeed and others fail, the promise resolves with the ones that worked. It rejects only when every pair failed.

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

// A manager can share it with other people.
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

## Related

- [`puter.fs.unshare()`](/FS/unshare/) - Withdraw access
- [`puter.fs.getShares()`](/FS/getShares/) - See who can reach an item
- [`puter.fs.listShared()`](/FS/listShared/) - See what others have shared with you
