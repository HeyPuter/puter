# `/delete`

This API endpoint is used to delete specified files or directories.


### Endpoint

`POST https://api.puter.com/delete`

## Request

Headers
- Method: `POST`
- `Content-Type`: `application/json`
- `Authorization`: `Bearer <access_token>`

Body
- `paths`: An array of paths to the files or directories to be deleted.
- `force`: A boolean flag to force delete if the path does not exist (optional, default: false).
- `descendants_only`: A boolean flag to delete only descendants of the specified directory, keeping the directory itself (optional, default: false).


## Notes
- The `Authorization` header must contain a valid access token to authenticate the user.
- The `paths` parameter is required and must be an array of paths to be deleted. If the array is empty, a `400 Bad Request` status code will be returned with a `paths cannot be empty message`.
If a specified path does not exist and the `force` flag is not set, a `400 Bad Request` status code will be returned with an error message.
- If the `descendants_only` flag is set, only the descendants of the specified directory will be deleted, keeping the directory itself.
Upon successful deletion, the server will respond with a `200 OK` status code and an empty response body. In case of an error during the deletion process, a `400 Bad Request` status code will be returned with an error message.


## Example

```bash
curl -X POST https://api.puter.com/delete \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <access_token>' \
  -d '{
    "paths": ["/path/to/file1", "/path/to/file2"],
    "force": true_or_false,
    "descendants_only": true_or_false
  }'
```

Don't forget to replace `<access_token>` with your actual access token.