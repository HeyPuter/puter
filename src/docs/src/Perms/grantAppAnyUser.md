Grants a permission from the current actor (usually a user) to the specified app.
This "granted permission" is simply a link between the current actor and specified
app through which a permission may be obtained when the app is running on behalf of any user.
If the current actor does not have this permission or loses this permission at some point, 
this link will have no effect (that does **not** mean this action has no effect).

**Note**: This effectively grants the permission to any user, because users can access user-app tokens under their session.

**This currently cannot be called from non-privileged apps**

### Syntax

```js
puter.perms.grantAppAnyUser(app_uid, permissionString);
```

### Parameters

#### `app_uid` (string) (required)

The UID of the app through which all users are granted this permission.

#### `permissionString` (string) (required)

### Return value

Empty object (reserved for future use)

### Example

```html;auth-get-user
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        puter.perms.grantAppAnyUser('app-123456789', 'fs:FILE-BELONGING-TO-BOB:read');
    </script>
</body>
</html>
```
