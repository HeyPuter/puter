## Puter Drivers

### **POST** `/drivers/call`

#### Notes

- **HTTP response status** -
  A successful driver response, even if the response is an error message, will always have HTTP status `200`. Note that sometimes this will include rate limit and usage limit errors as well.

This endpoint allows you to call a Puter driver. Whether or not the
driver call fails, this endpoint will respond with HTTP 200 OK.
When a driver call fails, you will get a JSON response from the driver
with 

#### Parameters

Parameters are provided in the request body. The content type of the
request should be `application/json`.

- **interface:** `string`
  - **description:** The type of driver to call. For example,
    LLMs use the interface called `puter-chat-completion`.
- **service:** `string`
  - **description:** The name of the service to use. For example, the `claude` service might be used for `puter-chat-completion`.
- **method:** `string`
  - **description:** The name of the method to call. For example, LLMs implement `complete` which does a chat completion, and `list` which lists models.
- **args:** `object`
  - **description:** Parametized arguments for the driver call. For example, `puter-chat-completion`'s `complete` method supports the arguments `messages` and `temperature` (and others), so you might set this to `{ "messages": [...], "temperature": 1.2 }`

#### Example
```json
{
    "interface": "<name of interface>",
    "service": "<name of service>",
    "method": "<name of method>",
    "args": { "parametized": "arguments" }
}
```

#### Response

- **Error Response** - Driver error responses will always have **status 200**, content type `application/json`, and a response body in this format:
  ```json
  {
    "success": false,
    "error": {
        "code": "string identifier for the error",
        "message": "some message about the error",
    }
  }
  ```
- **Success Response** - The success response is either a JSON response
  wrapped in `{ "success": true, "result": ___ }`, or a response with a
  `Content-Type` that is **not** `application/json`.
  ```json
  {
    "success": true,
    "result": {}
  }
  ```