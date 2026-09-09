---
title: puter.teams.listOwnAudit()
description: Read what a team did to your own account.
platforms: [websites, apps]
---

<div class="info">The Teams API is in beta. Method shapes, limits, and behavior may change between releases.</div>

Returns the caller's own entries in a team's audit log — what the team did to their account, and who did it. Any member may call it.

It exists so that being administered is not something that happens invisibly. It shows only the caller's entries; the whole log is [`listAudit()`](/Teams/listAudit/), which is owner-account only.

## Syntax

```js
puter.teams.listOwnAudit(uid)
puter.teams.listOwnAudit(uid, options)
```

## Parameters

#### `uid` (String) (required)

The team's identifier.

#### `options` (Object) (optional)

The standard list options — `limit`, `cursor`, `includeTotal` and `stream`. See [Pagination](/Teams/#pagination). `offset` is not accepted.

## Return value

A `Promise` that resolves to an array of [`TeamAuditEntry`](/Teams/#teamauditentry) objects, or to a `{ items, cursor? }` page when a pagination option is given. With `stream: true` it returns an async iterator of pages instead.

## Examples

<strong class="example-title">Show what was done to your own account</strong>

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            const [team] = await puter.teams.list();
            if (!team) return puter.print('Not in a team.');
            const entries = await puter.teams.listOwnAudit(team.uid);
            if (entries.length === 0) return puter.print('Nothing has been done to your account.');
            for (const entry of entries) {
                puter.print(`${entry.createdAt} - ${entry.action} by ${entry.actorUsername}<br>`);
            }
        })();
    </script>
</body>
</html>
```
