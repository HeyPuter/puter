---
title: puter.fs.stat()
description: Get file or directory information in the user's own Puter file system.
platforms: [websites, apps, nodejs, workers]
---

This method allows you to get information about a file or directory.

## Syntax

```js
puter.fs.stat(path, options)
puter.fs.stat(options)
```

## Parameters

#### `path` (String) (required)

The path to the file or directory to get information about.
If `path` is not absolute, it will be resolved relative to the app's root directory.

#### `options` (Object) (optional)

An object with the following properties:

- `path` (String) - Path to the file or directory. Required when passing options as the only argument.
- `uid` (String) - The UID of the file or directory. Can be used instead of `path`.
- `returnSubdomains` (Boolean) - Whether to return subdomain information. Defaults to `false`.
- `returnWorkers` (Boolean) - Whether to return the workers attached to the item. Workers are served alongside subdomains, so this is an alias of `returnSubdomains` — setting either one returns both. Defaults to `false`.
- `returnPermissions` (Boolean) - Whether to return permission information. Defaults to `false`.
- `returnVersions` (Boolean) - Whether to return version information. Defaults to `false`.
- `returnSize` (Boolean) - Whether to return size information. Defaults to `false`.
- `returnShares` (Boolean) - Whether to include who the item is shared with, as a `shares` array on the result. Defaults to `false`.

## Return value

A `Promise` that resolves to the [`FSItem`](/Objects/fsitem) object of the specified file or directory.

The item carries `is_shared`: `true` when it has been shared with someone, `false` when it has not, and `null` when the item is not yours — whether someone else's file has other recipients is not yours to see. It covers shares granted by anyone holding `manage` on the item, not only your own, the same way [`getShares()`](/FS/getShares/) does. Only shares **on the item itself** count. A file inside a folder you shared is reachable through that folder without being shared itself, so it reports `false`; `getShares()` is what reports inherited access.

With `returnShares: true`, the result also carries `shares` — an array of the same share objects [`getShares()`](/FS/getShares/) returns, including access inherited from a parent folder and unclaimed invitations. It is empty unless you own the item or hold `manage` on it, so asking for it never fails a `stat()` you were otherwise allowed to make.

## Examples

<strong class="example-title">Get information about a file</strong>

```html;fs-stat
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            // () create a file
            await puter.fs.write('hello.txt', 'Hello, world!');
            puter.print('hello.txt created<br>');

            // (2) get information about hello.txt
            const file = await puter.fs.stat('hello.txt');
            puter.print(`hello.txt name: ${file.name}<br>`);
            puter.print(`hello.txt path: ${file.path}<br>`);
            puter.print(`hello.txt size: ${file.size}<br>`);
            puter.print(`hello.txt created: ${file.created}<br>`);
        })()
    </script>
</body>
</html>
```

<strong class="example-title">See whether a file is shared, and with whom</strong>

```html;fs-stat-shares
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            await puter.fs.write('report.txt', 'Quarterly numbers');
            await puter.fs.share('report.txt', 'friend@example.com', 'read');

            const file = await puter.fs.stat('report.txt', { returnShares: true });
            puter.print(`shared: ${file.is_shared}<br>`);
            for (const share of file.shares) {
                puter.print(`${share.holder ?? share.recipientEmail}: ${share.mode}<br>`);
            }
        })()
    </script>
</body>
</html>
```

## Related

- [`puter.fs.getShares()`](/FS/getShares/) - List who can reach an item
- [`puter.fs.share()`](/FS/share/) - Grant access
