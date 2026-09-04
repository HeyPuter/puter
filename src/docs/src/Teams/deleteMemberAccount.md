---
title: puter.teams.deleteMemberAccount()
description: Permanently remove an account a team owns.
platforms: [websites, apps]
---

<div class="info">The Teams API is in beta. Method shapes, limits, and behavior may change between releases.</div>

Permanently removes an account the team owns. Its files are deleted, its username returns to the pool, and every credential is invalidated. Owner account only.

**This is irreversible, and there is no restore window.** The account must already be suspended with [`disableMember()`](/Teams/disableMember/) — a live account is refused. That ordering is deliberate: it puts a reversible step in front of the only irreversible operation in the API, so nothing here deletes a working account in a single call.

Disabling already stopped the per-account charge. This is what stops the charge for the bytes the account held, and it is the only thing that does. Nothing removes a suspended account on a timer — it persists, costing only its storage, until you ask for it to go.

## Syntax

```js
puter.teams.deleteMemberAccount(uid, username)
```

## Parameters

#### `uid` (String) (required)

The team's identifier.

#### `username` (String) (required)

The member's username. It must be an account this team provisioned, and it must already be suspended.

## Return value

A `Promise` that resolves to nothing once the account is gone.

Rejects with `account_must_be_disabled_first` if the account is still live, `not_an_org_account` if it does not belong to this team, and `not_the_team_owner` if the caller is not the owner account.

## Examples

<strong class="example-title">Suspend, then remove for good</strong>

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

            // Deleting straight away is refused — disable is always the step before.
            try {
                await puter.teams.deleteMemberAccount(team.uid, name);
            } catch (e) {
                puter.print(`Refused: ${e.code}<br>`);
            }

            await puter.teams.disableMember(team.uid, name);
            await puter.teams.deleteMemberAccount(team.uid, name);
            puter.print(`${name} deleted`);
        })();
    </script>
</body>
</html>
```
