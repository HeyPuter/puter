Lists all workers in your account with their details.

## Syntax

```js
puter.workers.list()
```

## Parameters

None.

## Return Value

A `Promise` that resolves to a JavaScript array with each worker's information
### Example Output Structure

```js
[
  {
    "name": "my-api"
    "url": "https://my-api.puter.work",
    "file_path": "/username/Desktop/api-server.js",
    "file_uid": "a0d9380f-d981-4c97-96ef-d7e2e39d2a97",
    "created_at": "2025-08-02T23:37:16.285Z"
  },
  {
    "name": "blog-backend",
    "url": "https://blog-backend.puter.work", 
    "file_path": "/username/Desktop/blog.js",
    "file_uid": "de15baba-b685-408d-a7b9-e080fe10e455"
    "created_at": "2023-01-02T00:00:00.000Z"
  },
  {
    "name": "test-worker",
    "url": "https://test-worker.puter.work",
    "file_path": "/username/Desktop/test.js",
    "file_uid": "c07add62-d79b-46f2-8be0-e7a3992b9297"
    "created_at": "2023-01-03T00:00:00.000Z"
  }
]
```