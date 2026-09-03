---
title: puter.teams.enableMember()
description: Restore an account previously suspended.
platforms: [websites, apps]
---

<div class="info">The Teams API is in beta. Method shapes, limits, and behavior may change between releases.</div>

Restores an account previously suspended with [`disableMember()`](/Teams/disableMember/). Owner account only. The account can sign in again and the team resumes paying its per-account charge.

## Syntax

```js
puter.teams.enableMember(uid, username)
```

## Parameters

#### `uid` (String) (required)

The team's identifier.

#### `username` (String) (required)

The member's username.

## Return value

A `Promise` that resolves to nothing once the account is restored.

Rejects with `not_an_org_account` if the account does not belong to this team, and `not_the_team_owner` if the caller is not the owner account.

## Examples

<strong class="example-title">Restore a suspended account</strong>

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            const [team] = await puter.teams.list();
            if (!team) return puter.print('No team.');
            const [member] = (await puter.teams.listMembers(team.uid)).filter(m => m.orgOwned);
            if (!member) return puter.print('No provisioned account.');
            await puter.teams.enableMember(team.uid, member.username);
            puter.print(`${member.username} can sign in again`);
        })();
    </script>
</body>
</html>
```
