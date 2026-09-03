---
title: puter.teams.disableMember()
description: Suspend an account a team owns.
platforms: [websites, apps]
---

<div class="info">The Teams API is in beta. Method shapes, limits, and behavior may change between releases.</div>

Suspends an account the team owns, ending its sessions. Owner account only, and reversible with [`enableMember()`](/Teams/enableMember/).

**A disabled account still costs the team money.** The per-account charge stops; the charge for the bytes it holds does not. To stop that, its files have to go.

## Syntax

```js
puter.teams.disableMember(uid, username)
```

## Parameters

#### `uid` (String) (required)

The team's identifier.

#### `username` (String) (required)

The member's username. It must be an account this team provisioned — a pre-existing account that joined cannot be suspended by the team.

## Return value

A `Promise` that resolves to nothing once the account is suspended.

Rejects with `not_an_org_account` if the account does not belong to this team, and `not_the_team_owner` if the caller is not the owner account.

## Examples

<strong class="example-title">Suspend and restore an account</strong>

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            const [team] = await puter.teams.list();
            if (!team) return puter.print('No team.');
            const name = 'member' + Math.random().toString(36).slice(2, 8);
            await puter.teams.createMember(team.uid, { username: name, email: `${name}@example.com` });

            await puter.teams.disableMember(team.uid, name);
            puter.print(`${name} suspended<br>`);

            await puter.teams.enableMember(team.uid, name);
            puter.print(`${name} restored`);
        })();
    </script>
</body>
</html>
```
