## Extensions - the `data` extension

The `data` extension can be imported in custom extensions for access
to the database and key-value store.

You can import these from `'data'`:
- `db` - Puter's main SQL database
- `kv` - A persistent key-value store
- `cache` - In-memory [kv.js](https://github.com/HeyPuter/kv.js/) store

```javascript
const { db, kv, cache } = extension.import('data');
```

### Database (`db`)

Don't forget to import it first!
```javascript
const { db } = extension.import('data');
```

#### `db.read`

Usage:

```javascript
const rows = await db.read('SELECT * FROM apps WHERE `name` = ?', [
    'editor'
]);
```
#### `db.write`

Usage:

```javascript
const {
    insertId,        // internal ID of new row (if this is an INSERT)
    anyRowsAffected, // true if 1 or more rows were affected
} = await db.write(
    // A query like INSERT, UPDATE, DELETE, etc...
    'INSERT INTO example_table (a, b, c) VALUES (?, ?, ?)',
    // Parameters (all user input should go here)
    [
        "Value for column a",
        "Value for column b",
        "Value for column c",
    ]
);
```

### Persistent KV Store (`kv`)

Don't forget to import it first!
```javascript
const { kv } = extension.import('data');
```

#### `kv.get({ key })`

```javascript
// Short-Form (like kv.js)
const someValue = kv.get('some-key');

// Long-Form (the `puter-kvstore` driver interface)
const someValue = kv.get({ key: 'some-key' });
```

#### `kv.set({ key, value })`

```javascript
await kv.set('some-key', 'some value');

// or...

await kv.set({
    key: 'some-key',
    value: 'some value',
});
```

#### `kv.expire({ key, ttl })`

This key will persist for 20 minutes, even if the server restarts.

```javascript
kv.expire({
    key: 'some-key',
    ttl: 1000 * 60 * 20, // 1 minute
});
```

### `kv.expireAt({ key, timestamp })`

The following example expires a key 1 second before
["the apocalypse"](https://en.wikipedia.org/wiki/Year_2038_problem).
(don't worry, KV won't break in 2038)

```javascript
kv.expireAt(
    key: 'some-key',
    // Expires Jan 19 2038 3:14:07 GMT
    timestamp: 2147483647,
);
```

### In-Memory Cache (`cache`)

Don't forget to import it first!
```javascript
const { cache } = extension.import('data');
```

The in-memory cache is provided by [kv.js](https://github.com/HeyPuter/kv.js).
Below is a simple example.
For comprehensive documentation, see the [kv.js repository's readme](https://github.com/HeyPuter/kv.js/blob/main/README.md).

```javascript
const { cache } = extension.require('data');

cache.set('some-key', 'some value');
const value = cache.get('some-key'); // some value

// This value only exists for 5 minutes
cache.set('temporary', 'abcdefg', { EX: 5 * 60 });

cache.incr('qwerty'); // cache.get('qwerty') is now: 1
cache.incr('qwerty'); // cache.get('qwerty') is now: 2
```
