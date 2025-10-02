# `/stat`

This API endpoint is used to retrieve information about a file or directory based on the given path or UUID.

### Endpoint

`POST https://api.puter.com/stat`

## Request

Headers
- Method: `GET`
- `Content-Type`: `application/json`
- `Authorization`: `Bearer <access_token>`

Body
```javascript
{
  "path": "/path/to/item",
  "uid": "item-uuid",
  "return_subdomains": true|false,
  "return_permissions": true|false,
  "return_versions": true|false,
  "return_size": true|false
}
```

## Example

```bash
curl -X GET "https://api.puter.com/stat?path=/path/to/item&uid=item-uuid&return_subdomains=true_or_false&return_permissions=true_or_false&return_versions=true_or_false&return_size=true_or_false" \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <access_token>'
```

Don't forget to replace `<access_token>` with your actual access token, and `/path/to/item` and `item-uuid` with the appropriate path and UUID for the file or directory you want to retrieve information about.