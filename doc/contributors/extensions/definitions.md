## Definitions

### `core.config` - Configuration

Puter's configuration object. This includes values from `config.json` or their
defaults, and computed values like `origin` and `api_origin`.

```javascript
const config = use('core.config');

extension.get('/get-origin', { noauth: true }, (req, res) => {
    res.send(config.origin);
})
```

### `core.util.*` - Utility Functions

These utilities come from `src/backend/src/util` in Puter's repo.
Each file in this directory has its exports auto-loaded into this
namespace. For example, `src/backend/src/util/langutil.js` is available
via `use('core.util.langutil')` or `use.core.util.langutil`.

#### `core.util.helpers` - Helper Functions

Common utility functions used throughout Puter's backend. Use with caution as
some of these functions may be deprecated.

> **note:** the following documentation is incomplete

#### `core.util.langutil` - Language Helpers

##### `whatis(thing :any)`

- Returns `"array"` if `thing` is an array.
- Returns `"null"` if `thing` is `null`.
- Returns `typeof thing` for any other case.

##### `nou(value :any)`

Simply a "null or undefined" check.

##### `can(value :any, capabilities :Array<string>)`

Checks if something has the specified capabilities. At the time of
writing the only one supported is `iterate`, which will check if
`value[Symbol.iterator]` is truthy
