---
title: TLS Socket
description: Create a TLS protected TCP socket connection directly in the browser.
platforms: [websites, apps]
---

The TLS Socket API lets you create a TLS protected TCP socket connection which can be used directly in the browser. The interface is exactly the same as the normal <a href="/Networking/Socket/">`puter.net.Socket`</a> but connections are encrypted instead of being in plain text.

## Syntax

```js
const socket = new puter.net.tls.TLSSocket(hostname, port);
```

## Parameters

#### `hostname` (String) (Required)

The hostname of the server to connect to. This can be an IP address or a domain name.

#### `port` (Number) (Required)

The port number to connect to on the server.

## Return value

A `TLSSocket` object.

## Methods

#### `socket.write(data)`

Write data to the socket.

##### Parameters

- `data` (`ArrayBuffer | Uint8Array | string`) The data to write to the socket.

#### `socket.close()`

Voluntarily close a TCP Socket.

#### `socket.addListener(event, handler)`

An alternative way to listen to socket events.

##### Parameters

- `event` (`SocketEvent`) The event name to listen for. One of: `"tlsopen"`, `"tlsdata"`, `"tlsclose"`, `"error"`.
- `handler` (`Function`) The callback function to invoke when the event occurs. The callback parameters depend on the event type (see [Events](#events)).

## Events

#### `socket.on("tlsopen", callback)`

Fired when the socket is initialized and ready to send data.

##### Parameters

- `callback` (Function) The callback to fire when the socket is open.

#### `socket.on("tlsdata", callback)`

Fired when the remote server sends data over the created TCP Socket.

##### Parameters

- `callback` (Function) The callback to fire when data is received.
  - `buffer` (`Uint8Array`) The data received from the socket.

#### `socket.on("tlsclose", callback)`

Fired when the socket is closed.

##### Parameters

- `callback` (Function) The callback to fire when the socket is closed.
  - `hadError` (`boolean`) Indicates whether the socket was closed due to an error. If true, there was an error.

#### `socket.on("error", callback)`

Fired when the socket encounters an error. The close event is fired shortly after.

##### Parameters

- `callback` (Function) The callback to fire when an error occurs.
  - `reason` (`string`) A user readable error reason.

The encryption is done by [rustls-wasm](https://github.com/MercuryWorkshop/rustls-wasm/).

## Examples

<strong class="example-title">Connect to a server with TLS and print the response</strong>

```html;net-tls
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
    const socket = new puter.net.tls.TLSSocket("example.com", 443);
    socket.on("tlsopen", () => {
        socket.write("GET / HTTP/1.1\r\nHost: example.com\r\n\r\n");
    })
    const decoder = new TextDecoder();
    socket.on("tlsdata", (data) => {
        puter.print(decoder.decode(data), { code: true });
    })
    socket.on("error", (reason) => {
        puter.print("Socket errored with the following reason: ", reason);
    })
    socket.on("tlsclose", (hadError)=> {
        puter.print("Socket closed. Was there an error? ", hadError);
    })
    </script>
</body>
</html>
```
