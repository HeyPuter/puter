# `/move`

This API endpoint is used to move files and directories from a source path or UID to a destination path or UID. It accepts a JSON payload with the required `source_path` or `source_uid`, and `dest_path` or `dest_uid` parameters.

### Endpoint

`POST https://api.puter.com/move`

## Request

Headers
- Method: `POST`
- `Content-Type`: `application/json`
- `Authorization`: `Bearer <access_token>`

Body
```javascript
{
  "source_path": "/path/to/source" (optional),
  "source_uid": "source_unique_identifier" (optional),
  "dest_path": "/path/to/destination" (optional),
  "dest_uid": "destination_unique_identifier" (optional),
  "overwrite": true/false (optional),
  "new_name": "new_item_name" (optional),
  "new_metadata": {...} (optional),
  "original_client_socket_id": "socket_id" (optional),
  "create_missing_parents": true/false (optional)
}
```


- The `source_path` or `source_uid`, and `dest_path` or `dest_uid` parameters are required. You must provide either a path or a UID for both source and destination.
- The `Authorization` header must contain a valid access token to authenticate the user.
- The `overwrite` parameter is optional and can be used to control if existing files at the destination path should be overwritten (default is `false`).
- The `new_name` parameter is optional and can be used to change the name of the moved file or directory.
- The `new_metadata` parameter is optional and can be used to set new metadata for the moved file or directory.
- The `create_missing_parents` parameter is optional and can be used to create any missing parent directories at the destination path (default is `false`).

## Example

The following example moves a file from `/path/to/source` to `/path/to/destination` and renames it to `new_item_name`.

```bash
curl -X POST https://api.puter.com/move \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <access_token>' \
  -d '{
    "source_path": "/path/to/source",
    "dest_path": "/path/to/destination",
    "overwrite": true_or_false,
    "new_name": "new_item_name",
    "create_missing_parents": true_or_false
  }'
```

Don't forget to replace `<access_token>` with your actual access token, 