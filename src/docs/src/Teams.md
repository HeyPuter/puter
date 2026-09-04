---
title: Teams
description: Administer a Puter team and the accounts it pays for with the Teams API
platforms: [websites, apps]
---

<div class="info">The Teams API is in beta. Method shapes, limits, and behavior may change between releases.</div>

A team is an account that pays for other accounts. One owner account creates it, provisions member accounts, and can suspend or restore them. Members are ordinary Puter accounts — there are no roles to assign, and the team never gains access to a member's files.

`puter.teams` is the administrative surface for that. Every method takes a team `uid`.

```js
const team = await puter.teams.create({ name: 'Acme', handle: 'acme' });
await puter.teams.createMember(team.uid, { username: 'ann', email: 'ann@example.com' });
const members = await puter.teams.listMembers(team.uid);
```

## Availability

Teams are an opt-in deployment feature. Where they are turned off, the routes behind `puter.teams` do not exist and every method rejects with `not_found`.

`puter.teams.list()` is how an app tells the two apart: it rejects when the feature is off, and resolves to an empty array when it is on and the caller has no team.

```js
let teams = [];
try {
    teams = await puter.teams.list();
} catch (e) {
    // Teams are unavailable here; show nothing.
}
```

## `uid`, not `handle`

A team has both a `uid` and an optional `handle`. Only the `uid` is stable.

A `handle` is a label: [`update()`](/Teams/update/) can change it, and deleting the team releases it for anyone else to take. A stored handle can therefore stop resolving — or, worse, start resolving to a different team. Display the `name` and `handle`; pass the `uid`.

## Methods

### Teams

| Method | Who can call it |
| -- | -- |
| [`create(options)`](/Teams/create/) | Any verified account |
| [`list(options)`](/Teams/list/) | Any member, for their own teams |
| [`get(uid)`](/Teams/get/) | Any member |
| [`update(uid, attributes)`](/Teams/update/) | Owner account |
| [`delete(uid)`](/Teams/delete/) | Owner account |

### Accounts

| Method | Who can call it |
| -- | -- |
| [`listMembers(uid, options)`](/Teams/listMembers/) | Any member |
| [`createMember(uid, options)`](/Teams/createMember/) | Owner account |
| [`resendActivation(uid, username)`](/Teams/resendActivation/) | Owner account |
| [`disableMember(uid, username)`](/Teams/disableMember/) | Owner account |
| [`enableMember(uid, username)`](/Teams/enableMember/) | Owner account |
| [`resetPassword(uid, username)`](/Teams/resetPassword/) | Owner account |
| [`deleteMemberAccount(uid, username)`](/Teams/deleteMemberAccount/) | Owner account |

### Audit

| Method | Who can call it |
| -- | -- |
| [`listAudit(uid, options)`](/Teams/listAudit/) | Owner account |
| [`listOwnAudit(uid, options)`](/Teams/listOwnAudit/) | Any member, for their own entries |

## Pagination

`list()`, `listMembers()`, `listAudit()` and `listOwnAudit()` all take the same options and offer the same three forms:

| Call | Resolves to |
| -- | -- |
| No options | The whole set as an array, fetched page by page under the hood |
| `{ cursor }` or `{ includeTotal: true }` | One `{ items, cursor? }` page. `cursor` is absent on the last page |
| `{ stream: true }` | An async iterator of `{ items, cursor? }` pages |

`{ limit }` on its own still resolves to an array, capped at one page.

These routes are keyset-paginated, so `offset` is not accepted — passing it throws `invalid_request`. Pass `cursor` to resume from a position.

```js
// Every member, however many pages it takes.
const all = await puter.teams.listMembers(uid);

// One page at a time.
let cursor = null;
do {
    const page = await puter.teams.listMembers(uid, { limit: 50, cursor });
    cursor = page.cursor;
} while (cursor);

// Or as a stream.
for await (const page of puter.teams.listMembers(uid, { stream: true })) {
    console.log(page.items);
}
```

## Objects

#### `Team`

| Field | Type | Description |
| -- | -- | -- |
| `uid` | `string` | The team's stable identifier. |
| `name` | `string \| null` | Its display name. |
| `handle` | `string \| null` | Its short handle, unique while it exists. |
| `isOwner` | `boolean` | Whether the caller is the owner account. |
| `createdAt` | `string` | When it was created. |

#### `TeamMember`

| Field | Type | Description |
| -- | -- | -- |
| `username` | `string` | The member's Puter username. |
| `orgOwned` | `boolean` | Whether the team provisioned and pays for this account. |
| `createdAt` | `string` | When the account joined the team. |

#### `TeamAuditEntry`

| Field | Type | Description |
| -- | -- | -- |
| `action` | `string` | What was done, e.g. `provision`, `disable`, `enable`, `delete_team`. |
| `reason` | `string \| null` | The reason recorded with the action, when one was given. |
| `username` | `string \| null` | The account it was about. |
| `actorUsername` | `string \| null` | Who did it. `null` when Puter itself did. |
| `createdAt` | `string` | When it happened. |

## Errors

Every method rejects with an `Error` carrying a stable `code`:

| Code | Meaning |
| -- | -- |
| `invalid_request` | The call was refused before reaching the server — a missing `name`, a blank `uid`, an `offset` on a keyset list. |
| `bad_request` | The server refused the input, e.g. an invalid username or email. |
| `unauthorized` | Not signed in, or signing in with an app or API token rather than a user session. |
| `account_is_not_verified` | The caller's email has not been confirmed. Every `/teams` route requires it. |
| `permission_denied` | Signed in, but not the owner account of this team. |
| `not_found` | No such team, or teams are turned off on this deployment. |
| `team_not_found` | No such team, or the caller is not a member of it. |
| `not_an_org_account` | The named account is not a member of this team. |
| `conflict` | The account has already been activated, so its credential cannot be reissued. |
| `username_already_in_use` | The requested username is taken. The error carries `fields.suggestions` with free alternatives. |
| `email_already_in_use` | The address already owns an account. |
| `too_many_requests` | The rate limit was exceeded. See [Rate Limits & Quotas](/rate-limits-and-quotas/). |

## What is deliberately absent

- **No roles.** The owner account is the sole administrator; every other account is an ordinary member.
- **No way to change a member's email or username.** After activation a member changes their own email, which re-verifies the holder. An administrator able to move the address could redirect a credential to themselves.
- **No per-app usage breakdown.** Which applications a person uses is a fact about them, not about the bill.
- **No sharing-policy controls.** A team cannot restrict who its members share with: there is no external-sharing policy, no domain allowlist, and no control over public links. A member shares exactly as any other Puter user does, with anyone. This is the assumption most teams bring the other way round, so it is worth stating plainly before you rely on it.
