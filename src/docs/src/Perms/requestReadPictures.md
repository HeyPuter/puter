---
title: puter.perms.requestReadPictures()
description: Request read access to the user's Pictures folder.
platforms: [apps]
---

Request read access to the user's Pictures folder. If the user has already granted this permission the user will not be prompted and the path will be returned. If the user grants permission the path will be returned. If the user does not allow access `undefined` will be returned.

## Syntax

```js
puter.perms.requestReadPictures()
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
    <button id="request-pictures">Request Pictures Read Access</button>
    <script>
        document.getElementById('request-pictures').addEventListener('click', async () => {
            const picturesPath = await puter.perms.requestReadPictures();
            if (picturesPath) {
                puter.print(`Pictures path: ${picturesPath}`);
                // Now you can read files from the Pictures folder
                const items = await puter.fs.readdir(picturesPath);
                puter.print(`Pictures contains ${items.length} items`);
            } else {
                puter.print('Pictures read access denied');
            }
        });
    </script>
</body>
</html>
```

