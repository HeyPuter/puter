---
title: puter.perms.requestWriteDocuments()
description: Request write access to the user's Documents folder.
platforms: [apps]
---

Request write access to the user's Documents folder. If the user has already granted this permission the user will not be prompted and the path will be returned. If the user grants permission the path will be returned. If the user does not allow access `undefined` will be returned.

## Syntax

```js
puter.perms.requestWriteDocuments()
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
    <button id="request-documents">Request Documents Write Access</button>
    <script>
        document.getElementById('request-documents').addEventListener('click', async () => {
            const documentsPath = await puter.perms.requestWriteDocuments();
            if (documentsPath) {
                puter.print(`Documents path: ${documentsPath}`);
                // Now you can write files to the Documents folder
                await puter.fs.write(`${documentsPath}/my-document.txt`, 'Hello from Documents!');
                puter.print('File written to Documents folder');
            } else {
                puter.print('Documents write access denied');
            }
        });
    </script>
</body>
</html>
```

