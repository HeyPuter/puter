# `/readdir`

This API endpoint is used to list the contents of a given directory. It accepts a JSON payload with the required `path` parameter.

### Endpoint

`POST https://api.puter.com/readdir`

## Request

Headers
- Method: `POST`
- `Content-Type`: `application/json`
- `Authorization`: `Bearer <access_token>`

Body
```javascript
{
  "path": "/path/to/directory/or/file",
  "options": {
    "recursive": true|false,
  }
}
```

## Response
Success
- Status code: `200 OK`
- Content-Type: `application/json`

Response body:
```javascript
[
  {
    "id": "unique_identifier",
    "uid": "unique_identifier",
    "is_shortcut": false,
    "shortcut_to": null,
    "shortcut_to_path": null,
    "parent_id": "parent_unique_identifier",
    "name": "filename.ext",
    "sort_by": null,
    "layout": null,
    "is_dir": false,
    "modified": 1673567944,
    "created": 1673563092,
    "accessed": 1673569999,
    "immutable": false,
    "size": 1024,
    "thumbnail": null,
    "type": "mime/type",
    "is_shared": false,
    "suggested_apps": [],
    "associated_app": {}
  },
  ...
]
```

## Example

The following example shows how to list the contents of a the directory `/path/to/directory`:

```bash
curl -X POST https://api.puter.com/readdir \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <access_token>' \
  -d '{"path": "/path/to/directory"}'
```

Don't forget to replace `<access_token>` with your actual access token.