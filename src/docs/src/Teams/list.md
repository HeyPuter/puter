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

The standard list options. All four are optional, and they decide the shape of what resolves:

| Call | Resolves to |
| -- | -- |
| No options | The whole set as an array, fetched page by page under the hood |
| `{ limit }` | An array, capped at one page |
| `{ cursor }` or `{ includeTotal: true }` | One `{ items, cursor? }` page. `cursor` is absent on the last page |
| `{ stream: true }` | An async iterator of `{ items, cursor? }` pages |

This route is keyset-paginated, so `offset` is not accepted — passing it throws `invalid_request`. Pass `cursor` to resume from a position.

## Return value

A `Promise` that resolves to an array of `Team` objects, or to a `{ items, cursor? }` page when a pagination option is given. With `stream: true` it returns an async iterator of pages instead.

#### `Team`

| Field | Type | Description |
| -- | -- | -- |
| `uid` | `string` | The team's stable identifier — pass this, not the handle. |
| `name` | `string \| null` | Its display name. |
| `handle` | `string \| null` | Its short handle, unique while the team exists. |
| `isOwner` | `boolean` | Whether the caller is the owner account. |
| `createdAt` | `string` | When it was created. |

## Errors

A rejection carries an `Error` with a stable `code`:

| Code | Meaning |
| -- | -- |
| `invalid_request` | Refused before reaching the server — a blank `uid`, or an `offset` on a keyset list. |
| `unauthorized` | Not signed in. |
| `account_is_not_verified` | The caller's email has not been confirmed. |
| `not_found` | Teams are turned off on this deployment. |
| `too_many_requests` | The rate limit was exceeded. See [Rate Limits & Quotas](/rate-limits-and-quotas/). |

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
