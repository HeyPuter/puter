---
title: puter.perms.requestFolder()
description: Request read or write access to one of the user's special folders.
platforms: [websites, apps]
---

Request access to one of the user's special folders — `Desktop`, `Documents`, `Pictures`, or `Videos` — and get its path back. If the user has already granted the access they are not prompted and the path is returned. If the user grants permission the path is returned. If the user does not allow access `undefined` is returned.

Read access is inferred from being able to see the folder, so a request for `read` on a folder your app can already reach resolves without a prompt. A request for `write` always prompts unless the access is already held.

On a website, sign the user in to your site first with [`puter.auth.signIn()`](/Auth/signIn/). This method reads the signed-in user's identity before it can prompt, so for a signed-out visitor it rejects with `Unauthorized` and no prompt is shown. Answering a permission prompt does not by itself sign the user in to your site, so guard the call:

```js
if (!puter.authToken) await puter.auth.signIn();
```

## Syntax

```js
puter.perms.requestFolder(folderName)
puter.perms.requestFolder(folderName, accessLevel)
```

## Parameters

#### `folderName` (String) (required)

The folder to request. One of `'Desktop'`, `'Documents'`, `'Pictures'`, or `'Videos'`.

#### `accessLevel` (String) (optional)

`'read'` or `'write'`. Defaults to `'read'`.

## Return value

A `Promise` that resolves to:
- `string` - The folder path if permission is granted
- `undefined` - If permission is denied

Rejects with `invalid_argument` if `folderName` is not one of the four folders above, or if `accessLevel` is neither `'read'` nor `'write'`.

## Example

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <button id="request-documents">Request Documents Write Access</button>
    <script>
        document.getElementById('request-documents').addEventListener('click', async () => {
            const documentsPath = await puter.perms.requestFolder('Documents', 'write');
            if (documentsPath) {
                puter.print(`Documents path: ${documentsPath}`);
                // Now you can write to the Documents folder
                await puter.fs.write(`${documentsPath}/my-file.txt`, 'Hello from Documents!');
                puter.print('File written to Documents folder');
            } else {
                puter.print('Documents write access denied');
            }
        });
    </script>
</body>
</html>
```
