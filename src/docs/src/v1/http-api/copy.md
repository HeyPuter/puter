# `/copy`

This API endpoint is used to copy files and directories from a source path to a destination path. It accepts a JSON payload with the required `source_path` and `dest_path` parameters.


### Endpoint

`POST https://api.puter.com/copy`

## Request

Headers
- Method: `POST`
- `Content-Type`: `application/json`
- `Authorization`: `Bearer <access_token>`

Body
```javascript
{
  "source_path": "/path/to/source",
  "dest_path": "/path/to/destination",
  "overwrite": true/false (optional),
  "change_name": true/false (optional),
}
```

## Notes
- The `source_path` and `dest_path` parameters should be strings representing valid paths within the user's file system.
- The `Authorization` header must contain a valid access token to authenticate the user.
- The `overwrite` parameter is optional and can be used to control if existing files at the destination path should be overwritten (default is `false`).
- The `change_name` parameter is optional and can be used to control if the copied file or directory should have its name changed to avoid name collision (default is `false`). If `true`, the copied file or directory will have a number appended to its name, e.g. `filename (1).ext`.


## Example

The following example shows how to copy a file from `/path/to/source` to `/path/to/destination` using the HTTP API. The `change_name` parameter is set to `true` to avoid name collision, it will result in the copied file having a number appended to its name, e.g. `filename (1).ext`.

```bash
curl -X POST https://api.puter.com/copy \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <access_token>' \
  -d '{
    "source_path": "/path/to/source",
    "dest_path": "/path/to/destination",
    "change_name": true
  }'
```

Don't forget to replace `<access_token>` with your actual access token.
