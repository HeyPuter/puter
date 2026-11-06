---
title: puter.peer.serve()
description: Create a peer server and generate an invite code.
platforms: [websites, apps]
---


Creates a peer server and returns a [`PuterPeerServer`](/Objects/puterpeerserver/) instance.

The server will generate an invite code that other clients can use to connect.

<div class="info">

On websites, Puter.js may prompt the user to authenticate before creating the peer server.

</div>

## Syntax

```js
const server = await puter.peer.serve();
const server = await puter.peer.serve(options);
```

## Parameters

#### `options` (Object) (optional)

An object with the following properties:

| Option | Type | Description |
|--------|------|-------------|
| `forceRelay` | `Boolean` | Whether to route connections through a relay instead of trying a peer-to-peer connection. Defaults to `false`, which tries peer-to-peer. Metering charges will increase. |
| `iceServers` | `Array<RTCIceServer>` | Custom ICE servers (STUN/TURN) to use instead of the Puter-managed relays. |
| `anonToken` | `String` | Any uuid, to host without a Puter session. No sign-in prompt is shown. An anonymous host has no account to attribute relay usage to, so it can't issue guest grants and gets no relays of its own. |
| `recoveryTimeout` | `Number` | How long, in milliseconds, each connection keeps trying to restore a broken link before it closes, counted from when the link first showed trouble. Defaults to `60000`. |

To let people join your session without accounts of their own, keep hosting authenticated and give them a grant from [`puter.peer.createGuestGrant()`](/Peer/createGuestGrant/).

## Return value

A `Promise` that resolves to a [`PuterPeerServer`](/Objects/puterpeerserver/) instance, which carries the `inviteCode` to share, the `connections` map of connected clients, and a `connection` event fired as each client joins.

## Examples

### Start a server and reply to clients

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
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
        })();
    </script>
</body>
</html>
```
