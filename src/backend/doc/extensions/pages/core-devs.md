## Extensions - Technical Context for Core Devs

This document provides technical context for extensions from the perspective of
core backend modules and services, including the backend kernel.

### Lifecycle

For extensions, the concept of an "init" event handler is different from core.
This is because a developer of an extension expects `init` to occur after core
modules and services have been initialized. For this reason, extensions receive
`init` when backend services receive `boot.consolidation`.

It is still possible to handle core's `init` event in an extension. This is done
using the `preinit` event.

```
Backend Core Lifecycle
  Modules           -> Construction -> Initialization -> Consolidation -> Activation -> Ready
Extension Lifecycle
  index.js executed -> (no event)   -> 'preinit'      -> 'init'        -> (no event) -> 'ready'
```

Extensions have an implicit Service instance that needs to listen for events on
the **Service Event Bus** such as `install.routes` (emitted by WebServerService).
Since extensions need to affect the behavior of the service when these events
occur (for example using `extension.post()` to add a POST handler) it is necessary
for their entry files to be loaded during a module installation phase, when
services are being registered and `_construct()` has not yet been called on any
service.

Kernel.js loads all core modules/services before any extensions. This allows
core modules and services to create [runtime modules](./runtime-modules.md)
which can be imported by services.
