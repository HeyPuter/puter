---
title: puter.teams.list()
description: List the teams you belong to.
platforms: [websites, apps]
---

<div class="info">The Teams API is in beta. Method shapes, limits, and behavior may change between releases.</div>

Returns the teams the caller belongs to — both those they own and those they were provisioned into.

This is also how an app discovers whether teams exist on this deployment at all: it rejects with `not_found` where the feature is off, and resolves to an empty array where it is on and the caller has no team.

## Syntax

```js
puter.teams.list()
puter.teams.list(options)
```

## Parameters

#### `options` (Object) (optional)

The standard list options — `limit`, `cursor`, `includeTotal` and `stream`. See [Pagination](/Teams/#pagination) for what each form returns. `offset` is not accepted.

## Return value

A `Promise` that resolves to an array of [`Team`](/Teams/#team) objects, or to a `{ items, cursor? }` page when a pagination option is given. With `stream: true` it returns an async iterator of pages instead.

## Examples

<strong class="example-title">Show the caller's teams, or nothing where the feature is off</strong>

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            let teams = [];
            try {
                teams = await puter.teams.list();
            } catch (e) {
                puter.print('Teams are not available here.');
                return;
            }
            if (teams.length === 0) {
                puter.print('You are not in a team.');
                return;
            }
            for (const team of teams) {
                puter.print(`${team.name} - ${team.isOwner ? 'owner' : 'member'}<br>`);
            }
        })();
    </script>
</body>
</html>
```
