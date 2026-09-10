---
title: puter.teams.createMember()
description: Provision a new Puter account owned by a team.
platforms: [websites, apps]
---

<div class="info">The Teams API is in beta. Method shapes, limits, and behavior may change between releases.</div>

Provisions a new Puter account that the team owns and pays for. Owner account only.

There is no role to pick: every provisioned account is an ordinary member.

**The password comes back once.** It is not stored anywhere retrievable and there is no second chance to read it — deliver it to the member out of band. The member must change it at first sign-in. If it is lost before then, [`resendActivation()`](/Teams/resendActivation/) issues a fresh one.

## Syntax

```js
puter.teams.createMember(uid, options)
```

## Parameters

#### `uid` (String) (required)

The team's identifier.

#### `options.username` (String) (required)

The username for the new account. Usernames come from the same pool as ordinary sign-ups, so it must be free across the whole of Puter.

#### `options.email` (String) (optional)

Where this account's notices are delivered. These accounts sign in by **username**, so an address is optional.

Give one and the member is emailed their username and temporary password directly, and later notices (`team_account_disabled`, `team_password_reset`) reach them too. Leave it out and nothing is sent — the temporary password in the return value is then the only copy, so hand it over before you lose it. If given, it must not already own an account.

The account is never asked to confirm the address — the team creating it is the trust anchor — so it can be used immediately either way. An account with no address is recoverable only through its team's owner, via `resetPassword`.

## Return value

A `Promise` that resolves to `{ username, temporaryPassword }`.

Rejects with `username_already_in_use` — with free alternatives in `fields.suggestions` — or `email_already_in_use`.

## Examples

<strong class="example-title">Add an account to a team</strong>

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            const [team] = await puter.teams.list();
            if (!team) return puter.print('No team.');
            const name = 'member' + Math.random().toString(36).slice(2, 8);
            const account = await puter.teams.createMember(team.uid, {
                username: name,
            });
            // Shown once; hand it over out of band.
            puter.print(`${account.username}: ${account.temporaryPassword}`);
        })();
    </script>
</body>
</html>
```
