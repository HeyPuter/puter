# Puter Backend Extensions

## Extension Completion Checklist

Extensions are under refactor currently. This is the checklist:
- [x] Add RuntimeModule construct for imports and exports
- [ ] Remove `registry` system added earlier
      (the same thing can be accomplished with events)
- [ ] Add the ability to target specific extensions when
      emitting events
- [ ] Add event name aliasing and configurable import mapping
- [ ] Extract extension loading from the core

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
