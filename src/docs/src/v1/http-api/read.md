# `/read`

This API endpoint is used to read a file at the specified path.


### Endpoint

`GET https://api.puter.com/read`

## Request

Headers
- Method: `GET`
- `Content-Type`: `application/json`
- `Authorization`: `Bearer <access_token>`

Query Parameters
- `path`: The path of the file to be read.
- `uid`: The UID of the file to be read.
- `line_count`: The number of lines to read from the file (optional).
- `byte_count`: The number of bytes to read from the file (optional).


## Notes
- The `Authorization` header must contain a valid access token to authenticate the user.
- Either `path` or `uid` query parameter must be passed to specify the file to be read.
- The `line_count` query parameter is optional and can be used to read a specified number of lines from the file. It must be a positive integer if provided.
- The `byte_count` query parameter is optional and can be used to read a specified number of bytes from the file. It must be an integer if provided.

In case of success, the response will contain the requested file content. The response will be partial if `line_count` or `byte_count` is provided, containing only the specified number of lines or bytes. If both `line_count` and `byte_count` are provided, only the `line_count` will be considered.

If the file does not exist, a `404 Not Found` status code will be returned with a path not found message. If the user does not have permission to read the file, a `403 Forbidden status` code will be returned with a permission denied message. If the specified path is a directory, a `400 Bad Request status` code will be returned with a `Cannot read a directory` message. If there are any internal problems reading the file, a `500 Internal Server Error` status code will be returned with a `There was an internal problem reading the file` message.


## Example

The following example will read the first 10 lines of the file at `/path/to/file`:

```bash
curl -X GET "https://api.puter.com/read?path=/path/to/file&line_count=10" \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <access_token>'
```

Don't forget to replace `<access_token>` with your actual access token.