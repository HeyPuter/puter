---
title: puter.perms.requestApps()
description: Request read or write access to the user's apps.
platforms: [websites, apps]
---

Request access to the user's apps. If the user has already granted this permission the user will not be prompted and `true` will be returned. If the user grants permission `true` will be returned. If the user does not allow access `false` will be returned.

`'read'` covers listing and reading the user's apps; `'write'` additionally covers managing them — creating, updating, and deleting.

On a website, sign the user in to your site first with [`puter.auth.signIn()`](/Auth/signIn/). This method reads the signed-in user's identity before it can prompt, so for a signed-out visitor it rejects with `Unauthorized` and no prompt is shown. Answering a permission prompt does not by itself sign the user in to your site, so guard the call:

```js
if (!puter.authToken) await puter.auth.signIn();
```

## Syntax

```js
puter.perms.requestApps()
puter.perms.requestApps(accessLevel)
```

## Parameters

#### `accessLevel` (String) (optional)

`'read'` or `'write'`. Defaults to `'read'`.

## Return value

A `Promise` that resolves to:
- `true` - If permission is granted
- `false` - If permission is denied

Rejects with `invalid_argument` if `accessLevel` is neither `'read'` nor `'write'`.

## Example

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <button id="request-apps">Request Apps Read Access</button>
    <script>
        document.getElementById('request-apps').addEventListener('click', async () => {
            const granted = await puter.perms.requestApps();
            if (granted) {
                puter.print('Apps read access granted');
                // Now you can list the user's apps
                const apps = await puter.apps.list();
                puter.print(`User has ${apps.length} apps`);
            } else {
                puter.print('Apps read access denied');
            }
        });
    </script>
</body>
</html>
```
