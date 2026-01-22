---
title: puter.auth.isSignedIn()
description: Check if a user is currently signed into the application with their Puter account.
platforms: [websites, apps, nodejs, workers]
---

Checks whether the user is signed into the application.

## Syntax

```js
puter.auth.isSignedIn()
```

## Parameters

None

## Return value

Returns `true` if the user is signed in, `false` otherwise.

## Example

```html;auth-is-signed-in
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        puter.print(`Sign in status: ${puter.auth.isSignedIn()}`);
    </script>
</body>
</html>
```
