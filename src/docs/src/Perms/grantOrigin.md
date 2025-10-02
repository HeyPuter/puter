Grants a permission from the current actor (usually a user) to the specified origin.
This "granted permission" is simply a link between the current actor and the app representing
the specified origin through which a permission may be obtained when the app is running on behalf of the current actor.
If the current actor does not have this permission or loses this permission at some point, 
this link will have no effect (that does **not** mean this action has no effect).

This origin will be translated to an app UID that represents a website using puter.js.

**This currently cannot be called from non-privileged apps**

## Syntax

```js
puter.perms.grantOrigin(origin, permissionString);
```

## Parameters

#### `origin` (string) (required)

The origin (e.g., "https://example.com") to grant permission to.

#### `permissionString` (string) (required)

## Return value

Empty object (reserved for future use)

## Example

```html;auth-get-user
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        puter.perms.grantOrigin('https://example.com', 'fs:FILE-BELONGING-TO-BOB:read');
    </script>
</body>
</html>
```
