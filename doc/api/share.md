# Share Endpoints

Share endpoints allow sharing files with other users.

## POST `/share` (auth required)

### Description

The `/share` endpoint shares 1 or more filesystem items
with one or more recipients. The recipients will receive
some notification about the shared item, making this
different from calling `/grant-user-user` with a permission.

### Parameters

- **recipients** _- required_
  - **accepts:** `string | Array<string>`
  - **description:**
    recipients for the filesystem entries being shared.
  - **notes:**
    - validation on `string`: email or username
    - requirement of at least one value
- **paths:** _- required_
  - **accepts:** `string | object | Array<string | object>`
  - **description:**
    paths of filesystem entries (files or directories)
    to share with the specified recipients
  - **notes:**
    - requirement that file/directory exists
    - requirement of at least one value
  - **structure:** for `object` values:
    - **path:** _- required_
      - **accepts:** `string`
      - **description:**
        a Puter file path
    - **access:** _- required_
      - **description:** one of: `"read"`, `"write"`
  - **examples:**
    - ```json
      { "path": "/some/path", "access": "read" }
      ```
    - ```json
      { "path": "/some/path" }
      ```
- **dry_run:** _- optional_
  - **accepts:** `bool`
  - **description:**
    when true, only validation will occur
    
### Response

- **$:** `api:share`
- **$version:** `v0.0.0`
- **status:** one of: `"success"`, `"mixed"`, `"aborted"`
- **recipients:** array of: `api:status-report` or
  `heyputer:api/APIError`
- **paths:** array of: `api:status-report` or
  `heyputer:api/APIError`
- **dry_run:** `true` if present

### Request Example

```javascript
await fetch("http://puter.localhost:4100/share", {
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${puter.authToken}`,
  },
  body: JSON.stringify({
      // dry_run: true,
      recipients: [
          'user_that_gets_shared_to',
      ],
      paths: [
          '/user_that_shares/file_that_gets_shared.txt',
      ],
  }),
  method: "POST",
});
```

### Success Response

```json
{
    "$": "api:share",
    "$version": "v0.0.0",
    "status": "success",
    "recipients": [
        {
            "$": "api:status-report",
            "status": "success"
        }
    ],
    "paths": [
        {
            "$": "api:status-report",
            "status": "success"
        }
    ],
    "dry_run": true
}
```

### Error response (missing file)

```json
{
    "$": "api:share",
    "$version": "v0.0.0",
    "status": "mixed",
    "recipients": [
        {
            "$": "api:status-report",
            "status": "success"
        }
    ],
    "paths": [
        {
            "$": "heyputer:api/APIError",
            "code": "subject_does_not_exist",
            "message": "File or directory not found.",
            "status": 404
        }
    ],
    "dry_run": true
}
```

### Error response (missing user)

```json
{
    "$": "api:share",
    "$version": "v0.0.0",
    "status": "mixed",
    "recipients": [
        {
            "$": "heyputer:api/APIError",
            "code": "user_does_not_exist",
            "message": "The user `non_existing_user` does not exist.",
            "username": "non_existing_user",
            "status": 422
        }
    ],
    "paths": [
        {
            "$": "api:status-report",
            "status": "success"
        }
    ],
    "dry_run": true
}
```

## **deprecated** POST `/share/item-by-username` (auth required)

### Description

The `/share/item-by-username` endpoint grants access permission
for an item to the specified user. This user will also receive an
email about the shared item.

### Parameters

| Name | Description | Default Value |
| ---- | ----------- | -------- |
| path | Location of the item | **required** |
| username | Username of the user to share to | **required** |
| access_level | Either `'read'` or `'write'` | `'write'` |

### Response

This endpoint responds with an empty object (`{}`).

### Request Example

```javascript
await fetch("https://api.puter.local/share/item-by-username", {
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${puter.authToken}`,
  },
  body: JSON.stringify({
    path: "/my-username/Desktop/some-file.txt",
    username: "other-username",
  }),
  method: "POST",
});
```
