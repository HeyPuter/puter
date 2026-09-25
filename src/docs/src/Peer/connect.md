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

The invite code a `puter.peer.serve()` call was given, or the **room name** it was started with (`serve({ name })`). The two are told apart by shape — generated codes are uppercase (`NJ-7F3A9C`), room names lowercase — so pass whichever you were handed.

#### `options` (optional)

`options` is an object with the following properties:

- `iceServers` (`RTCIceServer[]`) Custom ICE servers (STUN/TURN) to use instead of the Puter-managed relays.
- `forceRelay` (`boolean`) Whether to force connections to route through a relay instead of attempting peer-to-peer (default). Metering charges may apply.
- `anonToken` (`String`) Join without a Puter session. Any uuid — it identifies this guest for the duration of the session, and no sign-in prompt is shown. The host sees the guest as `anonymous`, so anything you want to call them is yours to send over the connection.
- `turnGrant` (`String`) A grant from [`puter.peer.createGuestGrant()`](/Peer/createGuestGrant/). Lets a guest use the Puter-managed relays on the host's account. Without one, a guest still gets relays when the host serves with a `guestGrant` — that grant reaches the guest through the signaller. Otherwise a guest connects only where a direct connection is possible; with `forceRelay`, a guest needs a grant one way or the other.

## Return value

A `Promise` that resolves to a [`PuterPeerConnection`](/Objects/puterpeerconnection/) instance, which carries `send()` and `close()` methods and the `open`, `message`, `close`, and `error` events.

The promise resolves once the connection has been requested, not once it is open — wait for `open` before sending. If the signaller refuses the connection, the instance fires `error` with an `Error` whose `code` says why, then `close`:

- `no_host` — the room name is valid but nobody is serving it right now. Try again in a few seconds; the host may be on their way.
- `invalid_invite` — the invite code is not live: it was mistyped, or the server that issued it is gone.
- `invalid_auth` — the session token or `anonToken` was not accepted.

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
