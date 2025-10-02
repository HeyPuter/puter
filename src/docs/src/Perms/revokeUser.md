Revokes a permission from the current actor (usually a user) to the specified user
which has already been granted by this actor. If the specified user has another
pathway to this permission then this revoke will only remove the link to this
permission between the current actor and the specified user and the specified user
will still have access until the other pathway is also revoked.

**This currently cannot be called from non-privileged apps**

## Syntax

```js
puter.perms.revokeUser(username, permissionString);
```

## Parameters

#### `username` (string) (required)

The username of the user to revoke permission from.

#### `permissionString` (string) (required)

## Return value

Empty object (reserved for future use)

## Example

```html;auth-get-user
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        puter.perms.revokeUser('alice', 'fs:FILE-BELONGING-TO-BOB:read');
    </script>
</body>
</html>
```

