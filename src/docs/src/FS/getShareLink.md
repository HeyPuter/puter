---
title: puter.fs.getShareLink()
description: Build a link that opens a file in an app on Puter, for the people the file is shared with.
platforms: [websites, apps, nodejs, workers]
---

Builds the link that opens a file in an app on Puter, of the form `https://puter.com/app/<appName>?file=<uid>`. Send it to whoever the file is shared with: following it signs them in if needed, then opens the app with the file — after Puter has asked them to allow the app to open it.

The link carries no access of its own. It works for the file's owner, for anyone the file was shared with through [`share()`](/FS/share/), and for any signed-in account once the file is open to **anyone with the link**. For everyone else the file is not found, and the app opens without it.

## Syntax

```js
puter.fs.getShareLink(item)
puter.fs.getShareLink(item, appName)
puter.fs.getShareLink(options)
```

## Parameters

#### `item` (String) (required)

The file, as a path or a UID. If a path is not absolute, it is resolved relative to the app's root directory. Directories are refused: a link opens one file in one app.

#### `appName` (String) (optional)

The name of the app the link opens the file with. Defaults to the app the code is running in; outside a Puter app it is required.

#### `options` (Object) (optional)

An object with the following properties:

- `path` (String) - The file. Required when passing options as the only argument, unless `uid` is given.
- `uid` (String) - The file, by UID. Can be used instead of `path`.
- `appName` (String) - As above.

## Return value

A `Promise` that resolves to the link, as a string. It is built on the file's UID, so renaming or moving the file does not break it.

## Errors

| `code` | Meaning |
| --- | --- |
| `field_missing` | Neither a path nor a UID was given. |
| `app_name_required` | No `appName` was given, and the code is not running inside a Puter app. |
| `not_a_file` | The item is a directory. |

A file that does not exist, or that you cannot see, rejects the way [`stat()`](/FS/stat/) does.

## What the recipient sees

The app opens on the recipient's Puter, and before it is handed the file Puter shows them what is being asked — which app, which file — and lets them refuse. Refused, the app still opens, just without the file. The app receives the access the recipient has: a file shared read-only opens read-only.

## Examples

<strong class="example-title">Open a shared file in an app</strong>

```html;fs-getShareLink
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            await puter.fs.write('notes.txt', 'Meeting notes');
            // Anyone signed in who has the link may read it (paid plans).
            await puter.fs.share('notes.txt', { anyone: true }, 'read');

            const link = await puter.fs.getShareLink('notes.txt', 'editor');
            puter.print(`Open in Editor: <a href="${link}" target="_blank">${link}</a>`);
        })()
    </script>
</body>
</html>
```

<strong class="example-title">Send a collaborator straight into your app</strong>

```js
// Inside a Puter app, the link opens the file in this app.
await puter.fs.share('draft.md', 'friend@example.com', 'write');
const link = await puter.fs.getShareLink('draft.md');
```

## Related

- [`puter.fs.share()`](/FS/share/) - Grant access, or open the file to anyone with the link
- [`puter.fs.getReadURL()`](/FS/getReadURL/) - A URL that reads the file's bytes without signing in
