---
title: puter.teams.listAudit()
description: Read a team's record of what it did to its accounts.
platforms: [websites, apps]
---

<div class="info">The Teams API is in beta. Method shapes, limits, and behavior may change between releases.</div>

Returns everything the team has done to its accounts, newest first. Owner account only.

The log is insert-only and survives the team: after [`delete()`](/Teams/delete/) the owner account can still read it, which is the point of keeping it.

## Syntax

```js
puter.teams.listAudit(uid)
puter.teams.listAudit(uid, options)
```

## Parameters

#### `uid` (String) (required)

The team's identifier.

#### `options` (Object) (optional)

The standard list options — `limit`, `cursor`, `includeTotal` and `stream`. See [Pagination](/Teams/#pagination). `offset` is not accepted.

## Return value

A `Promise` that resolves to an array of [`TeamAuditEntry`](/Teams/#teamauditentry) objects, or to a `{ items, cursor? }` page when a pagination option is given. With `stream: true` it returns an async iterator of pages instead.

Rejects with `not_the_team_owner` if the caller is a member rather than the owner account. Members read their own entries with [`listOwnAudit()`](/Teams/listOwnAudit/).

## Examples

<strong class="example-title">Show what a team has done</strong>

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            const [team] = await puter.teams.list();
            if (!team) return puter.print('No team.');
            for (const entry of await puter.teams.listAudit(team.uid)) {
                puter.print(`${entry.createdAt} ${entry.actorUsername} ${entry.action} ${entry.username}<br>`);
            }
        })();
    </script>
</body>
</html>
```
