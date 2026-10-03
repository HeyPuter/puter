---
title: PuterPeerConnection
description: The PuterPeerConnection object representing a WebRTC data-channel connection to a peer.
---

The `PuterPeerConnection` object representing a WebRTC data-channel connection to a peer. [`puter.peer.connect()`](/Peer/connect/) resolves to one, and a [`PuterPeerServer`](/Objects/puterpeerserver/) hands one to its `connection` event for every client that joins.

`PuterPeerConnection` extends [`EventTarget`](https://developer.mozilla.org/en-US/docs/Web/API/EventTarget), so events are subscribed to with `addEventListener()`.

A connection rides out network trouble on its own. A link that stops carrying traffic is restored where possible — reconnecting to the signalling server first, if that connection dropped too — and the connection closes only once the peer has hung up, can no longer be reached, or the link has not come back within the `recoveryTimeout` given to [`puter.peer.connect()`](/Peer/connect/) or [`puter.peer.serve()`](/Peer/serve/).

## Attributes

#### `owner` (Object)

Information about the user who created the server, with `username` and `uuid`.

#### `connected` (Boolean)

Whether the data channel is currently open.

#### `closed` (Boolean)

Whether the connection has been closed.

#### `linkState` (String)

How the link to the peer is doing: `'connecting'`, `'connected'`, `'unstable'` (traffic has stopped, and the link may recover by itself), `'recovering'` (the link is being restored), or `'closed'`. Changes fire the `linkstate` event.

#### `publications` (Map)

A `Map` of the media being sent, keyed by the name it was published under. The values are `MediaStream` objects, or `null` for a name published with nothing to send.

#### `media` (Map)

A `Map` of the media arriving from the peer, keyed by the name the peer published it under. The values are `MediaStream` objects. Each name keeps one stream for as long as it is published, so a `<video>` element pointed at it once keeps working as tracks come and go.

#### `peerconnection` (RTCPeerConnection)

The raw underlying [`RTCPeerConnection`](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection) handle, for cases the Puter API does not cover.

## Methods

#### `send(data)`

Sends a message to the peer. `data` may be a `String`, `Blob`, `ArrayBuffer`, or `ArrayBufferView`.

#### `close(reason)`

Closes the connection. The optional `reason` string is delivered to the peer on its `close` event.

#### `publish(name, source, options)`

Sends media to the peer under `name`, which is the name the peer receives it with. `source` is a `MediaStream`, a `MediaStreamTrack`, or `null` to stop sending while keeping the name published. Publishing a name again swaps its tracks in place without renegotiating, so muting or switching camera is cheap.

The optional `options` object sets encoding limits for each kind of track, as `audio` and `video` objects with any of `maxBitrate`, `maxFramerate`, `scaleResolutionDownBy`, and `degradationPreference`.

#### `unpublish(name)`

Stops sending the media published under `name`. The peer receives a `mediaended` event for it.

#### `configure(name, options)`

Changes the encoding limits on a published name, taking the same `options` as `publish()`. The limits apply immediately and are kept across later negotiations.

## Events

#### `open`

Fired when the data channel is ready. Wait for this before calling `send()`.

#### `message`

Fired when a message is received. `event.data` holds the payload.

#### `close`

Fired when the connection closes. `event.reason` holds the reason, if one was given.

#### `error`

Fired when a connection error occurs. `event.error` holds the error.

#### `media`

Fired when a track arrives from the peer. The event has the following attributes:

- `name` (String) - The name the peer published the track under. A track the peer sent without a name, by adding it to its `peerconnection` directly, arrives under its m-section id.
- `stream` (MediaStream) - The stream for that name, the same one held in `media`.
- `track` (MediaStreamTrack) - The track that arrived.

#### `mediaended`

Fired when the peer stops publishing a name. The event has the following attributes:

- `name` (String) - The name that ended.
- `stream` (MediaStream) - The stream that was published under it.

#### `linkstate`

Fired when `linkState` changes. The event has the following attributes:

- `state` (String) - The new `linkState`.
- `attempt` (Number) - For `'recovering'`, which attempt at restoring the link this is; the event fires again for each one. Only the connecting side makes attempts. The server side waits for them, and reports `'recovering'` without an `attempt`.

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
