---
title: puter.teams.listMembers()
description: List the accounts belonging to a team.
platforms: [websites, apps]
---

<div class="info">The Teams API is in beta. Method shapes, limits, and behavior may change between releases.</div>

Returns the accounts belonging to a team, including the owner account.

Any member may call it. The response carries no email address, activation state or usage — those stay on the administrative methods.

## Syntax

```js
puter.teams.listMembers(uid)
puter.teams.listMembers(uid, options)
```

## Parameters

#### `uid` (String) (required)

The team's identifier.

#### `options` (Object) (optional)

The standard list options — `limit`, `cursor`, `includeTotal` and `stream`. See [Pagination](/Teams/#pagination). `offset` is not accepted.

## Return value

A `Promise` that resolves to an array of [`TeamMember`](/Teams/#teammember) objects, or to a `{ items, cursor? }` page when a pagination option is given. With `stream: true` it returns an async iterator of pages instead.

## Examples

<strong class="example-title">List everyone in the first team</strong>

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            const [team] = await puter.teams.list();
            if (!team) return puter.print('No team.');
            for (const member of await puter.teams.listMembers(team.uid)) {
                puter.print(`${member.username}${member.orgOwned ? ' (provisioned)' : ''}<br>`);
            }
        })();
    </script>
</body>
</html>
```
