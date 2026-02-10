---
title: puter.auth.getUser()
description: Retrieve the authenticated user basic information.
platforms: [websites, apps, nodejs, workers]
---

Returns the user's basic information.

## Syntax

```js
puter.auth.getUser()
```

## Parameters

None

## Return value

A promise that resolves to a [`User`](/Objects/user) object containing the user's basic information.

## Example

```html;auth-get-user
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        puter.auth.getUser().then(function(user) {
            puter.print(JSON.stringify(user));
        });
    </script>
</body>
</html>
```
