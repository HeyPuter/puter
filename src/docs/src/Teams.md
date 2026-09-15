---
title: Teams
description: Detect team context and look up a user's colleagues with the Teams API
platforms: [websites, apps]
---

<div class="info">The Teams API is in beta. Method shapes, limits, and behavior may change between releases.</div>

A team is a Puter account that pays for other accounts. Members are ordinary
Puter accounts — your app talks to them like any other user, and the team never
gains access to a member's files.

Team *administration* — creating teams, provisioning accounts, suspending them —
happens in the account console, not through apps: those routes refuse app and
API-token callers outright. What `puter.teams` offers an app is the read-only
context around the user in front of it.

```js
const teams = await puter.teams.list();
const colleagues = await puter.teams.listDirectory(teams[0]?.uid);
```

## Availability

Teams are an opt-in deployment feature. Where they are turned off, the routes
behind `puter.teams` do not exist and every method rejects with `not_found`.

`puter.teams.list()` is how an app tells the two apart: it rejects when the
feature is off, and resolves to an empty array when it is on and the caller has
no team.

```js
let teams = [];
try {
    teams = await puter.teams.list();
} catch (e) {
    // Teams are unavailable here; show nothing.
}
```

## `uid`, not `handle`

A team has both a `uid` and an optional `handle`. Only the `uid` is stable: a
handle is a mutable label, and deleting the team releases it for anyone else to
take. Display the `name` and `handle`; pass the `uid`.

## Methods

| Method | Returns |
| -- | -- |
| [`list(options)`](/Teams/list/) | The caller's teams |
| [`listDirectory(uid, options)`](/Teams/listDirectory/) | The team's member directory, where the owner has opened it to apps |

## Sharing with a team

A team can receive a share like a person can — one grant reaches every member,
including anyone added later. Pass the team's `uid` as the recipient:

```js
await puter.fs.share({ path, recipient: { team: team.uid }, mode: 'read' });
```

See [`puter.fs.share()`](/FS/share/) for the full sharing API.

## Pagination

`list()` and `listDirectory()` take the same options and offer the same three
forms:

| Call | Resolves to |
| -- | -- |
| No options | The whole set as an array, fetched page by page under the hood |
| `{ cursor }` or `{ includeTotal: true }` | One `{ items, cursor? }` page. `cursor` is absent on the last page |
| `{ stream: true }` | An async iterator of `{ items, cursor? }` pages |

`{ limit }` on its own still resolves to an array, capped at one page.

These routes are keyset-paginated, so `offset` is not accepted — passing it
throws `invalid_request`. Pass `cursor` to resume from a position.

## Objects

#### `Team`

| Field | Type | Description |
| -- | -- | -- |
| `uid` | `string` | The team's stable identifier. |
| `name` | `string \| null` | Its display name. |
| `handle` | `string \| null` | Its short handle, unique while it exists. |
| `isOwner` | `boolean` | Whether the caller is the owner account. |
| `createdAt` | `string` | When it was created. |

#### `TeamDirectoryEntry`

| Field | Type | Description |
| -- | -- | -- |
| `username` | `string` | A colleague's Puter username. |
| `uuid` | `string` | Their stable account identifier. |

## Errors

Every method rejects with an `Error` carrying a stable `code`:

| Code | Meaning |
| -- | -- |
| `invalid_request` | The call was refused before reaching the server — a blank `uid`, an `offset` on a keyset list. |
| `unauthorized` | Not signed in. |
| `account_is_not_verified` | The caller's email has not been confirmed. |
| `not_found` | Teams are turned off on this deployment. |
| `team_not_found` | No such team, the caller is not a member of it, or its directory is not open to apps. |
| `too_many_requests` | The rate limit was exceeded. See [Rate Limits & Quotas](/rate-limits-and-quotas/). |

## What is deliberately absent

- **No sharing-policy controls.** A team cannot restrict who its members share
  with: there is no external-sharing policy, no domain allowlist, and no control
  over public links. A member shares exactly as any other Puter user does, with
  anyone. This is the assumption most teams bring the other way round, so it is
  worth stating plainly before you rely on it.
- **No administration from apps.** Provisioning, suspension, credentials and
  audit belong to the account console; apps and API tokens are refused there.
