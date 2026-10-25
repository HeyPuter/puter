---
title: Make HTTP Requests
description: Learn how to make HTTP requests from the browser with Puter.js, so your app can call any API or website, even ones that block cross-origin requests.
tags: [net]
order: 65
---

The browser's `fetch()` blocks a response when the server doesn't allow
cross-origin requests, so many APIs and websites can't be called from your
app's page. The [`puter.net.fetch()`](/Networking/fetch/) method makes the
same HTTP and HTTPS requests without that restriction. It takes the same
arguments as `fetch()` and returns a `Response`.

The first request opens the Puter sign-in window if the user isn't signed in
yet.

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
The other request options are listed on
[`puter.net.fetch()`](/Networking/fetch/).

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

The `ok` property is `true` for status codes from `200` to `299`. The same
catch also handles a response that can't be read as JSON.

To try the HTTP error path, replace the URL with
`https://httpbin.org/status/404`. To try a host that does not exist, use
`https://does-not-exist.invalid/`.

## Notes

- For an API that needs a secret key, call it from a worker so the key stays
  out of your app's page. See [keep an API key
  secret](/recipes/keep-api-key-secret/).
