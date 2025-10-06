The TLS Socket API lets you create a TLS protected TCP socket connection which can be used directly in the browser. The interface is exactly the same as the normal <a href="/Networking/Socket/">`puter.net.Socket`</a> but connections are encrypted instead of being in plain text.

## Syntax

```js
const socket = new puter.net.tls.TLSSocket(hostname, port)
```

## Parameters

#### `hostname` (String) (Required)
The hostname of the server to connect to. This can be an IP address or a domain name.

#### `port` (Number) (Required)
The port number to connect to on the server.


## Return value

A `TLSSocket` object.

## Methods


#### `socket.on(event, callback)`

Listen to an event from the socket. Possible events are:

- `open` - The socket is open.
- `data` - Data is received from the socket.
- `error` - An error occurs on the socket.
- `close` - The socket is closed.


#### `socket.write(data)`

Write data to the socket.

### Parameters

- `data` (String) The data to write to the socket.


## Events

#### `socket.on("open", callback)`

Fired when the socket is open.


#### `socket.on("data", callback)`

Fired when data is received from the socket.


#### `socket.on("error", callback)`

Fired when an error occurs on the socket.



#### `socket.on("close", callback)`

Fired when the socket is closed.


The encryption is done by [rustls-wasm](https://github.com/MercuryWorkshop/rustls-wasm/).

## Examples

<strong class="example-title">Connect to a server with TLS and print the response</strong>

```html;net-tls
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
    const socket = new puter.net.tls.TLSSocket("example.com", 443);
    socket.on("open", () => {
        socket.write("GET / HTTP/1.1\r\nHost: example.com\r\n\r\n");
    })
    const decoder = new TextDecoder();
    socket.on("data", (data) => {
        puter.print(decoder.decode(data), { code: true });
    })
    socket.on("error", (reason) => {
        puter.print("Socket errored with the following reason: ", reason);
    })
    socket.on("close", (hadError)=> {
        puter.print("Socket closed. Was there an error? ", hadError);
    })
    </script>
</body>
</html>
```