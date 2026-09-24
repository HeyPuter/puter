---
title: puter.teams.listMembers()
description: List a team's accounts.
platforms: [websites, apps, nodejs, workers]
---

<div class="info">The Teams API is in beta. Method shapes, limits, and behavior may change between releases.</div>

Returns a team's accounts, owner included, whether provisioned by the team or
joined from an existing account.

Called from an app, it needs the same consent as
[`listDirectory()`](/Teams/listDirectory/): until the team's owner opens the
directory to apps it rejects with `team_not_found`, indistinguishable from the
team not existing. An app also sees only active accounts: suspended seats and
seats that have not activated yet are left out, and each `TeamMember` carries
only `username` — no `orgOwned`, `createdAt`, or `uuid`. Called with the
user's own session or API token, it lists every account whatever the
directory setting, with the full `TeamMember` shape.

The membership is always the signed-in user's, never the app's: an app can
only see the members of a team its user belongs to.

## Syntax

```js
puter.teams.listMembers(uid)
puter.teams.listMembers(uid, options)
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
`TeamMember` objects, or to a
`{ items, cursor? }` page when a pagination option is given. With
`stream: true` it returns an async iterator of pages instead.

#### `TeamMember`

| Field | Type | Description |
| -- | -- | -- |
| `username` | `string` | The member's Puter username. |
| `orgOwned` | `boolean` (optional) | Whether the team provisioned and pays for this account, as opposed to a pre-existing account that joined it. Absent when an app calls: it gets `username` only. |
| `createdAt` | `string` (optional) | When the account joined the team. Absent when an app calls. |
| `uuid` | `string` (optional) | The account's stable identifier. Present only when the team owner calls with their own session or API token. |

## Errors

A rejection carries an `Error` with a stable `code`:

| Code | Meaning |
| -- | -- |
| `invalid_request` | Refused before reaching the server — a blank `uid`, or an `offset` on a keyset list. |
| `token_missing` | No authentication token was presented. |
| `token_auth_failed` | The token presented did not authenticate. |
| `forbidden` | Called with a scoped access token. |
| `account_is_not_verified` | The caller's email has not been confirmed. |
| `not_found` | Teams are turned off on this deployment. |
| `team_not_found` | No such team, the caller is not a member of it, or — for an app — the owner has not opened the directory to apps. |
| `too_many_requests` | The rate limit was exceeded. See [Rate Limits & Quotas](/rate-limits-and-quotas/). |

## Examples

<strong class="example-title">List a team's accounts</strong>

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            const [team] = await puter.teams.list();
            if ( ! team ) return puter.print('Not on a team');

            const members = await puter.teams.listMembers(team.uid);
            for (const member of members) {
                puter.print(`${member.username}${member.orgOwned ? ' (seat)' : ''}<br>`);
            }
        })();
    </script>
</body>
</html>
```
