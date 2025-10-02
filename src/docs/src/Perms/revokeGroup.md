Revokes a permission from the current actor (usually a user) to the specified group
which has already been granted by this actor. If the specified group has another
pathway to this permission then this revoke will only remove the link to this
permission between the current actor and the specified group and the specified group
will still have access until the other pathway is also revoked.

**This currently cannot be called from non-privileged apps**

## Syntax

```js
puter.perms.revokeGroup(group_uid, permissionString);
```

## Parameters

#### `group_uid` (string) (required)

The UUID of the group to revoke permission from.

#### `permissionString` (string) (required)

## Return value

Empty object (reserved for future use)

## Example

```html;auth-get-user
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        puter.perms.revokeGroup('550e8400-e29b-41d4-a716-446655440000', 'fs:FILE-BELONGING-TO-BOB:read');
    </script>
</body>
</html>
```
