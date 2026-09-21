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

The standard list options. All four are optional, and they decide the shape of what resolves:

| Call | Resolves to |
| -- | -- |
| No options | The whole set as an array, fetched page by page under the hood |
| `{ limit }` | An array, capped at one page |
| `{ cursor }` or `{ includeTotal: true }` | One `{ items, cursor? }` page. `cursor` is absent on the last page |
| `{ stream: true }` | An async iterator of `{ items, cursor? }` pages |

This route is keyset-paginated, so `offset` is not accepted — passing it throws `invalid_request`. Pass `cursor` to resume from a position.

## Return value

A `Promise` that resolves to an array of
`TeamDirectoryEntry` objects, or to a
`{ items, cursor? }` page when a pagination option is given. With
`stream: true` it returns an async iterator of pages instead.

#### `TeamDirectoryEntry`

| Field | Type | Description |
| -- | -- | -- |
| `username` | `string` | A colleague's Puter username. |
| `uuid` | `string` | Their stable account identifier. |

## Errors

A rejection carries an `Error` with a stable `code`:

| Code | Meaning |
| -- | -- |
| `invalid_request` | Refused before reaching the server — a blank `uid`, or an `offset` on a keyset list. |
| `unauthorized` | Not signed in. |
| `account_is_not_verified` | The caller's email has not been confirmed. |
| `not_found` | Teams are turned off on this deployment. |
| `team_not_found` | No such team, the caller is not a member of it, or the owner has not opened the directory to apps. |
| `too_many_requests` | The rate limit was exceeded. See [Rate Limits & Quotas](/rate-limits-and-quotas/). |

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
