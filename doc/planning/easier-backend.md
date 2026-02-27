## Eric's Initiative to make Backend Easier to Understand

This document will outline:
- current issues with understandability and convenience of contribution
- paradigms that make code easier to understand

### Issues Affecting Understandability and Convenience

#### Modules/Services Boilerplate

Backend modules and services have boilerplate that makes the code look
less approchable. Within this boilerplate are conventions that look
unfamiliar.

##### Module Boilerplate

The module class is a poor stand-in for a manifest file. Modules do not
really contain any logic, they only contain data, so why should they be
written as source files?

Current situation:

```javascript
// backend/src/modules/some-module/SomeModule.js
const { AdvancedBase } = require("@heyputer/putility");
class SomeModule extends AdvancedBase {
    async install (context) {
        const services = context.get('services');
        
        const { SomeService } = require('./SomeService');
        services.registerService('some', SomeService, { some: 'config' });

        const { AnotherService } = require('./AnotherService');
        services.registerService('another', AntoherService, { some: 'config' });
    }
}
```

**Solution A: JSON5 manifest**

_a step in a direction_

```json5
// backend/src/modules/some-module/manifest.json5
{
    name: "Some Module",
    manifest-version: 1,
    
    // A simple service with no parameters
    some: SomeService,

    // Another service with some parameters
    another: {
        class: "AnotherService",
        opt-in: true, // service is disabled if not configured
        options: { some: "config" }
    }
}
```

**Solution B: Auto-Loader**

_a little too complicated; see Solution C_

In this solution "SomeService.js" is renamed as "some.js", and `some` becomes
the name of the registered service instance. Whether or not a service is
disabled if not configured is specified in the file for the service.

When multiple services are the same class with different options, we need a way
to describe that. For example, there are multiple instances of
`EntityStoreService`, one for each model. We can use these two conventions to
handle this case:
- modules can provide generic services under a `generic/` subdirectory.
- generic services don't have an instance by default; you need to specify in
  the manifest.

For example, the manifest might look like this:
```json5
// backend/src/modules/some-module/manifest.json5
{
    name: "Some Module",
    manifest-version: 1,
    
    "es:subdomain": {
        // module 'model' provides EntityStoreService
        from: "model/EntityStoreService",
        options: {
            model: { /* etc... */ },
        }
    }
}
```

but actually, maybe this was a subpar design decision to begin with. Do we
need generic services, or should services just allow registering all this
information? That leads us to...

**Solution C: module manifest can provide information that other modules might use**

We can have a manifest, but it's optional. Instead of having "generic services"
that can have multiple instances, we remove support for this use a registry
when we want something to add multiple behaviors (more data, less code).

```json5
// backend/src/modules/some-module/manifest.json5
{
    name: "SomeModule",
    manifest-version: 1,
    
    registry: {
        models: {
            subdomain: { /* etc... */ }
            app: { /* etc... */ }
            notification: { /* etc... */ }
        }
    }
}
```

Generic services are no longer supported in this case. We also get rid of any
service thats named like `SomethingInterfaceService.js`, because now driver
interfaces can just be part of the manifest's registry contribution as well.
After all, it's all just data; we don't need to be making data be code.

As services become more sophisticated, this also means many extensions/modules
can **just** be configuration. That adds a lot of value, because we create
a situation where people who don't know how to code can contribute meaningful
additions to Puter. For example, think of all the people who don't know a lick
of Java (or even code in general) but were able to create elaborate
configurations for their Minecraft modpacks.

##### Service Boilerplate

Current Situation:

```javascript
// backend/src/modules/some-module/SomeService.js

class SomeService extends BaseService {
    _construct () {
        // initial values
        this.some_key = "some value";
    }
    async _init () {
        // some init code
    }
}
```

It's important to the Puter backend Kernel that the concept of a "service"
exists at runtime, but we can make the code much easier to understand by
leveraging our ability to dynamically import the code in whatever context
we see fit. So, the above service class could look like scripts instead.

```javascript
// backend/src/modules/some-module/some.js

// initial values
let some_key = "some value";

init(async () => {
    // some init code
})
```

#### Filesystem Interface

Reading a file in a backend service currently looks like this:

```javascript
const svc_fs = this.services.get('filesystem');
const node = await svc_fs.node('/some/file.txt');
const ll_read = new LLRead();
const stream = await ll_read.run({
    actor: Context.get('actor'),
    fsNode: node,
});
const buffer = await stream_to_buffer(stream);
// now do something with "buffer"
```

Instead it can look like this:

> **note:** I later describe an alternative to `def` and `use`, called `world`.
> The `world` convention is even cleaner, and it's as convenient as setting
> things on `window` in the browser environment, without the caveats.

```javascript
const fs = use('filesystem');

const buffer = await fs.readAll('/some/file.txt');
```

Here we use `readAll` instead of `read` to get a buffer instead of a stream.
There would probably be a size limit on this as we should never buffer large
files in Puter's backend.

Instead of having the `services` container exposed, we just allow any service
to export APIs that other services can use. That call might look something
like this (this would be in the filesystem module):

```javascript
// backend/src/modules/filesystem/defs.js

def('filesystem', {
    readAll: async () => {
        /* implementation for readAll */
    }
});
```

I know what you're thinking: why don't we just do this?

```javascript
globalThis.filesystem = {
    readAll: async () => {
        /* implementation for readAll */
    }
};
```

actually we can, but only if `globalThis` is shadowed with a stand-in,
and we don't want to give developers the impression that this is the real
`globalThis` if it's not. We can't use the real `globalThis` for the following
reason: right now coding extensions vs builtin modules is different, and that's
not a good thing. We want to consolidate that. So let's suppose builtins and
extensions are coded the same: what happens if you load two third-party
extensions into Puter that use the same name? If we're using `def` as
above (we can change the name of `def` if it seems unclear) we can allow
somebody to resolve name conflicts. For example, suppose `theo-feature`
and `primagen-feature` both expose a backend API called `puterutils`; an
innocent victim of competitive naming can then configure their Puter kernel
like this and use both extensions:

```javascript
const PuterKernel = require('@heyputer/kernel');
const my_kernel = new PuterKernel();

my_kernel.load('path/to/theo-feature', {
    rename: {
        puterutils: 'theoutils'
    }
});
my_kernel.load('path/to/theo-feature', {
    rename: {
        puterutils: 'primeutils'
    }
});
my_kernel.load('path/to/theo-dependent', {
    use: {
        puterutils: 'theoutils',
    }
})
my_kernel.load('path/to/prime-dependent', {
    use: {
        puterutils: 'primeutils',
    }
})
my_kernel.boot();
```

In this example `theo-dependent` is an arbitrary extension that expects
`puterutils` to be Theo's implementation, while `prime-depentent` is an
arbitrary extension that expects `puterutils` to be Prime's implementation.

btw, `def` above could also be something like this, so that instead of
having `use` and `def`, we just have `use` and we use magic assignment to
make this look like it was part of javascript all along.

```javascript
use.filesystem = { /* ... */ };
```

I find this really intuitive. I read this as "use filesystem equals", and
that tells me exactly what it's doing: if some other Puter extension has
the expression `use.filesystem` in it, it's going to get the object that
I passed here.

There's a trade-off here. The `use('filesystem')` and `def('filesystem', {})`
syntaxes feel more robust. It carries a feeling of "something is handling the
hard work for me" rather than "I'm assigning stuff to a thing that's somehow
available everywhere". I'm not partial to either one of these, and we have
a couple options to decide:
- A/B test with some developers
- Just allow both. In fact, `use` already allows both (for importing stuff)

#### `world` convention

Here's another idea. Forget `def` and `use`, I call this one `world`.

```javascript
// Defining things
world.fs = { /* ... */ };

// Importing things
const { fs, log, context } = world;
```

### Incremental Migration

Right now we have:
- `CoreModule.js` in `backend/src`, not in `modules`
- `backend/src/services` for CodeModule's services
- `backend/src/modules` for other modules

CoreModule is pretty large, so migrating all of its servicces to a new
paradigm all at once is not a good idea. We need to do this incrementally.

Here's an idea I have: what if "new" modules can "extend" old ones,
so that we can move services over from the old to the new one at a time?

This could be specified in the manifest like this:
```json5
// src/modules/core/manifest.json5
{
    name: "core",
    manifest-version: 1,
    base: "../CoreModule.js",
}
```

Since `src/modules/core` has a `manifest.json5` file, it's treated as a
new module.

As another example, if we want to migrate the `puterai` module incrementally
we could rename the directory for the current module to `puterai_legacy` and
create a new `puterai` module with this manifest:


```json5
// src/modules/puterai/manifest.json5
{
    name: "puterai",
    manifest-version: 1,
    base: "../puterai_legacy/PuterAIModule.js",
}
```
