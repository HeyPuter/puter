---
title: PuterPeerConnection
description: The PuterPeerConnection object representing a WebRTC data-channel connection to a peer.
---

The `PuterPeerConnection` object representing a WebRTC data-channel connection to a peer. [`puter.peer.connect()`](/Peer/connect/) resolves to one, and a [`PuterPeerServer`](/Objects/puterpeerserver/) hands one to its `connection` event for every client that joins.

`PuterPeerConnection` extends [`EventTarget`](https://developer.mozilla.org/en-US/docs/Web/API/EventTarget), so events are subscribed to with `addEventListener()`.

## Attributes

#### `owner` (Object)

Information about the user who created the server, with `username` and `uuid`.

#### `connected` (Boolean)

Whether the data channel is currently open.

#### `closed` (Boolean)

Whether the connection has been closed.

#### `peerconnection` (RTCPeerConnection)

The raw underlying [`RTCPeerConnection`](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection) handle, for cases the Puter API does not cover.

## Methods

#### `send(data)`

Sends a message to the peer. `data` may be a `String`, `Blob`, `ArrayBuffer`, or `ArrayBufferView`.

#### `close(reason)`

Closes the connection. The optional `reason` string is delivered to the peer on its `close` event.

## Events

#### `open`

Fired when the data channel is ready. Wait for this before calling `send()`.

#### `message`

Fired when a message is received. `event.data` holds the payload.

#### `close`

Fired when the connection closes. `event.reason` holds the reason, if one was given.

#### `error`

Fired when a connection error occurs. `event.error` holds the error.

## Example

```js
const conn = await puter.peer.connect(inviteCode);

conn.addEventListener('open', () => {
    conn.send('Hello from the client!');
});
conn.addEventListener('message', (msg) => {
    puter.print('Server says:', msg.data);
});
conn.addEventListener('close', (event) => {
    puter.print('Connection closed:', event.reason);
});
```
