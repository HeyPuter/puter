---
title: puter.peer.createGuestGrant()
description: Let guests without a Puter account use Puter's TURN relays on your account.
platforms: [websites, apps]
---


Creates a **guest grant**: a short-lived token that lets people without a Puter session use the Puter-managed TURN relays. Either hand it to the people you invite alongside the invite code, and they pass it to [`puter.peer.connect()`](/Peer/connect/) as `turnGrant` — or pass it to [`puter.peer.serve()`](/Peer/serve/) as `guestGrant`, and every guest that connects without a grant of their own receives it through the signaller.

Without a grant, a guest can still join a session — but only over direct connections. Relay credentials are what make a connection work when one side is behind a NAT or firewall that blocks direct traffic, and minting them requires an account. The grant is how your account vouches for the guest.

<div class="info">

Relay traffic a guest sends is metered against **your** account, at the same rate as your own. Anyone holding the grant can mint credentials until it expires, so share it with the session you meant to host, and let it expire rather than reusing one indefinitely.

</div>

## Syntax

```js
const { grant, expiresAt } = await puter.peer.createGuestGrant();
```

## Parameters

None.

## Return value

A `Promise` that resolves to an object with:

- `grant` (`String`) The grant to give your guests.
- `expiresAt` (`Number`) When the grant stops being accepted, in seconds since the epoch. Past this point, redeeming it fails with `peer_grant_expired` and you issue a new one.

Rejects if the caller isn't authenticated, or if the deployment doesn't offer guest relay access.

## Example

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <h3>Host a session guests can join</h3>
    <button id="host">Start hosting</button>
    <pre id="out" style="background:#f4f4f4; padding:10px;"></pre>

    <script>
        const out = document.getElementById('out');

        document.getElementById('host').addEventListener('click', async () => {
            // Hosting requires a Puter account; joining will not.
            const server = await puter.peer.serve();
            const { grant, expiresAt } = await puter.peer.createGuestGrant();

            // Everything a guest needs, in one link.
            const link = new URL(location.href);
            link.hash = new URLSearchParams({
                code: server.inviteCode,
                grant,
            }).toString();

            out.textContent =
                `Invite link:\n${link}\n\n` +
                `Good until ${new Date(expiresAt * 1000).toLocaleTimeString()}`;

            server.addEventListener('connection', (event) => {
                out.textContent += `\n${event.user?.username ?? 'someone'} joined`;
                event.conn.addEventListener('message', (e) => {
                    out.textContent += `\nmessage: ${e.data}`;
                });
            });
        });

        // The guest side of the same page: join with the code and grant from
        // the link, no sign-in prompt.
        (async () => {
            const params = new URLSearchParams(location.hash.slice(1));
            const code = params.get('code');
            const grant = params.get('grant');
            if ( !code ) return;

            const conn = await puter.peer.connect(code, {
                anonToken: crypto.randomUUID(),
                turnGrant: grant,
            });
            conn.addEventListener('open', () => {
                out.textContent += '\nJoined as a guest';
                conn.send('hello from a guest');
            });
        })();
    </script>
</body>
</html>
```
