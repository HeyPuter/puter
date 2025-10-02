# `/rename`

This API endpoint is used to rename a file or folder for the authenticated user.

### Endpoint

`POST https://api.puter.com/rename`

## Request

Headers
- Method: `POST`
- `Content-Type`: `application/json`
- `Authorization`: `Bearer <access_token>`

Body
```javascript
{
  "uid": "file/folder-uid",
  "new_name": "new-name"
}
```

## Response
Success
- Status code: `200 OK`
- Content-Type: `application/json`

Response body:
```javascript
{
  "uid": "file-uuid",
  "name": "new-file-name",
  "is_dir": false,
  "path": "/path/to/new-file-name",
  "old_path": "/path/to/old-file-name",
  "type": "application/pdf",
  "associated_app": {},
}
```

- The `Authorization` header must contain a valid access token to authenticate the user.
- The `uid` field in the request body must be a valid UUID (string) representing the unique identifier of the file or folder to be renamed.
- The `new_name` field in the request body must be a valid file or folder name (string) that does not contain any forbidden characters.
- The response object contains information about the renamed file or folder, including the new name, path, old path, type, associated app, and original client socket ID.


## Example

```bash
curl -X POST https://api.puter.com/rename \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <access_token>' \
  -d '{
    "uid": "file/folder-uid",
    "new_name": "new-name"
  }'
```

Don't forget to replace `<access_token>` with your actual access token.