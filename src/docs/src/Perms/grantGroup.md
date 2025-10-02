## grantGroup

Grants a permission from the current actor (usually a user) to the specified group.
This "granted permission" is simply a link between the current actor and specified
group through which a permission may be obtained. If the current actor does not have
this permission or loses this permission at some point, this link will have no
effect (that does **not** mean this action has no effect).

**This currently cannot be called from non-privileged apps**

## Syntax

```js
puter.perms.grantGroup(group_uid, permissionString);
```

## Parameters

#### `group_uid` (string) (required)

The UUID of the group to grant permission to.

#### `permissionString` (string) (required)

### Return value

Empty object (reserved for future use)

## Example

```html;auth-get-user
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        puter.perms.grantGroup('550e8400-e29b-41d4-a716-446655440000', 'fs:FILE-BELONGING-TO-BOB:read');
    </script>
</body>
</html>
```
