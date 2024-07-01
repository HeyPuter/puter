# Puter Backend Boot Sequence

This document describes the boot sequence of Puter's backend.

**Constriction**
  - Data structures are created

**Initialization**
  - Registries are populated
  - Services prepare for next phase

**Consolidation**
  - Service event bus receives first event (`boot.consolidation`)
  - Services perform coordinated setup behaviors
  - Services prepare for next phase

**Activation**
  - Blocking listeners of `boot.consolidation` have resolved
  - HTTP servers start listening

**Ready**
  - Services are informed that Puter is providing service

## Boot Phases

### Construction

Services implement a method called `construct` which initializes members
of an instance. Services do not override the class constructor of
**BaseService**. This makes it possible to use the `new` operator without
invoking a service's constructor behavior during debugging.

The first phase of the boot sequence, "construction", is simply a loop to
call `construct` on all registered services.

The `_construct` override should not:
- call other services
- emit events

### Initialization

At initialization, the `init()` method is called on all services.
The `_init` override can be used to:
- register information with other services, when services don't
  need to register this information in a specific sequence.
  An example of this is registering commands with CommandService.
- perform setup that is required before the consolidation phase starts.

### Consolidation

Consolidation is a phase where services should emit events that
are related to bringing up the system. For example, WebServerService
('web-server') emits an event telling services to install middlewares,
and later emits an event telling services to install routes.

Consolidation starts when Kernel emits `boot.consolidation` to the
services event bus, which happens after `init()` resolves for all
services.

### Activation

Activation is a phase where services begin listening on external
interfaces. For example, this is when the web server starts listening.

Activation starts when Kernel emits `boot.activation`.

### Ready

Ready is a phase where services are informed that everything is up.

Ready starts when Kernel emits `boot.ready`.

## Events and Asynchronous Execution

The services event bus is implemented so you can `await` a call to `.emit()`.
Event listeners can choose to have blocking behavior by returning a promise.

During emission of a particular event, listeners of this event will not
block each other, but all listeners must resolve before the call to
`.emit()` is resolved. (i.e. `emit` uses `Promise.all`)

## Legacy Services

Some services were implemented before the `BaseService` class - which
implements the `init` method - was created. These services are called
"legacy services" and they are instantiated _after_ initialization but
_before_ consolidation.
