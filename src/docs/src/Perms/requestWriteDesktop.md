---
title: puter.perms.requestWriteDesktop()
description: Request write access to the user's Desktop folder.
platforms: [apps]
---

Request write access to the user's Desktop folder. If the user has already granted this permission the user will not be prompted and the path will be returned. If the user grants permission the path will be returned. If the user does not allow access `undefined` will be returned.

## Syntax

```js
puter.perms.requestWriteDesktop()
```

## Parameters

None

## Return value

A `Promise` that resolves to:
- `string` - The Desktop folder path if permission is granted
- `undefined` - If permission is denied

## Example

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <button id="request-desktop">Request Desktop Write Access</button>
    <script>
        document.getElementById('request-desktop').addEventListener('click', async () => {
            const desktopPath = await puter.perms.requestWriteDesktop();
            if (desktopPath) {
                puter.print(`Desktop path: ${desktopPath}`);
                // Now you can write files to the Desktop
                await puter.fs.write(`${desktopPath}/my-file.txt`, 'Hello from Desktop!');
                puter.print('File written to Desktop');
            } else {
                puter.print('Desktop write access denied');
            }
        });
    </script>
</body>
</html>
```

