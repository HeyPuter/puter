---
title: puter.peer.connect()
description: Connect to a peer server using an invite code.
platforms: [websites, apps]
---


Connects to a peer server and returns a [`PuterPeerConnection`](/Objects/puterpeerconnection/) instance.

<div class="info">

On websites, Puter.js may prompt the user to authenticate before connecting.

</div>

## Syntax

```js
const conn = await puter.peer.connect(inviteCode);
const conn = await puter.peer.connect(inviteCode, options);
```

## Parameters

#### `inviteCode` (required)

A string invite code created by `puter.peer.serve()`.

#### `options` (optional)

`options` is an object with the following properties:

- `iceServers` (`RTCIceServer[]`) Custom ICE servers (STUN/TURN) to use instead of the Puter-managed relays.
- `forceRelay` (`boolean`) Whether to force connections to route through a relay instead of attempting peer-to-peer (default). Metering charges may apply.

## Return value

A `Promise` that resolves to a [`PuterPeerConnection`](/Objects/puterpeerconnection/) instance, which carries `send()` and `close()` methods and the `open`, `message`, `close`, and `error` events.

## Example

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
