Grants a permission from the current actor (usually a user) to the specified user.
This "granted permission" is simply a link between the currect actor and specified
user through which a permission may be obtained. If the current actor does not have
this permission or loses this permission at some point, this link will have no
effect (that does **not** mean this action has no effect).

**This currently cannot be called from non-privileged apps**

## Syntax

```js
puter.perms.grantUser(username, permissionString);
```

## Parameters

#### `username` (string) (required)

The username of the user to grant permission to.

#### `permissionString` (string) (required)

## Return value

Empty object (reserved for future use)

## Example

```html;auth-get-user
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        puter.perms.grantUser('alice', 'fs:FILE-BELONGING-TO-BOB:read');
    </script>
</body>
</html>
```
