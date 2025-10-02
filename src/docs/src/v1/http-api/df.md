# `/df`

This API endpoint is used to retrieve storage space usage and capacity information for the authenticated user.

### Endpoint

`GET https://api.puter.com/df`

## Request

Headers
- Method: `GET`
- `Content-Type`: `application/json`
- `Authorization`: `Bearer <access_token>`

## Response
Success
- Status code: `200 OK`
- Content-Type: `application/json`

Response body:
```javascript
{
  "used": 10240,
  "capacity": 1048576
}
```

## Example

The following example shows how to retrieve storage space usage and capacity information for the authenticated user using the HTTP API.

```bash
curl -X GET https://api.puter.com/df \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <access_token>'
```

Don't forget to replace `<access_token>` with your actual access token.