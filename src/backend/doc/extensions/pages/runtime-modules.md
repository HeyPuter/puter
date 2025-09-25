## Extensions - Runtime Modules

Runtime modules are modules that extensions can import with tihs syntax:

```javascript
const somelib = extension.import('somelib');
```

These modules are registered in the [runtime module registry](../../../src/extension/RuntimeModuleRegistry.js)
which is instantiated by [Kernel.js](../../../src/Kernel.js).

All extensions implicitly have a Runtime Module. The runtime module shares the name
of the extension that it corresponds to. Extensions can export to their module by
using `extension.exports`:

```javascript
extension.exports = { /* ... */ };
```

The [Extension](../../../src/Extension.js) object proxies this call to the
runtime module (called `this.runtime` in the snippet):

```javascript
class Extension extends AdvancedBase {
    // ...
    set exports (value) {
        this.runtime.exports = value;
    }
    // ...
}
```

You may be wondering why RuntimeModule is a separate class from Extension,
rather than just registering extensions into this registry.

Separating RuntimeModule allows core code that has not yet been migrated
to extensions to export values as if they came from extensions.
Since core modules are loaded before extensions, this allows any legacy
`useapi` definitions be be exported where modules are installed.

For example, in [CoreModule.js](../../../src/CoreModule.js) this snippet
of code is used to add a runtime module called `core`:

```javascript
// Extension compatibility
const runtimeModule = new RuntimeModule({ name: 'core' });
context.get('runtime-modules').register(runtimeModule);
runtimeModule.exports = useapi.use('core');
```
