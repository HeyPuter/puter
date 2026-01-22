---
title: puter.perms.requestReadSubdomains()
description: Request read access to the user's subdomains.
platforms: [apps]
---

Request read access to the user's subdomains. If the user has already granted this permission the user will not be prompted and `true` will be returned. If the user grants permission `true` will be returned. If the user does not allow access `false` will be returned.

## Syntax

```js
puter.perms.requestReadSubdomains()
```

## Parameters

None

## Return value

A `Promise` that resolves to:
- `true` - If permission is granted
- `false` - If permission is denied

## Example

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <button id="request-subdomains">Request Subdomains Read Access</button>
    <script>
        document.getElementById('request-subdomains').addEventListener('click', async () => {
            const granted = await puter.perms.requestReadSubdomains();
            if (granted) {
                puter.print('Subdomains read access granted');
                // Now you can read the user's subdomains
                // Note: This requires the Hosting API
            } else {
                puter.print('Subdomains read access denied');
            }
        });
    </script>
</body>
</html>
```

