# `/mkdir`

This API endpoint is used to create a new directory at the specified path.

### Endpoint

`POST https://api.puter.com/mkdir`

## Request

Headers
- Method: `POST`
- `Content-Type`: `application/json`
- `Authorization`: `Bearer <access_token>`

Body
```javascript
{
  "path": "/path/to/new_directory",
  "overwrite": true,
  "immutable": false,
  "dedupe_name": true,
  "shortcut_to": "/path/to/shortcut"
}
```

## Example

The following example shows how to create a new directory at `/path/to/new_directory` using the HTTP API. The `immutable` parameter is set to `false` to allow the directory to be modified. The `dedupe_name` parameter is set to `true` to avoid name collision, it will result in the new directory having a number appended to its name, e.g. `new_directory (1)`.

```bash
curl -X POST https://api.puter.com/mkdir \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <access_token>' \
  -d '{
    "path": "/path/to/new_directory",
    "immutable": false,
    "dedupe_name": true
  }'
```

Don't forget to replace `<access_token>` with your actual access token.