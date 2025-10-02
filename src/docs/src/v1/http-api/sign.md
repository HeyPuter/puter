# `/sign`

This API endpoint is used to sign one or more files for performing file-related actions for the authenticated user.


### Endpoint

`POST https://api.puter.com/sign`

## Request

Headers
- Method: `POST`
- `Content-Type`: `application/json`
- `Authorization`: `Bearer <access_token>`

Body
```javascript
{
  "items": [
    {
      "uid": "file-uuid-1",
      "action": "read"
    },
    {
      "path": "/path/to/file-2",
      "action": "write"
    }
  ]
}
```

- The `Authorization` header must contain a valid access token to authenticate the user.
- The `items` field in the request body must be an array of objects, where each object contains either a `uid` or a `path` and an `action`. The `uid` represents the unique identifier of the file, and the `path` represents the file path. The `action` field can have values like "read" or "write" depending on the desired action.
- The response object contains an array of `signatures`, where each signature object contains a url and a path and other information.


## Example

```bash
curl -X POST https://api.puter.com/sign \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <access_token>' \
  -d '{
    "items": [
      {
        "uid": "file-uuid-1",
        "action": "read"
      },
      {
        "path": "/path/to/file-2",
        "action": "write"
      }
    ]
  }'
```

Don't forget to replace `<access_token>` with your actual access token.