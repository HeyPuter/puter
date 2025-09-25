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

### How Extensions are Loaded

Before extensions are loaded, all of Puter's core modules have their `.install()`
methods called. The core modules are the ones added with `kernel.add_module`,
for example in [run-selfhosted.js](../../../../../tools/run-selfhosted.js).

Then, `Kernel.install_extern_mods_` is called. This is where a `readdir` is
performed on each directory listed in the `"mod_directories"` configuration
parameter, which has a default value of `["{repo}/extensions"]` (the
placeholder `{repo}` is automatically replaced with the path to the Puter
repository).

For each item in each mod directory, except for ignored items like `.git`
directories, a mod is installed. First a directory is created in Puter's
runtime directory (`volatile/runtime` locally, `/var/puter` on a server).
If the item is a file then a `package.json` will be created for it after
`//@extension` directives are processed. If the item is a directory then
it is copied as is and `//@extension` directives are not supported
(`puter.json` is used instead). Source files for the mod are copied to
the mod directory under the runtime directory.

It is at this point the pseudo-globals are added be prepending `cost`
declarations at the top of `.js` files in the extension. This is not
a great way to do this, but there is a severe lack of options here.
See the heading below - "Extension Pseudo-Globals" - for details.

Before the entry file for the extension is `require()`'d a couple of
objects are created: an `ExtensionModule` and an `Extension`.
The `ExtensionModule` is a Puter module just like any of the Puter core
modules, so it has an `.install()` method that installs services before
Puter's kernel starts the initialization sequence. In this case it will
install the implied service that an extension creates if it registers
routes or performs any other action that's typically done inside services
in core modules.

A RuntimeModule is also created. This could be thought of as analygous
to node's own `Module` class, but instead of being for imports/exports
between npm modules it's for imports/exports between Puter extensions
loaded at runtime. (see [runtime modules](./runtime-modules.md))

### Extension Pseudo-Globals

The `extension` global is a different object per extension, which will
make it possible to develop "remapping" for imports/exports when
extension names collide among other functions that need context about
which extension is calling them. Implementing this per-extension global
was very tricky and many solutions were considered, including using the
`node:vm` builtin module to run the extension in a different instance.
Unfortunately `node:vm` support for EMCAScript Modules is lacking;
`vm.Module` has a drastically different API from `vm.Script`, requires
an experimental feature flag to be passed to node, and does not provide
any alternative to `createRequire` to make a valid linker for the
dependencies of a package being run in `node:vm`.

The current solution - which sucks - is as follows: prepend `const`
definitions to the top of every `.js` file in the extension's installation
directory unless it's under a directory called `node_modules` or `gui`.
This type of "pseudo-global" has a quirk when compared to real globals,
which is that they can't be shadowed at the root scope without an error
being thrown. The naive solution of wrapping the rest of the file's
contents in a scope limiter (`{ ... }`) would break ES Module support
because `import` directives must be in the top-level scope, and the naive
solution to that problem of moving imports to the top of the file after
adding the scope limiter requires invoking a javascript parser do
determine the difference between a line starting with `import` because
it's actually an import and this unholy abomination of a situation:
```
console.log(`
import { me, and, everything, breaks } from 'lackOfLexicalAnalysis';
`);
```

Exposing the same instance for `extension` to all extensions with a
real global and using AsyncLocalStorage to get the necessary information
about the calling extension on each of `extension`'s methods was another
idea. This would cause surprising behavior for extension developers when
calling methods on `extension` in callbacks that lose the async context
fail because of missing extension information.

Eventually a better compromise will be to have commonjs extensions
run using `vm.Script` and ESM extensions continue to run using this hack.

### Event Listener Sub-Context

In extensions, event handlers are registered using `extension.on`. These
handlers, when called, are supplemented with identifying information for
the extension through AsyncLocalStorage. This means any methods called
on the object passed from the event (usually just called `event`) will
be able to access the extension's name.

This is used by CommandService's `create.commands` event. For example
the following extension code will register the command `utils:say-hello`
if it is invoked form an extension named `utils`:

```javascript
extension.on('create.commands', event => {
    event.createCommand('say-hello', async (args, console) => {
        console.log('Hello,', ...args);
    });
});
```
