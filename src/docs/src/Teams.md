---
title: Teams
description: Detect team context and look up a user's colleagues with the Teams API
platforms: [websites, apps]
---

<div class="info">The Teams API is in beta. Method shapes, limits, and behavior may change between releases.</div>

The Puter.js Teams feature lets your app see the team context around the user in front of it: whether they belong to one, and who their colleagues are.

A team is a Puter account that pays for other accounts. Members are ordinary Puter accounts — your app talks to them like any other user, and the team never gains access to a member's files. Team *administration* (creating teams, provisioning accounts, suspending them) happens in the account console rather than through apps, so what `puter.teams` offers is read-only.

## Features

**Team context.** `list()` tells you whether the signed-in user belongs to a team, and is also how you detect whether the deployment has Teams at all: it rejects with `not_found` where the feature is off, and resolves to an empty array where it is on and the user has no team.

**Colleague lookup.** `listDirectory()` returns the team's members so your app can suggest people by name instead of asking users to type usernames. It is opt-in per team — until an owner opens the directory, it answers `team_not_found`, which is indistinguishable from having no team.

**Sharing with a team.** Anything shared with a team reaches every member with one grant, including anyone added later. Pass the team's `uid` as the recipient of [`puter.fs.share()`](/FS/share/); there is no string form, since a bare string is always read as an email or username.

**Stable identifiers.** A team has a `uid` and an optional `handle`. Only the `uid` is stable — a handle is a mutable label, and deleting the team releases it for anyone else to take. Display the `name` and `handle`; pass the `uid`.

## Functions

- **[`puter.teams.list()`](/Teams/list/)** - List the teams the signed-in user belongs to, and detect whether Teams is available at all
- **[`puter.teams.listDirectory()`](/Teams/listDirectory/)** - List a team's members, where the owner has opened the directory to apps

Both are keyset-paginated and take the same options; see either method page for the paging forms and the full error list.

## Examples

<strong class="example-title">Detect whether the user is on a team</strong>

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
                // Teams are unavailable on this deployment.
            }
            puter.print(teams.length
                ? `On ${teams.length} team(s): ${teams.map(t => t.name).join(', ')}`
                : 'Not on a team');
        })();
    </script>
</body>
</html>
```

<strong class="example-title">Suggest a colleague to share with</strong>

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            const [team] = await puter.teams.list();
            if ( ! team ) return puter.print('Not on a team');

            try {
                const colleagues = await puter.teams.listDirectory(team.uid);
                colleagues.forEach(c => puter.print(`${c.username}<br>`));
            } catch (e) {
                // The owner has not opened the directory to apps.
                puter.print('No directory for this team');
            }
        })();
    </script>
</body>
</html>
```

<strong class="example-title">Share a file with the whole team</strong>

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            const [team] = await puter.teams.list();
            await puter.fs.write('report.txt', 'Quarterly numbers');
            await puter.fs.share({
                path: 'report.txt',
                recipient: { team: team.uid },
                mode: 'read',
            });
            puter.print(`Shared with everyone on ${team.name}`);
        })();
    </script>
</body>
</html>
```

## What is deliberately absent

- **No sharing-policy controls.** A team cannot restrict who its members share
  with: there is no external-sharing policy, no domain allowlist, and no control
  over public links. A member shares exactly as any other Puter user does, with
  anyone. This is the assumption most teams bring the other way round, so it is
  worth stating plainly before you rely on it.
- **No administration from apps.** Provisioning, suspension, credentials and
  audit belong to the account console; apps and API tokens are refused there.
