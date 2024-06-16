# Share Endpoints

Share endpoints allow sharing files with other users.


## POST `/share/item-by-username` (auth required)

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
