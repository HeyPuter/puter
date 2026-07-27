---
title: puter.perms.requestWritePictures()
description: Request write access to the user's Pictures folder.
platforms: [websites, apps]
---

Request write access to the user's Pictures folder. If the user has already granted this permission the user will not be prompted and the path will be returned. If the user grants permission the path will be returned. If the user does not allow access `undefined` will be returned.

On a website, sign the user in to your site first with [`puter.auth.signIn()`](/Auth/signIn/). This method reads the signed-in user's identity before it can prompt, so for a signed-out visitor it rejects with `Unauthorized` and no prompt is shown. Answering a permission prompt does not by itself sign the user in to your site, so guard the call:

```js
if (!puter.authToken) await puter.auth.signIn();
```

## Syntax

```js
puter.perms.requestWritePictures()
```

## Parameters

None

## Return value

A `Promise` that resolves to:
- `string` - The Pictures folder path if permission is granted
- `undefined` - If permission is denied

## Example

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <button id="request-pictures">Request Pictures Write Access</button>
    <script>
        document.getElementById('request-pictures').addEventListener('click', async () => {
            const picturesPath = await puter.perms.requestWritePictures();
            if (picturesPath) {
                puter.print(`Pictures path: ${picturesPath}`);
                // Now you can write files to the Pictures folder
                await puter.fs.write(`${picturesPath}/my-image.txt`, 'Image data here');
                puter.print('File written to Pictures folder');
            } else {
                puter.print('Pictures write access denied');
            }
        });
    </script>
</body>
</html>
```

