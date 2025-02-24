# Puter Extensions

## Quickstart

Create and edit this file: `mods/mods_enabled/hello-puter.js`

```javascript
const { UserActorType, AppUnderUserActorType } = use.core;

extension.get('/hello-puter', (req, res) => {
    const actor = req.actor;
    let who = 'unknown';
    if ( actor.type instanceof UserActorType ) {
        who = actor.type.user.username;
    }
    if ( actor.type instanceof AppUnderUserActorType ) {
        who = actor.type.app.name + ' on behalf of ' + actor.type.user.username;
    }
    res.send(`Hello, ${who}!`);
});
```

## Events

//

This is subject to change as we make efforts to simplify the process.

### Step 1: Configure a Mod Directory

Add this to your config:
```json
"mod_directories": [
    "{source}/../mods/mods_available"
]
```

This adds the `mods/mods_available` directory to this 
