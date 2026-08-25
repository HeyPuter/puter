---
title: puter.peer.ensureTurnRelays()
description: Preload TURN relays for faster peer connections.
platforms: [websites, apps]
---


Fetches TURN relay credentials ahead of time so that peer connections can start faster. This is optional because `puter.peer.serve()` and `puter.peer.connect()` call it automatically when needed.

## Syntax

```js
await puter.peer.ensureTurnRelays();
await puter.peer.ensureTurnRelays(options);
```

## Parameters

#### `options` (optional)

`options` is an object with the following properties:

- `turnGrant` (`String`) A grant from [`puter.peer.createGuestGrant()`](/Peer/createGuestGrant/), to preload relays as a guest with no Puter session. Credentials are minted against the account that issued the grant.

## Return value

A `Promise` that resolves when relay details are cached. If relays cannot be loaded, Puter.js will fall back to default ICE servers when connecting.
