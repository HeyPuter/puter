## Extensions - Importing & Exporting

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

