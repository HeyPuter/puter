---
title: puter.perms.requestWriteVideos()
description: Request write access to the user's Videos folder.
platforms: [apps]
---

Request write access to the user's Videos folder. If the user has already granted this permission the user will not be prompted and the path will be returned. If the user grants permission the path will be returned. If the user does not allow access `undefined` will be returned.

## Syntax

```js
puter.perms.requestWriteVideos()
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
    <button id="request-videos">Request Videos Write Access</button>
    <script>
        document.getElementById('request-videos').addEventListener('click', async () => {
            const videosPath = await puter.perms.requestWriteVideos();
            if (videosPath) {
                puter.print(`Videos path: ${videosPath}`);
                // Now you can write files to the Videos folder
                await puter.fs.write(`${videosPath}/my-video.txt`, 'Video data here');
                puter.print('File written to Videos folder');
            } else {
                puter.print('Videos write access denied');
            }
        });
    </script>
</body>
</html>
```

