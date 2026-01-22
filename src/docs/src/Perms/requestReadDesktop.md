---
title: puter.perms.requestReadDesktop()
description: Request read access to the user's Desktop folder.
platforms: [apps]
---

Request read access to the user's Desktop folder. If the user has already granted this permission the user will not be prompted and the path will be returned. If the user grants permission the path will be returned. If the user does not allow access `undefined` will be returned.

## Syntax

```js
puter.perms.requestReadDesktop()
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
    <button id="request-desktop">Request Desktop Read Access</button>
    <script>
        document.getElementById('request-desktop').addEventListener('click', async () => {
            const desktopPath = await puter.perms.requestReadDesktop();
            if (desktopPath) {
                puter.print(`Desktop path: ${desktopPath}`);
                // Now you can read files from the Desktop
                const items = await puter.fs.readdir(desktopPath);
                puter.print(`Desktop contains ${items.length} items`);
            } else {
                puter.print('Desktop read access denied');
            }
        });
    </script>
</body>
</html>
```

