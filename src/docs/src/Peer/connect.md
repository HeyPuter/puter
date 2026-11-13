---
title: puter.peer.connect()
description: Connect to a peer server using an invite code.
platforms: [websites, apps]
---


Connects to a peer server and returns a [`PuterPeerConnection`](/Objects/puterpeerconnection/) instance.

<div class="info">

On websites, Puter.js may prompt the user to authenticate before connecting. To let someone join without an account, pass `anonToken` — and a `turnGrant` from the host, so the connection can still use Puter's relays. See [`puter.peer.createGuestGrant()`](/Peer/createGuestGrant/).

</div>

## Syntax

```js
const conn = await puter.peer.connect(inviteCode);
const conn = await puter.peer.connect(inviteCode, options);
```

## Parameters

#### `inviteCode` (required)

A string invite code created by `puter.peer.serve()`.

#### `options` (Object) (optional)

An object with the following properties:

| Option | Type | Description |
|--------|------|-------------|
| `anonToken` | `String` | Any uuid, to join without a Puter session. It identifies this guest for the whole session, and no sign-in prompt is shown. The host sees the guest as `anonymous`, so send any name the host should show for the guest over the connection. |
| `turnGrant` | `String` | A grant from [`puter.peer.createGuestGrant()`](/Peer/createGuestGrant/). It lets a guest use the Puter-managed relays on the host's account. Without one, a guest connects only where a direct connection is possible. With `forceRelay`, a guest needs one. |
| `forceRelay` | `Boolean` | Whether to route connections through a relay instead of trying a peer-to-peer connection. Defaults to `false`, which tries peer-to-peer. Metering charges may apply. |
| `iceServers` | `Array<RTCIceServer>` | Custom ICE servers (STUN/TURN) to use instead of the Puter-managed relays. |
| `recoveryTimeout` | `Number` | How long, in milliseconds, the connection keeps trying to restore a broken link before it closes, counted from when the link first showed trouble. Defaults to `60000`. |

## Return value

A `Promise` that resolves to a [`PuterPeerConnection`](/Objects/puterpeerconnection/) instance, which carries `send()` and `close()` methods and the `open`, `message`, `close`, and `error` events.

## Examples

### Connect to a server with an invite code

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            const inviteCode = prompt('Enter invite code');
            const conn = await puter.peer.connect(inviteCode);

            conn.addEventListener('open', () => {
                conn.send('Hello from the client!');
            });
            conn.addEventListener('message', (msg) => {
                puter.print('Server says:', msg.data);
            });
        })();
    </script>
</body>
</html>
```
