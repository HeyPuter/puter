Revokes a permission from the current actor (usually a user) to the specified app
which has already been granted by this actor for use with any user. If the specified app has another
pathway to this permission then this revoke will only remove the link to this
permission between the current actor and the specified app and the specified app
will still have access until the other pathway is also revoked.

**This currently cannot be called from non-privileged apps**

## Syntax

```js
puter.perms.revokeAppAnyUser(app_uid, permissionString);
```

## Parameters

#### `app_uid` (string) (required)

The UID of the app to revoke permission from.

#### `permissionString` (string) (required)

## Return value

Empty object (reserved for future use)

## Example

```html;auth-get-user
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        puter.perms.revokeAppAnyUser('app-123456789', 'fs:FILE-BELONGING-TO-BOB:read');
    </script>
</body>
</html>
```
