---
title: puter.teams.resetPassword()
description: Issue a new temporary password for an account a team owns.
platforms: [websites, apps]
---

<div class="info">The Teams API is in beta. Method shapes, limits, and behavior may change between releases.</div>

Issues a new temporary password for an account the team owns and ends its sessions. Owner account only.

Unlike [`resendActivation()`](/Teams/resendActivation/), which only works before an account has ever been used, this works on a live account. **That makes it the one route from a team to a member's data**, so it is bounded in two ways that cannot be turned off: an audit row is written, and the member is emailed. Both happen on every call.

Two-factor authentication is left alone. A team can replace a member's password and cannot clear their second factor.

The temporary password is returned **once** and is not retrievable afterwards — deliver it out of band. It stops working 24 hours after it is issued, so an unused reset expires rather than becoming a standing credential. Until the member chooses their own password, they can sign in and do nothing else: every other request fails with `password_change_required`.

## Syntax

```js
puter.teams.resetPassword(uid, username)
```

## Parameters

#### `uid` (String) (required)

The team's identifier.

#### `username` (String) (required)

The member's username. It must be an account this team provisioned.

## Return value

A `Promise` that resolves to an object with:

#### `username` (String)

The account the credential belongs to.

#### `temporaryPassword` (String)

The new password. Shown once — this response is the only place it appears.

Rejects with `not_an_org_account` if the account does not belong to this team, and `not_the_team_owner` if the caller is not the owner account.

## Rate limit

20 per day, separate from the general administrative budget. See [Rate Limits and Quotas](/rate-limits-and-quotas/).

## Examples

<strong class="example-title">Reset a member's password</strong>

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            const [team] = await puter.teams.list();
            if (!team) return puter.print('No team.');
            const members = await puter.teams.listMembers(team.uid);
            const member = members.find(m => m.orgOwned);
            if (!member) return puter.print('No member accounts.');

            const { temporaryPassword } = await puter.teams.resetPassword(team.uid, member.username);
            puter.print(`New password for ${member.username}: ${temporaryPassword}<br>`);
            puter.print('Deliver this out of band — it expires in 24 hours.');
        })();
    </script>
</body>
</html>
```
