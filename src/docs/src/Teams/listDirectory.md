---
title: puter.teams.listDirectory()
description: Look up the user's colleagues, where the team has opened its directory to apps.
platforms: [websites, apps]
---

<div class="info">The Teams API is in beta. Method shapes, limits, and behavior may change between releases.</div>

Returns the team's member directory — the colleagues of the user your app is
running for. This is the one team route an app may call, and it is
consent-gated: the team's owner has to open the directory to apps, and until
they do it answers `team_not_found`, indistinguishable from the team not
existing.

The membership is always the signed-in user's, never the app's: an app can only
see the directory of a team its user belongs to.

## Syntax

```js
puter.teams.listDirectory(uid)
puter.teams.listDirectory(uid, options)
```

## Parameters

#### `uid` (String) (required)

The team's `uid`, from [`list()`](/Teams/list/).

#### `options` (Object) (optional)

The standard list options — `limit`, `cursor`, `includeTotal` and `stream`. See
[Pagination](/Teams/#pagination) for what each form returns. `offset` is not
accepted.

## Return value

A `Promise` that resolves to an array of
[`TeamDirectoryEntry`](/Teams/#teamdirectoryentry) objects, or to a
`{ items, cursor? }` page when a pagination option is given. With
`stream: true` it returns an async iterator of pages instead.

## Examples

<strong class="example-title">Suggest colleagues to share with</strong>

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
                return; // Teams are unavailable here.
            }
            for (const team of teams) {
                try {
                    const colleagues = await puter.teams.listDirectory(team.uid);
                    for (const person of colleagues) {
                        puter.print(`${person.username}<br>`);
                    }
                } catch (e) {
                    // This team's directory is not open to apps.
                }
            }
        })();
    </script>
</body>
</html>
```
