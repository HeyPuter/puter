---
title: PuterPeerServer
description: The PuterPeerServer object returned by puter.peer.serve(), representing a peer server and its connected clients.
---

The `PuterPeerServer` object returned by [`puter.peer.serve()`](/Peer/serve/). It holds the invite code other clients use to reach you, and tracks every client that connects.

`PuterPeerServer` extends [`EventTarget`](https://developer.mozilla.org/en-US/docs/Web/API/EventTarget), so events are subscribed to with `addEventListener()`.

## Attributes

#### `inviteCode` (String)

The code to share with other clients so they can connect with [`puter.peer.connect()`](/Peer/connect/).

#### `connections` (Map)

A `Map` of every connected client, keyed by connection id. The values are [`PuterPeerConnection`](/Objects/puterpeerconnection/) objects.

## Methods

#### `close()`

Closes every client connection and the signalling connection. The invite code stops working.

## Events

#### `connection`

Fired when a client connects. The event has the following attributes:

- `conn` ([`PuterPeerConnection`](/Objects/puterpeerconnection/)) - The connection to the client.
- `user` (Object) - Metadata about the connecting user, with `username` and `uuid` (if available).

## Example

```js
const server = await puter.peer.serve();
puter.print(`Invite code: ${server.inviteCode}`);

server.addEventListener('connection', (event) => {
    const conn = event.conn;
    conn.addEventListener('open', () => {
        conn.send('Hello from the server!');
    });
    conn.addEventListener('message', (msg) => {
        puter.print('Client says:', msg.data);
    });
});
```
