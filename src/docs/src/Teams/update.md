---
title: puter.teams.update()
description: Rename a team or change its handle.
platforms: [websites, apps]
---

<div class="info">The Teams API is in beta. Method shapes, limits, and behavior may change between releases.</div>

Renames a team or changes its handle. Owner account only.

Changing a handle frees the old one for anyone else to claim, so nothing should store a handle as a reference to a team.

## Syntax

```js
puter.teams.update(uid, attributes)
```

## Parameters

#### `uid` (String) (required)

The team's identifier.

#### `attributes.name` (String) (optional)

A new display name.

#### `attributes.handle` (String | null) (optional)

A new handle, or `null` to release the current one. Omitting the field leaves the handle alone; that is different from passing `null`.

## Return value

A `Promise` that resolves to the updated [`Team`](/Teams/#team).

Rejects with `not_the_team_owner` if the caller is a member rather than the owner account, and `conflict` if the handle is taken.

## Examples

<strong class="example-title">Rename a team and release its handle</strong>

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            const [team] = await puter.teams.list();
            if (!team) return puter.print('No team.');
            const renamed = await puter.teams.update(team.uid, { name: 'Acme Inc' });
            puter.print(`Now called ${renamed.name}<br>`);
            const released = await puter.teams.update(team.uid, { handle: null });
            puter.print(`Handle is now ${released.handle}`);
        })();
    </script>
</body>
</html>
```
