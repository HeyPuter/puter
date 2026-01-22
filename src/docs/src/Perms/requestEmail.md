---
title: puter.perms.requestEmail()
description: Request access to the user's email address.
platforms: [apps]
---

Request to see a user's email. If the user has already granted this permission the user will not be prompted and their email address will be returned. If the user grants permission their email address will be returned. If the user does not allow access `undefined` will be returned. If the user does not have an email address, the value of their email address will be `null`.

## Syntax

```js
puter.perms.requestEmail()
```

## Parameters

None

## Return value

A `Promise` that resolves to:
- `string` - The user's email address if permission is granted and the user has an email
- `null` - If permission is granted but the user does not have an email address
- `undefined` - If permission is denied

## Example

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <button id="request-email">Request Email Access</button>
    <script>
        document.getElementById('request-email').addEventListener('click', async () => {
            const email = await puter.perms.requestEmail();
            if (email !== undefined) {
                if (email === null) {
                    puter.print('User does not have an email address');
                } else {
                    puter.print(`Email: ${email}`);
                }
            } else {
                puter.print('Email access denied');
            }
        });
    </script>
</body>
</html>
```

