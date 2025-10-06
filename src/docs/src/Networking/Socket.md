The Socket API lets you create a raw TCP socket which can be used directly in the browser.

## Syntax

```js
const socket = new puter.net.Socket(hostname, port)
```

## Parameters
#### `hostname` (String) (Required)
The hostname of the server to connect to. This can be an IP address or a domain name.

#### `port` (Number) (Required)
The port number to connect to on the server.


## Return value

A `Socket` object.

## Methods

#### `socket.write(data)`

Write data to the socket.

### Parameters

- `data` (`ArrayBuffer | Uint8Array | string`) The data to write to the socket.

#### `socket.close()`

Voluntarily close a TCP Socket.


## Events

#### `socket.on("open", callback)`

Fired when the socket is initialized and ready to send data.

##### Parameters

- `callback` (Function) The callback to fire when the socket is open.

#### `socket.on("data", callback)`

Fired when the remote server sends data over the created TCP Socket.

##### Parameters

- `callback` (Function) The callback to fire when data is received.
  - `buffer` (`Uint8Array`) The data received from the socket.

#### `socket.on("error", callback)`

Fired when the socket encounters an error. The close event is fired shortly after.

##### Parameters

- `callback` (Function) The callback to fire when an error occurs.
  - `reason` (`string`) A user readable error reason.

#### `socket.on("close", callback)`

Fired when the socket is closed.

##### Parameters

- `callback` (Function) The callback to fire when the socket is closed.
  - `hadError` (`boolean`) Indicates whether the socket was closed due to an error. If true, there was an error.

## Examples

<strong class="example-title">Connect to a server and print the response</strong>

```html;net-basic
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
    const socket = new puter.net.Socket("example.com", 80);
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