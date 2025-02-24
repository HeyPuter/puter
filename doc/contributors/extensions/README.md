# Puter Extensions

## Quickstart

Create and edit this file: `mods/mods_enabled/hello-puter.js`

```javascript
// You can get definitions exposed by Puter via `use`
const { UserActorType, AppUnderUserActorType } = use.core;

// Endpoints can be registered directly on an extension
extension.get('/hello-puter', (req, res) => {
    const actor = req.actor;
    

    // Make a string "who" which says:
    //   "<username>", or:
    //   "<app> acting on behalf of <username>"
    let who = 'unknown';
    if ( actor.type instanceof UserActorType ) {
        who = actor.type.user.username;
    }
    if ( actor.type instanceof AppUnderUserActorType ) {
        who = actor.type.app.name
            + ' on behalf of '
            + actor.type.user.username;
    }

    res.send(`Hello, ${who}!`);
});

// Extensions can listen to events and manipulate Puter's behavior
extension.on('core.email.validate', event => {
    if ( event.email.includes('evil') ) {
        event.allow = false;
    }
});
```

### Scope of `extension` and `use`

It is important to know that the `extension` global is temporary and does not
exist after your extension is loaded. If you wish to access the extension
object within a callback you will need to first bind it to a variable in
your extension's scope.

```javascript
const ext = extension;
extension.on('some-event', () => {
    // This would throw an error
    // extension.something();

    // This works
    ext.example();
})
```

The same is true for `use`. Calls to `use` should happen at the top of
the file, just like imports in ES6.

## Database Access

A database access object is provided to the extension via `extension.db`.
You **must** scope `extension` to another variable (`ext` in this example)
in order to access `db` from callbacks.

```javascript
const ext = extension;

extension.get('/user-count', { noauth: true }, (req, res) => {
    const [count] = await ext.db.read(
        'SELECT COUNT(*) as c FROM `user`'
    );
});
```

The database access object has the following methods:
- `read(query, params)` - read from the database using a prepared statement. If read-replicas are enabled, this will use a replica.
- `write(query, params)` - write to the database using a prepared statement. If read-replicas are enabled, this will write to the primary.
- `pread(query, params)` - read from the database using a prepared statement. If read-replicas are enabled, this will read from the primary.
- `requireRead(query, params)` - read from the database using a prepared statement. If read-replicas are enabled, this will try reading from the replica first. If there are no results, a second attempt will be made on the primary.

## Events

See [events.md](./events.md)

## Definitions

See [definitions.md](./definitions.md)
