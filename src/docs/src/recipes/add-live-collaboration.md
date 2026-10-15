---
title: Add Live Collaboration
description: "Learn how to add live collaboration to your app with Puter.js, so several people can work on the same thing at once and see each other's changes as they happen."
tags: [peer, workers, kv]
order: 61
---

Live collaboration lets several people work on the same thing at once and see
each other's changes as they happen. For example, on a shared sticky-note
board, everyone can add and move notes and see each other's cursors.

With Puter.js, this takes three pieces. [Peer](/Peer/) carries changes between
browsers in real time, a [serverless worker](/Workers/) saves a snapshot of the
board, and handoff logic keeps the room running when the person hosting it
leaves. There is no server to run for the real-time part.

## How It Works

One browser in each room is the **host**. It serves the room with
[`puter.peer.serve()`](/Peer/serve/), and everyone else joins with
[`puter.peer.connect()`](/Peer/connect/). Peer handles signalling and relays
between the browsers.

Every change goes through the host. The host applies changes one at a time,
gives the board a new version number and sends the result to everyone. Because
one browser decides the order, every client ends up with the same board. When
two people change the same note at once, the change that reaches the host last
wins.

The board holds two kinds of state:

- **Durable state**, like the notes, goes through the host, carries a version
  number and is saved to the worker.
- **Ephemeral state**, like cursors, is passed along and forgotten. A lost
  update does not matter, because the next one replaces it.

## Write the Worker

The worker keeps one snapshot per room in your own
[key-value database](/KV/) through `me.puter`, so every member reads the same
snapshot, whoever saved it:

```js
const key = (room) => `board:${ room }`;

router.get('/boards/:room', async ({ params }) => {
    return (await me.puter.kv.get(key(params.room))) ?? { version: 0, state: {} };
});

router.put('/boards/:room', async ({ request, params, user }) => {
    if ( ! user ) {
        return new Response('sign in required', { status: 401 });
    }

    const board = await request.json();
    const saved = await me.puter.kv.get(key(params.room));
    if ( saved && saved.version >= board.version ) {
        return saved;
    }

    await me.puter.kv.set(key(params.room), board);
    return board;
});
```

The `PUT` route only accepts a snapshot newer than the one stored. During a
handoff, the old host may send one last save after the new host has started
saving, and the version check stops that older snapshot from overwriting a
newer one.

## Deploy the Worker

Deploy the worker to get its URL, such as `https://my-board.puter.work`. The
[Workers deployment guide](/Workers/#deployment) covers each way to deploy.

## Set Up the Board

Every browser in the room keeps the same few pieces of state. The board is a
version number plus the notes, keyed by note ID:

```js
const WORKER_URL = 'https://my-board.puter.work';
const room = `sticky-${ boardId }`;
const tabId = crypto.randomUUID();

let board = { version: 0, state: {} };
let members = [];

function apply(state, op) {
    const notes = { ...state };
    if ( op.action === 'delete' ) {
        delete notes[op.id];
    } else {
        notes[op.id] = { ...notes[op.id], ...op.note };
    }
    return notes;
}
```

The `apply()` function is the only part specific to your app. For a sticky-note
board, it adds, updates or deletes one note by ID. Every browser runs the same
`apply()`, so the same changes in the same order give the same board.

Room names must be lowercase and are shared across Puter, so prefix them with
something specific to your app, as `sticky-` does here.

Each tab gets its own random `tabId` rather than the account's ID, so one
person with two tabs open counts as two members.

## Apply Changes on the Host

Every durable change goes through one function on the host, which applies it,
bumps the version and broadcasts it to every client:

```js
let server = null;

function broadcast(msg, except) {
    const data = JSON.stringify(msg);
    for ( const conn of server.connections.values() ) {
        if ( conn !== except ) conn.send(data);
    }
}

function commit(op) {
    board = { version: board.version + 1, state: apply(board.state, op) };
    broadcast({ type: 'op', op, version: board.version });
}
```

Messages from clients are handled by type. Ephemeral updates such as cursors
skip `commit()`, and the host relays them to everyone except the sender without
touching the board or its version:

```js
function broadcastMembers() {
    broadcast({ type: 'members', members: members.map(({ id }) => ({ id })) });
}

function onClientMessage(conn, user, msg) {
    if ( msg.type === 'hello' ) {
        members.push({ id: msg.id, conn });
        broadcastMembers();
    }
    if ( msg.type === 'op' ) {
        commit(msg.op);
    }
    if ( msg.type === 'resync' ) {
        conn.send(JSON.stringify({ type: 'sync', board }));
    }
    if ( msg.type === 'cursor' ) {
        broadcast({ type: 'cursor', user: user.username, x: msg.x, y: msg.y }, conn);
    }
}

function onClientClose(conn) {
    members = members.filter((m) => m.conn !== conn);
    broadcastMembers();
}
```

Each client introduces itself with a `hello` message carrying its `tabId`. The
host keeps the member list in join order and sends it to everyone whenever it
changes. Clients use that list to decide who hosts next when the host leaves.

## Save Snapshots From the Host

The host saves on a timer rather than on every change. Dragging a note sends
dozens of changes a second, and the timer turns that into one request every few
seconds. The [`puter.workers.exec()`](/Workers/exec/) method sends the request
with the user's session, so the worker sees who saved it:

```js
let savedVersion = 0;

async function saveSnapshot() {
    if ( board.version <= savedVersion ) return;
    const snapshot = board;
    await puter.workers.exec(`${ WORKER_URL }/boards/${ room }`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(snapshot),
    });
    savedVersion = snapshot.version;
}

async function loadSnapshot() {
    const res = await puter.workers.exec(`${ WORKER_URL }/boards/${ room }`);
    const saved = await res.json();
    if ( saved.version > board.version ) board = saved;
}
```

The `loadSnapshot()` function keeps whichever board is newer, the one this
browser already has or the saved snapshot. A member taking over after a
handoff already holds the last board the old host sent, which is usually newer
than the last snapshot, so a handoff loses nothing the room had already seen.

## Host the Room

To host the room, serve it by name with [`puter.peer.serve()`](/Peer/serve/).
The `host()` function brings together everything above, and its promise
resolves when this browser stops hosting:

```js
async function host() {
    server = await puter.peer.serve({ name: room });
    members = [{ id: tabId }];
    await loadSnapshot();

    server.addEventListener('connection', (event) => {
        const { conn, user } = event;
        conn.addEventListener('open', () => {
            conn.send(JSON.stringify({ type: 'sync', board }));
        });
        conn.addEventListener('message', (msg) => onClientMessage(conn, user, JSON.parse(msg.data)));
        conn.addEventListener('close', () => onClientClose(conn));
    });

    const timer = setInterval(saveSnapshot, 3000);

    return new Promise((resolve) => {
        server.addEventListener('close', () => {
            clearInterval(timer);
            for ( const conn of server.connections.values() ) conn.close();
            server = null;
            resolve();
        });
    });
}
```

The host sends a `sync` with the whole board when a client joins, so a new
client starts from the current version and only needs the changes after it.

The `user` on each [`connection`](/Objects/puterpeerserver/#connection) event
comes from the connecting user's Puter account, so the host knows who each
client really is, whatever that client says about itself.

The server fires [`close`](/Objects/puterpeerserver/#close) when another server
takes over the room name, such as the same person opening the empty room in two
tabs at once. The older host then closes its connections, and `host()` returns
so the browser can join the room again as a client.

## Follow the Host

A client applies the host's changes in the order the host sent them. When a
change arrives out of order, the client asks for the whole board again:

```js
let hostConn = null;

function follow(conn) {
    hostConn = conn;
    conn.send(JSON.stringify({ type: 'hello', id: tabId }));

    conn.addEventListener('message', (msg) => {
        const data = JSON.parse(msg.data);

        if ( data.type === 'sync' ) {
            board = data.board;
        }
        if ( data.type === 'op' ) {
            if ( data.version !== board.version + 1 ) {
                return conn.send(JSON.stringify({ type: 'resync' }));
            }
            board = { version: data.version, state: apply(board.state, data.op) };
        }
        if ( data.type === 'members' ) {
            members = data.members;
        }
    });

    return new Promise((resolve) => {
        conn.addEventListener('close', () => {
            hostConn = null;
            resolve();
        }, { once: true });
    });
}
```

Like `host()`, the promise from `follow()` resolves when this browser stops
following, which happens when the host leaves.

Every edit, from the host or a client, goes through one `edit()` function:

```js
function edit(op) {
    if ( hostConn ) {
        hostConn.send(JSON.stringify({ type: 'op', op }));
    } else if ( server ) {
        commit(op);
    }
}

edit({ action: 'set', id: 'note-1', note: { text: 'Hello', x: 40, y: 80 } });
```

A client's edit comes back from the host as an `op` like everyone else's, so
every client applies changes in the same order. During a handoff there is no
host for a moment, and `edit()` drops the change.

## Join or Host a Room

Joining always tries to connect first. The
[`puter.peer.connect()`](/Peer/connect/) method accepts a room name, and when
nobody is serving that name, the connection fails with `no_host`. The browser
then hosts the room itself:

```js
async function openConnection() {
    const conn = await puter.peer.connect(room);
    return new Promise((resolve, reject) => {
        conn.addEventListener('open', () => resolve(conn), { once: true });
        conn.addEventListener('error', (event) => reject(event.error ?? event), { once: true });
    });
}

async function joinOrHost(patience) {
    for ( let attempt = 0; ; attempt++ ) {
        try {
            return await follow(await openConnection());
        } catch ( err ) {
            if ( err.code !== 'no_host' ) throw err;
        }

        if ( attempt >= patience ) {
            try {
                return await host();
            } catch ( err ) {
                if ( err.code !== 'name_in_use' ) throw err;
            }
        }

        await new Promise((r) => setTimeout(r, 1000 + Math.random() * 500));
    }
}
```

The promise from [`puter.peer.connect()`](/Peer/connect/) resolves before the
connection is open, so `openConnection()` waits for the `open` event before
returning it. The `patience` argument is how many empty-room attempts to accept
before hosting.

Two people can open an empty room in the same instant and both try to host.
The first [`puter.peer.serve()`](/Peer/serve/) call takes the room name, and
the second rejects with `name_in_use`, so `joinOrHost()` goes back to
connecting and joins the first host.

## Hand Off When the Host Leaves

When the host's tab closes, every client's connection closes at about the same
moment. To keep them from all hosting at once, clients take turns, in the order
of the member list the host sent:

```js
function placeInLine() {
    const successors = members.slice(1);    // members[0] was the host
    const rank = successors.findIndex((m) => m.id === tabId);
    return rank === -1 ? successors.length * 3 : rank * 3;
}

async function run() {
    let patience = 0;
    for ( ;; ) {
        await joinOrHost(patience);
        patience = placeInLine();
    }
}

run();
```

A first visit uses a `patience` of `0`, so it hosts right away when the room is
empty. After a handoff, the first member in line hosts as soon as it finds the
room empty. Everyone else keeps trying to connect, and the next member in line
only hosts if the first has not appeared after three attempts. That covers both
of them leaving together.

## Notes

- **Guests without an account.** Joining with an `anonToken` skips sign-in, and
  [`puter.peer.createGuestGrant()`](/Peer/createGuestGrant/) lets guests use
  Puter's relays on the host's account.
- **Shared text.** For text that two people edit at the same time, replace
  last-write-wins with a CRDT such as Yjs and send its updates over the same
  connections.
