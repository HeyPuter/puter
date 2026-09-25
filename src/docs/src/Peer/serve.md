---
title: puter.peer.serve()
description: Create a peer server and generate an invite code.
platforms: [websites, apps]
---


Creates a peer server and returns a [`PuterPeerServer`](/Objects/puterpeerserver/) instance. The server will generate an invite code that other clients can use to connect.

<div class="info">

On websites, Puter.js may prompt the user to authenticate before creating the peer server.

</div>

## Syntax

```js
const server = await puter.peer.serve();
const server = await puter.peer.serve(options);
```

## Parameters

#### `options` (optional)

`options` is an object with the following properties:

- `iceServers` (`RTCIceServer[]`) Custom ICE servers (STUN/TURN) to use instead of the Puter-managed relays.
- `forceRelay` (`boolean`) Whether to force connections to route through a relay instead of attempting peer-to-peer (default). Metering charges will increase.
- `anonToken` (`String`) Host without a Puter session. Any uuid; no sign-in prompt is shown. An anonymous host has no account to attribute relay usage to, so it cannot issue guest grants and gets no relays of its own.
- `name` (`String`) Serve under a **room name** of your choosing instead of a generated invite code. Clients connect with the same string: `puter.peer.connect(name)`. See [Room names](#room-names) below.
- `guestGrant` (`String`) A grant from [`puter.peer.createGuestGrant()`](/Peer/createGuestGrant/) to hand to guests. Every client that connects with `anonToken` and no `turnGrant` of its own receives it through the signaller and uses the relays on your account, so you never have to deliver the grant some other way. Renew it with [`server.setGuestGrant()`](/Objects/puterpeerserver/#setguestgrant-grant) before it expires.

To let people join your session without accounts of their own, keep hosting authenticated and give them a grant — see [`puter.peer.createGuestGrant()`](/Peer/createGuestGrant/).

## Return value

A `Promise` that resolves to a [`PuterPeerServer`](/Objects/puterpeerserver/) instance, which carries the `inviteCode` to share, the `connections` map of connected clients, and a `connection` event fired as each client joins.

Rejects with an `Error` whose `code` is `name_in_use` when `name` is currently being served by someone else, and with a `TypeError` when `name` is not a valid room name.

## Room names

A generated invite code (`NJ-7F3A9C`) is minted when you call `serve()` and stops working when the server goes away — good for a one-off session, useless for a link you want to share ahead of time or reuse. A room name is an address you pick, and it is the same every time you serve it:

```js
const server = await puter.peer.serve({ name: 'friday-standup' });
server.inviteCode; // 'friday-standup'
```

- Names are 3–64 characters of lowercase letters, digits and hyphens, not starting or ending with a hyphen.
- A name is held by whoever is serving it right now, first come, and is free again the moment that server stops. While it is held, `serve()` from **another** identity rejects with `name_in_use`. From the **same** identity — the same account, or the same `anonToken` — the newer server takes the name over and the older one fires `close` with reason `replaced`, so a host whose connection dropped can come straight back, and a user who opens the same room twice ends up with the newest tab serving it.
- A client that connects to a room nobody is serving gets a definite answer — an `error` event whose `code` is `no_host` — so a lobby can simply try again in a few seconds until the host arrives.

A server stays reachable on its own: if its connection to the signaller drops, it re-registers under the same name (or, for a generated code, under a fresh one, announced by the `reconnect` event). Existing connections are never affected by this — they are peer-to-peer.

## Example

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
