---
title: puter.perms.request()
description: Request a specific permission string to be granted.
platforms: [websites, apps]
---

Request a specific permission string to be granted. Note that some permission strings are not supported and will be denied silently.

Inside the Puter desktop the permission prompt is shown as a dialog. On websites, it opens in a popup window on the Puter origin — call this from a user gesture (e.g. a click handler) so the browser doesn't block the popup; without a gesture, a consent dialog is shown first and the popup opens when the user clicks Continue.

## Syntax

```js
puter.perms.request(permission)
```

## Parameters

#### `permission` (string) (required)
The permission string to request. Permission strings follow specific formats depending on the resource type:
- User email: `user:{uuid}:email:read`
- File system: `fs:{path}:{read|write}`
- Apps: `apps-of-user:{uuid}:{read|write}`
- Subdomains: `subdomains-of-user:{uuid}:{read|write}`

## Return value

A `Promise` that resolves to `true` if the permission was granted, or `false` otherwise.

## Example

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <button id="request-permission">Request Permission</button>
    <script>
        document.getElementById('request-permission').addEventListener('click', async () => {
            // Get the current user's UUID
            const user = await puter.auth.getUser();
            const permission = `user:${user.uuid}:email:read`;
            
            const granted = await puter.perms.request(permission);
            if (granted) {
                puter.print('Permission granted');
            } else {
                puter.print('Permission denied');
            }
        });
    </script>
</body>
</html>
```

