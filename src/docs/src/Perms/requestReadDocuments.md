---
title: puter.perms.requestReadDocuments()
description: Request read access to the user's Documents folder.
platforms: [apps]
---

Request read access to the user's Documents folder. If the user has already granted this permission the user will not be prompted and the path will be returned. If the user grants permission the path will be returned. If the user does not allow access `undefined` will be returned.

## Syntax

```js
puter.perms.requestReadDocuments()
```

## Parameters

None

## Return value

A `Promise` that resolves to:
- `string` - The Documents folder path if permission is granted
- `undefined` - If permission is denied

## Example

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <button id="request-documents">Request Documents Read Access</button>
    <script>
        document.getElementById('request-documents').addEventListener('click', async () => {
            const documentsPath = await puter.perms.requestReadDocuments();
            if (documentsPath) {
                puter.print(`Documents path: ${documentsPath}`);
                // Now you can read files from the Documents folder
                const items = await puter.fs.readdir(documentsPath);
                puter.print(`Documents contains ${items.length} items`);
            } else {
                puter.print('Documents read access denied');
            }
        });
    </script>
</body>
</html>
```

