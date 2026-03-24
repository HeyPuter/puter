---
title: puter.peer.ensureTurnRelays()
description: Preload TURN relays for faster peer connections.
platforms: [websites, apps]
---

<div class="alpha-notice-banner">
    <span class="alpha-notice-label">Alpha</span>
    <span class="alpha-notice-text">The Peer API is in alpha. Expect breaking changes, and please report issues you encounter.</span>
</div>
<div class="alpha-notice-spacer"></div>

Fetches TURN relay credentials ahead of time so that peer connections can start faster. This is optional because `puter.peer.serve()` and `puter.peer.connect()` call it automatically when needed.

## Syntax

```js
await puter.peer.ensureTurnRelays();
```

## Return value

A `Promise` that resolves when relay details are cached. If relays cannot be loaded, Puter.js will fall back to default ICE servers when connecting.
