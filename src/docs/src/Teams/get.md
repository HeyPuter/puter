---
title: puter.teams.get()
description: Get one team by its uid.
platforms: [websites, apps]
---

<div class="info">The Teams API is in beta. Method shapes, limits, and behavior may change between releases.</div>

Returns one team the caller belongs to.

## Syntax

```js
puter.teams.get(uid)
```

## Parameters

#### `uid` (String) (required)

The team's identifier, as returned by [`create()`](/Teams/create/) or [`list()`](/Teams/list/). Handles are not accepted — see [`uid`, not `handle`](/Teams/#uid-not-handle).

## Return value

A `Promise` that resolves to a [`Team`](/Teams/#team).

Rejects with `team_not_found` if the team does not exist or the caller is not a member. The two are not distinguished, so this cannot be used to probe for teams the caller has nothing to do with.

## Examples

<strong class="example-title">Read a team back</strong>

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            const [first] = await puter.teams.list();
            if (!first) return puter.print('No team.');
            const team = await puter.teams.get(first.uid);
            puter.print(`${team.name} (@${team.handle ?? 'no handle'})`);
        })();
    </script>
</body>
</html>
```
