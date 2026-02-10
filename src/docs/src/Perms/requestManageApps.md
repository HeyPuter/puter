---
title: puter.perms.requestManageApps()
description: Request write (manage) access to the user's apps.
platforms: [apps]
---

Request write (manage) access to the user's apps. If the user has already granted this permission the user will not be prompted and `true` will be returned. If the user grants permission `true` will be returned. If the user does not allow access `false` will be returned.

## Syntax

```js
puter.perms.requestManageApps()
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
    <button id="request-apps">Request Apps Manage Access</button>
    <script>
        document.getElementById('request-apps').addEventListener('click', async () => {
            const granted = await puter.perms.requestManageApps();
            if (granted) {
                puter.print('Apps manage access granted');
                // Now you can create, update, or delete apps
                // Example: await puter.apps.create({ ... });
            } else {
                puter.print('Apps manage access denied');
            }
        });
    </script>
</body>
</html>
```

