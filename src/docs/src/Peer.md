---
title: Peer
description: Create peer-to-peer connections between Puter.js clients with WebRTC data channels.
---

<div class="alpha-notice-banner">
    <span class="alpha-notice-label">Alpha</span>
    <span class="alpha-notice-text">The Peer API is in alpha. Expect breaking changes, and please report issues you encounter.</span>
</div>
<div class="alpha-notice-spacer"></div>

The Puter.js Peer API gives you WebRTC data channels with built-in signaling and TURN relays, so you can connect clients directly without running your own signaling server.

<div class="info">

Peer connections require authentication. On websites, Puter.js will prompt the user to authenticate if needed.

</div>

## Features

#### Create a peer server and exchange messages

```html;peer-basic
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <h3>Peer Chat</h3>
    <p>Open this page in two tabs. Start a server in one tab, then connect from the other.</p>

    <div style="margin-bottom: 10px;">
        <button id="start-server">Start server</button>
        <span id="invite" style="margin-left: 10px;"></span>
    </div>

    <div style="margin-bottom: 10px;">
        <input id="invite-input" placeholder="Invite code" style="width: 220px;" />
        <button id="connect">Connect</button>
    </div>

    <div style="margin-bottom: 10px;">
        <input id="message" placeholder="Message" style="width: 220px;" />
        <button id="send" disabled>Send</button>
    </div>

    <pre id="log" style="background:#f4f4f4; padding:10px; height:200px; overflow:auto;"></pre>

    <script>
        const logEl = document.getElementById('log');
        const inviteEl = document.getElementById('invite');
        const inviteInput = document.getElementById('invite-input');
        const messageInput = document.getElementById('message');
        const sendBtn = document.getElementById('send');

        let activeConn = null;

        function log (...args) {
            logEl.textContent += `${args.join(' ')}\n`;
            logEl.scrollTop = logEl.scrollHeight;
        }

        function setConnection (conn, role) {
            activeConn = conn;
            sendBtn.disabled = true;

            conn.addEventListener('open', () => {
                log(`[${role}] connected`);
                sendBtn.disabled = false;
            });

            conn.addEventListener('message', (event) => {
                log(`[${role}] received:`, event.data);
            });

            conn.addEventListener('close', (event) => {
                log(`[${role}] closed`, event.reason ? `(${event.reason})` : '');
                sendBtn.disabled = true;
            });

            conn.addEventListener('error', (event) => {
                log(`[${role}] error`, event.error?.message || event.error || 'unknown error');
            });
        }

        document.getElementById('start-server').addEventListener('click', async () => {
            inviteEl.textContent = 'Starting...';
            try {
                const server = await puter.peer.serve();
                inviteEl.textContent = `Invite code: ${server.inviteCode}`;
                log('[server] ready, waiting for connection');

                server.addEventListener('connection', (event) => {
                    log('[server] client connected');
                    setConnection(event.conn, 'server');
                });
            } catch (err) {
                inviteEl.textContent = 'Failed to start server.';
                log('[server] error', err?.message || err);
            }
        });

        document.getElementById('connect').addEventListener('click', async () => {
            const inviteCode = inviteInput.value.trim();
            if ( !inviteCode ) {
                log('[client] enter an invite code first');
                return;
            }

            try {
                const conn = await puter.peer.connect(inviteCode);
                log('[client] connecting...');
                setConnection(conn, 'client');
            } catch (err) {
                log('[client] error', err?.message || err);
            }
        });

        sendBtn.addEventListener('click', () => {
            const message = messageInput.value.trim();
            if ( !message || !activeConn ) return;
            activeConn.send(message);
            log('[you] sent:', message);
            messageInput.value = '';
        });
    </script>
</body>
</html>
```

## Functions

These peer features are supported out of the box when using Puter.js:

- **[`puter.peer.serve()`](/Peer/serve/)** - Create a peer server and generate an invite code
- **[`puter.peer.connect()`](/Peer/connect/)** - Connect to a peer server using an invite code
- **[`puter.peer.ensureTurnRelays()`](/Peer/ensureTurnRelays/)** - Preload TURN relays for faster connections

## Examples

- [Peer chat](/playground/peer-basic/)
