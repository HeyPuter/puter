---
title: PuterPeerServer
description: The PuterPeerServer object returned by puter.peer.serve(), representing a peer server and its connected clients.
---

The `PuterPeerServer` object returned by [`puter.peer.serve()`](/Peer/serve/). It holds the invite code other clients use to reach you, and tracks every client that connects.

`PuterPeerServer` extends [`EventTarget`](https://developer.mozilla.org/en-US/docs/Web/API/EventTarget), so events are subscribed to with `addEventListener()`.

## Attributes

#### `inviteCode` (String)

The code to share with other clients so they can connect with [`puter.peer.connect()`](/Peer/connect/). For a server started with a `name`, this is the name. For one on a generated code, it can change if the server has to re-register with the signaller — see the `reconnect` event.

#### `connections` (Map)

A `Map` of every connected client, keyed by connection id. The values are [`PuterPeerConnection`](/Objects/puterpeerconnection/) objects.

## Methods

#### `close()`

Closes every client connection and the signalling connection. The invite code stops working; a room name is free for someone else to serve.

#### `setGuestGrant(grant)`

Replaces the guest grant handed to clients that connect from now on (see the `guestGrant` option of [`puter.peer.serve()`](/Peer/serve/)). Grants expire, so a long-running host issues a fresh one with [`puter.peer.createGuestGrant()`](/Peer/createGuestGrant/) before the old one lapses and passes it here. Pass `null` to stop handing one out.

## Events

#### `connection`

Fired when a client connects. The event has the following attributes:

- `conn` ([`PuterPeerConnection`](/Objects/puterpeerconnection/)) - The connection to the client.
- `user` (Object) - Metadata about the connecting user, with `username` and `uuid` (if available).

#### `reconnect`

Fired when the server has re-registered with the signaller after losing its connection to it. Nothing about existing client connections changes; this only concerns clients yet to connect. The event has:

- `inviteCode` (String) - The invite code in force now. Unchanged for a server with a `name`; a server on a generated code gets a fresh one, since the old one died with the connection — share the new one.

#### `close`

Fired when the server has stopped accepting clients without `close()` having been called. Existing connections stay open; the invite code no longer works. The event has:

- `reason` (String) - `replaced` when a newer server of yours took the same room name over (the same account, or the same `anonToken`, called `serve()` again with that name), or `name_in_use` when the name is held by someone else and could not be reclaimed after the connection was lost.

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
