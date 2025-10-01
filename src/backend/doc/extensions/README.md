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

### Importing / Exporting

Here are two extensions. One extension has an "extension export" (an export to
other extensions) and an "extension import" (an import from another extension).
This is different from regular `import` or `require()` because it resolves to
a Puter extension loaded at runtime rather than an `npm` module.

To import and export in Puter extensions, we use `extension.import()` and `extension.exports`.

`exports-something.js`
```javascript
//@puter priority -1
// ^ setting load priority to "-1" allows other extensions to import
//   this extension's exports before the initialization event occurs

// Just like "module.exports", but for extensions!
extension.exports = {
    test_value: 'Hello, extensions!,
};
```

`imports-something.js`
```javascript
const { test_value } = extension.import('exports-something');

console.log(test_value); // 'Hello, extensions!'
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
