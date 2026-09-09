---
title: puter.teams.create()
description: Create a team that pays for other Puter accounts.
platforms: [websites, apps]
---

<div class="info">The Teams API is in beta. Method shapes, limits, and behavior may change between releases.</div>

Creates a team owned by the caller, who becomes its owner account.

The caller's email must be confirmed. Teams must be turned on for the deployment; where they are not, this rejects with `not_found`.

## Syntax

```js
puter.teams.create(options)
```

## Parameters

#### `options.name` (String) (required)

The team's display name.

#### `options.handle` (String | null) (optional)

A short handle, made of lowercase letters and digits separated by single hyphens, 3 to 64 characters. It must be free across the whole deployment, and a set of reserved words is refused. Omit it or pass `null` for none.

## Return value

A `Promise` that resolves to a [`Team`](/Teams/#team).

Rejects with `invalid_request` if `name` is blank, `bad_request` if the handle is malformed or reserved, and `conflict` if the handle is taken.

## Examples

<strong class="example-title">Create a team</strong>

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            const team = await puter.teams.create({
                name: 'Acme',
                handle: 'acme-' + Math.random().toString(36).slice(2, 8),
            });
            puter.print(`Created ${team.name} (${team.uid})`);
        })();
    </script>
</body>
</html>
```
