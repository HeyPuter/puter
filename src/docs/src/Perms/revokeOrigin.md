Revokes a permission from the current actor (usually a user) to the specified origin
which has already been granted by this actor. If the app representing the specified origin has another
pathway to this permission then this revoke will only remove the link to this
permission between the current actor and the app and the app
will still have access until the other pathway is also revoked.

**This currently cannot be called from non-privileged apps**

## Syntax

```js
puter.perms.revokeOrigin(origin, permissionString);
```

## Parameters

#### `origin` (string) (required)

The origin (e.g., "https://example.com") to revoke permission from.

#### `permissionString` (string) (required)

## Return value

Empty object (reserved for future use)

## Example

```html;auth-get-user
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        puter.perms.revokeOrigin('https://example.com', 'fs:FILE-BELONGING-TO-BOB:read');
    </script>
</body>
</html>
```
