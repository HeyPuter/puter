---
title: Make HTTP Requests
description: "Learn how to fetch JSON, send data, read a response in chunks and handle failed requests with Puter.js."
tags: [net]
order: 65
---

To read data from another server, use the
[`puter.net.fetch()`](/Networking/fetch/) method. It lets your app make HTTP
and HTTPS requests even when the server does not allow cross-origin requests
through the browser's `fetch()`.

## Fetch a JSON API

To fetch JSON, pass the API's URL, then read the response with `json()`:

```js
const response = await puter.net.fetch('https://httpbin.org/get');
const data = await response.json();

console.log(data);
```

The method returns a `Response` object. For a page or a plain text file, use
`response.text()` instead.

## Send JSON

To send JSON, pass `method`, `headers` and `body` in the second argument.
Use `JSON.stringify()` to turn the object into a string and set `Content-Type`
so the server knows how to read it. Custom headers go in the same object:

```js
const response = await puter.net.fetch('https://httpbin.org/post', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Custom-Header': 'custom-value',
    },
    body: JSON.stringify({ message: 'Hello' }),
});

const data = await response.json();

console.log(data);
```

This example uses httpbin, which sends back the JSON and headers it received.

## Read a Response in Chunks

To process a large response as it arrives, read from `response.body` instead
of waiting for `text()` or `json()` to collect the whole body:

```js
const response = await puter.net.fetch('https://httpbin.org/stream-bytes/102400');
const reader = response.body.getReader();

try {
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        console.log(value);
    }
} finally {
    reader.releaseLock();
}
```

Each `value` is a `Uint8Array` of bytes. Chunk sizes can vary. Some responses,
such as those to a `HEAD` request, have no body, so `response.body` is `null`.

## Handle a Failed Request

A request can fail before you get a response, for example when the host cannot
be reached. Catch the error with `try`/`catch`. HTTP errors such as `404` or
`500` still return a response, so check `response.ok` before reading the body:

```js
try {
    const response = await puter.net.fetch('https://httpbin.org/get');
    if (!response.ok) {
        throw new Error(`Request failed (HTTP ${response.status}).`);
    }

    const data = await response.json();
    console.log(data);
} catch (error) {
    console.error('Could not load the data:', error?.message ?? error);
}
```

`response.ok` is `true` for status codes from `200` to `299`. The same catch
also handles a response that cannot be read as JSON.

To try the HTTP error path, replace the URL with
`https://httpbin.org/status/404`. To try a host that does not exist, use
`https://does-not-exist.invalid/`.

## Notes

- These examples assume Puter.js is loaded and run inside an async function
  or a JavaScript module, where `await` is allowed.
- Read each response body once. After `json()`, `text()` or a stream reader
  consumes it, it cannot be read again.
- Access to an API can still require that API's own credentials. CORS-free
  requests do not replace its authentication.
