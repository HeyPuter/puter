# Group Endpoints

## POST `/group/create` (auth required)

### Description

Creates a group and returns a UID (UUID formatted).
Groups do not have names, or any other descriptive attributes.
Instead they are always identified with a UUID, and they have
a `metadata` property.

The `metadata` property will always be given back to the client
in the same way it was provided. The `extra` property, also an
object, may be changed by the backend. The behavior of setting
any property on `extra` is currently undefined as all properties
are reserved for future use.

### Parameters

- **metadata:** _- optional_
  - **accepts:** `object`
  - **description:** arbitrary metadata to describe the group
- **extra:** _- optional_
  - **accepts:** `object`
  - **description:** extra parameters (server may change these)

### Request Example

```javascript
await fetch(`${window.api_origin}/group/create`, {
  "headers": {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${puter.authToken}`,
  },
  "body": JSON.stringify({
    metadata: { title: 'Some Title' }
  }),
  "method": "POST",
});

// { uid: '9c644a1c-3e43-4df4-ab67-de5b68b235b6' }
```

### Response Example

```json
{
    "uid": "9c644a1c-3e43-4df4-ab67-de5b68b235b6"
}
```

## POST `/group/add-users`

### Description

Adds one or more users to a group

### Parameters

- **uid:** _- required_
  - **accepts:** `string`
    UUID of an existing group
- **users:** `Array<string>`
  usernames of users to add to the group

### Request Example

```javascript
await fetch(`${window.api_origin}/group/add-users`, {
  "headers": {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${puter.authToken}`,
  },
  "body": JSON.stringify({
      uid: '9c644a1c-3e43-4df4-ab67-de5b68b235b6',
      users: ['first_user', 'second_user'],
  }),
  "method": "POST",
});
```

## POST `/group/remove-users`

### Description

Remove one or more users from a group

### Parameters

- **uid:** _- required_
  - **accepts:** `string`
    UUID of an existing group
- **users:** `Array<string>`
  usernames of users to remove from the group

### Request Example

```javascript
await fetch(`${window.api_origin}/group/add-users`, {
  "headers": {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${puter.authToken}`,
  },
  "body": JSON.stringify({
      uid: '9c644a1c-3e43-4df4-ab67-de5b68b235b6',
      users: ['first_user', 'second_user'],
  }),
  "method": "POST",
});
```

## GET `/group/list`

### Description

List groups associated with the current user

### Parameters

_none_

### Response Example

```json
{
    "owned_groups": [
        {
            "uid": "c3bd4047-fc65-4da8-9363-e52195890de4",
            "metadata": {},
            "members": [
                "default_user"
            ]
        }
    ],
    "in_groups": [
        {
            "uid": "c3bd4047-fc65-4da8-9363-e52195890de4",
            "metadata": {},
            "members": [
                "default_user"
            ]
        }
    ]
}
```

# Group Permission Endpoints

## POST `/grant-user-group`

Grant permission from the current user to a group.
This creates an association between the user and the
group for this permission; the group will only have
the permission effectively while the user who granted
permission has the permission.

### Parameters

- **group_uid:** _- required_
  - **accepts:** `string`
    UUID of an existing group
- **permission:** _- required_
  - **accepts:** `string`
    A permission string

### Request Example

```javascript
await fetch("http://puter.localhost:4100/auth/grant-user-group", {
  "headers": {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${puter.authToken}`,
  },
  "body": JSON.stringify({
      group_uid: '9c644a1c-3e43-4df4-ab67-de5b68b235b6',
      permission: 'fs:/someuser/somedir/somefile:read'
  }),
  "method": "POST",
});
```

## POST `/revoke-user-group`

Revoke permission granted from the current user
to a group.

### Parameters

- **group_uid:** _- required_
  - **accepts:** `string`
    UUID of an existing group
- **permission:** _- required_
  - **accepts:** `string`
    A permission string

### Request Example

```javascript
await fetch("http://puter.localhost:4100/auth/grant-user-group", {
  "headers": {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${puter.authToken}`,
  },
  "body": JSON.stringify({
      group_uid: '9c644a1c-3e43-4df4-ab67-de5b68b235b6',
      permission: 'fs:/someuser/somedir/somefile:read'
  }),
  "method": "POST",
});
```

- > **TODO** figure out how to manage documentation that could
    reasonably show up in two files. For example: this is a group
    endpoint as well as a permission system endpoint.
    (architecturally it's a permission system endpoint, and
    the permissions feature depends on the groups feature;
    at least until a time when PermissionService is refactored
    so a service like GroupService can mutate the permission
    check sequences)
