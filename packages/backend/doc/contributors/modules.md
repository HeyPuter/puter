# Puter Kernel Moduels and Services

## Modules

A Puter kernel module is simply a collection of services that run when
the module is installed. You can find an example of this in the
`run-selfhosted.js` script at the root of the Puter monorepo.

Here is the relevant excerpt in `run-selfhosted.js` at the time of
writing this documentation:

```javascript
const {
    Kernel,
    CoreModule,
    DatabaseModule,
    LocalDiskStorageModule,
    SelfHostedModule
} = (await import('@heyputer/backend')).default;

console.log('kerne', Kernel);
const k = new Kernel();
k.add_module(new CoreModule());
k.add_module(new DatabaseModule());
k.add_module(new LocalDiskStorageModule());
k.add_module(new SelfHostedModule());
k.boot();
```

A few modules are added to Puter before booting. If you want to install
your own modules into Puter you can edit this file for self-hosted runs
or create your own script that boots Puter. This makes it possible to
have deployments of Puter with custom functionality.

To function properly, Puter needs **CoreModule**, a database module,
and a storage module.

A module extends
[AdvancedBase](../../../puter-js-common/README.md)
and implements
an `install` method. The install method has one parameter, a
[Context](../../src/util/context.js)
object containing all the values kernel modules have access to. This
includes the `services`
[Container](../../src/services/Container.js`).

A module adds services to Puter.eA typical module may look something
like this:

```javascript
class MyPuterModule extends AdvancedBase {
    async install (context) {
        const services = context.get('services');

        const MyService = require('./path/to/MyService.js');
        services.registerService('my-service', MyService, {
            some_options: 'for-my-service',
        });
    }
}
```

## Services

Services extend
[BaseService](../../src/services/BaseService.js)
and provide additional functionality for Puter. They can add HTTP
endpoints and register objects with other services.

When implementing a service it is important to understand
Puter's [boot sequence](./boot-sequence.md)

A typical service may look like this:

```javascript
class MyService extends BaseService {
    static MODULES = {
        // Use node's `require` function to populate this object;
        // this makes these available to `this.require` and offers
        // dependency-injection for unit testing.
        ['some-module']: require('some-module')
    }

    // Do not override the constructor of BaseService - use this instead!
    async _construct () {
        this.my_list = [];
    }

    // This method is called after _construct has been called on all
    // other services.
    async _init () {
        const services = this.services;

        // We can get the instances of other services here
        const svc_otherService = services.get('other-service');
    }

    // The service container can listen on the "service event bus"
    async ['__on_boot.consolidation'] () {}
    async ['__on_boot.activation'] () {}
    async ['__on_start.webserver'] () {}
    async ['__on_install.routes'] () {}
}
```
