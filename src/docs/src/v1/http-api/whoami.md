# `/whoami`

This API endpoint is used to retrieve the details of the authenticated user.

### Endpoint

`GET https://api.puter.com/whoami`

## Request

Headers
- Method: `GET`
- `Content-Type`: `application/json`
- `Authorization`: `Bearer <access_token>`


## Example

```bash
curl -X GET https://api.puter.com/whoami \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <access_token>'
```

Don't forget to replace `<access_token>` with your actual access token.