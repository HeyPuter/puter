---
title: puter.perms.requestReadVideos()
description: Request read access to the user's Videos folder.
platforms: [apps]
---

Request read access to the user's Videos folder. If the user has already granted this permission the user will not be prompted and the path will be returned. If the user grants permission the path will be returned. If the user does not allow access `undefined` will be returned.

## Syntax

```js
puter.perms.requestReadVideos()
```

## Parameters

None

## Return value

A `Promise` that resolves to:
- `string` - The Videos folder path if permission is granted
- `undefined` - If permission is denied

## Example

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <button id="request-videos">Request Videos Read Access</button>
    <script>
        document.getElementById('request-videos').addEventListener('click', async () => {
            const videosPath = await puter.perms.requestReadVideos();
            if (videosPath) {
                puter.print(`Videos path: ${videosPath}`);
                // Now you can read files from the Videos folder
                const items = await puter.fs.readdir(videosPath);
                puter.print(`Videos contains ${items.length} items`);
            } else {
                puter.print('Videos read access denied');
            }
        });
    </script>
</body>
</html>
```

