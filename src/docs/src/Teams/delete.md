---
title: puter.teams.delete()
description: Delete a team. The accounts it paid for keep existing.
platforms: [websites, apps]
---

<div class="info">The Teams API is in beta. Method shapes, limits, and behavior may change between releases.</div>

Deletes a team. Owner account only.

**The accounts the team provisioned are not deleted.** What stops is the team paying for them, so the per-account charges end and the storage charges do not. Its handle is released, and its [audit log](/Teams/listAudit/) stays readable to the owner account afterwards.

## Syntax

```js
puter.teams.delete(uid)
```

## Parameters

#### `uid` (String) (required)

The team's identifier.

## Return value

A `Promise` that resolves to nothing once the team is gone.

Rejects with `not_the_team_owner` if the caller is not the owner account.

## Examples

<strong class="example-title">Create a team then delete it</strong>

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            const team = await puter.teams.create({ name: 'Temporary' });
            puter.print(`Created ${team.uid}<br>`);
            await puter.teams.delete(team.uid);
            puter.print('Deleted. Any accounts it provisioned still exist.');
        })();
    </script>
</body>
</html>
```
