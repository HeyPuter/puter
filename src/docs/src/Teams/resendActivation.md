---
title: puter.teams.resendActivation()
description: Issue a fresh one-time credential for an account that has never signed in.
platforms: [websites, apps]
---

<div class="info">The Teams API is in beta. Method shapes, limits, and behavior may change between releases.</div>

Issues a fresh one-time credential for an account that has never signed in, invalidating the previous one. Owner account only. Use it when the password from [`createMember()`](/Teams/createMember/) was lost before the member used it.

**It refuses once the account has been activated**, rejecting with `conflict`. After activation the member owns their own password, and an administrator able to replace it would be able to reach their files. An activated member resets their own password through the normal Puter flow.

The credential comes back once and is not retrievable afterwards. The member is emailed a notice that the account was set up; the notice carries no credential.

## Syntax

```js
puter.teams.resendActivation(uid, username)
```

## Parameters

#### `uid` (String) (required)

The team's identifier.

#### `username` (String) (required)

The member's username. It must be an account this team provisioned.

## Return value

A `Promise` that resolves to `{ username, temporaryPassword }`.

Rejects with `conflict` if the account has already been activated, and `not_an_org_account` if it does not belong to this team.

## Examples

<strong class="example-title">Reissue a credential, and see it refused after activation</strong>

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            const [team] = await puter.teams.list();
            if (!team) return puter.print('No team.');
            const members = await puter.teams.listMembers(team.uid);
            const target = members.find(m => m.orgOwned);
            if (!target) return puter.print('No provisioned account.');
            try {
                const again = await puter.teams.resendActivation(team.uid, target.username);
                puter.print(`New credential for ${again.username}: ${again.temporaryPassword}`);
            } catch (e) {
                if (e.code === 'conflict') puter.print('Already activated - they reset it themselves.');
                else throw e;
            }
        })();
    </script>
</body>
</html>
```
