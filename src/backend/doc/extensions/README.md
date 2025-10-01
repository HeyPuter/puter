# Puter Backend Extensions

## What Are Extensions

Extensions can extend the functionality of Puter's backend by handling specific
events or importing/exporting runtime libraries.

## Creating an Extension

The easiest way to create an extension is to place a new file or directory under
the `extensions/` directory immediately under the root directory of the Puter
repository. If your extension is a single `.js` file called `my-extension.js` it
will be implicitly converted into a CJS module with the following structure:

```
extensions/
 |
 |- my-extension/
    |
    |- package.json
    |- main.js
```

The location of the extensions directory can be changed in
[the config file](../../../../doc/self-hosters/config.md)
by setting `mod_directories` to an array of valid locations.
The `mod_directories` parameter has the following default value:
```json
["{repo}/mods/mods_enabled", "{repo}/extensions"]
```

### Events

The primary mechanism of communication between extensions and Puter,
and between different extensions, is through events. The `extension`
pseudo-global provides `.on(fn)` to add event listemers and
`.emit('name', { arbitrary: 'data' })` to emit events.

To try working with events, you could make a simple extension that
emits an event after adding a listener for its own event:

```javascript
// Listen to a test event called 'test-event'
extension.on('test-event', event => {
      console.log(`We got the test event from ${sender}`);
});

// Listen to init; a good time to emit events
extension.on('init', event => {
      extension.emit('test-event', { sender: 'Quinn' });
});
```

### Imports

Your extensions may need to invoke specific actions in Puter's backend
in response to an event. Puter provides libraries at runtime which you
can access via `extension.imports`:

```javascript
const { kv } = extension.imports('data');
kv.set('some-key', 'some value');
```


### Adding Features to Puter
- [Implementing Drivers](./pages/drivers.md)

## Extensions - Planned Features

Extensions are under refactor currently. This is the checklist:
- [x] Add RuntimeModule construct for imports and exports
- [x] Add support to implement drivers in extensions
- [ ] Add the ability to target specific extensions when
      emitting events
- [ ] Add event name aliasing and configurable import mapping
- [ ] Extract extension loading from the core
- [ ] List exports in console
