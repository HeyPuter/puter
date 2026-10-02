---
title: Connect to a Server
description: "Learn how to send and receive data over TCP and TLS sockets with Puter.js, including text, bytes and connection errors."
tags: [net]
order: 66
---

To talk to a server over a TCP connection, use the
[`puter.net.Socket()`](/Networking/Socket/) constructor. For an encrypted
connection, use [`puter.net.tls.TLSSocket()`](/Networking/TLSSocket/).
Both take a hostname and a port, then send and receive data through events.

For most HTTP requests, [use `puter.net.fetch()`](/recipes/make-http-requests/).
A socket is useful when you need to send the protocol's bytes yourself.

## Send an HTTP Request

To connect to an HTTP server, pass its hostname and port `80`. Wait for the
`open` event, then send the request with `write()`:

```js
const socket = new puter.net.Socket('example.com', 80);
const decoder = new TextDecoder();

socket.on('open', () => {
    socket.write('GET / HTTP/1.1\r\nHost: example.com\r\nConnection: close\r\n\r\n');
});

socket.on('data', (data) => {
    console.log(decoder.decode(data, { stream: true }));
});

socket.on('error', (error) => {
    console.error('Connection failed:', error.message);
});

socket.on('close', () => {
    const remaining = decoder.decode();
    if (remaining) console.log(remaining);
});
```

The server sends bytes in `data` events. This prints the HTTP response,
including its headers. `Connection: close` asks the server to close the
connection after sending it. Each `\r\n` ends a line, and the empty line ends
the request headers.

## Use TLS

To make the same request over an encrypted connection, use
[`puter.net.tls.TLSSocket()`](/Networking/TLSSocket/) and port `443`.
Its connection events are `tlsopen`, `tlsdata` and `tlsclose`; errors still
use `error`:

```js
const socket = new puter.net.tls.TLSSocket('example.com', 443);
const decoder = new TextDecoder();

socket.on('tlsopen', () => {
    socket.write('GET / HTTP/1.1\r\nHost: example.com\r\nConnection: close\r\n\r\n');
});

socket.on('tlsdata', (data) => {
    console.log(decoder.decode(data, { stream: true }));
});

socket.on('error', (error) => {
    console.error('Connection failed:', error.message);
});

socket.on('tlsclose', () => {
    const remaining = decoder.decode();
    if (remaining) console.log(remaining);
});
```

Use a TLS socket only on a port where the server accepts TLS connections.
Changing the port on a plain socket does not enable encryption.

## Send Bytes

The `write()` method also accepts a `Uint8Array` or an `ArrayBuffer`.
Use `TextEncoder` to turn text into UTF-8 bytes. This example asks the
[IANA WHOIS server](https://www.iana.org/whois) for information about `.com`:

```js
const socket = new puter.net.Socket('whois.iana.org', 43);
const encoder = new TextEncoder();
const decoder = new TextDecoder();
let reply = '';

socket.on('open', () => {
    socket.write(encoder.encode('com\r\n'));
});

socket.on('data', (data) => {
    reply += decoder.decode(data, { stream: true });
});

socket.on('error', (error) => {
    console.error('WHOIS request failed:', error.message);
});

socket.on('close', (hadError) => {
    reply += decoder.decode();
    if (!hadError) console.log(reply);
});
```

[WHOIS](https://www.rfc-editor.org/rfc/rfc3912) uses port `43`, takes a query
ending in `\r\n`, and closes the connection when the reply is complete.
The example collects all the chunks before printing it.

## Handle Errors and Close

A socket connects after you create it. Listen for `error` to handle a failed
connection, and for `close` to know when it ends. The `hadError` argument is
`true` when the connection closes because of an error:

```js
const socket = new puter.net.Socket('does-not-exist.invalid', 80);

socket.on('error', (error) => {
    console.error('Connection failed:', error.message);
});

socket.on('close', (hadError) => {
    console.log('Connection closed. Had an error:', hadError);
});
```

To close a connection yourself, call `close()` on the socket you opened:

```js
socket.close();
```

## Notes

- These examples assume Puter.js is loaded. Run each connection example on
  its own.
- A `data` event can contain part of a message or several messages. Use the
  protocol's rules to decide when a reply is complete.
- `TextDecoder` keeps incomplete characters between chunks when you pass
  `{ stream: true }`. Call `decode()` once more when the connection ends to
  flush the remaining text.
- For binary protocols, work with the received `Uint8Array` directly. Only
  decode bytes that the protocol defines as text.
