---
title: Teams
description: Get the user's team and list its members with the Puter.js Teams API
platforms: [websites, apps, nodejs, workers]
---

<div class="info">The Teams API is in beta. Method shapes, limits, and behavior may change between releases.</div>

The Teams API lets your app interact with the Puter Teams feature.

Puter Teams lets an organization bring its members together. Any user can create a team and invite members. Each member keeps their own Puter account, but belongs to the team, so the owner can manage them and cover their paid plan in one place.

With this API, your app can get the team the user currently belongs to and list the members of that team. To use the Teams API, the team owner must enable the directory setting in the [Teams dashboard](https://puter.com/#teams).

## Features

<div style="overflow:hidden; margin-bottom: 30px;">
    <div class="example-group active" data-section="list"><span>Get Team</span></div>
    <div class="example-group" data-section="list-directory"><span>List Members</span></div>
</div>

<div class="example-content" data-section="list" style="display:block;">

#### Get the current user's team information

```html;teams-list
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            const teams = await puter.teams.list();

            if (teams.length === 0) {
                puter.print('You are not on a team.');
                return;
            }

            for (const team of teams) {
                puter.print(`${team.name ?? team.handle ?? 'Unnamed team'}<br>`);
                puter.print(`uid: ${team.uid}<br>`);
                puter.print(`owner: ${team.isOwner}<br>`);
                puter.print(`directory open to apps: ${team.directoryEnabled}<br><br>`);
            }
        })();
    </script>
</body>
</html>
```

</div>

<div class="example-content" data-section="list-directory">

#### List the members of the user's team

```html;teams-directory
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <select id="colleagues"><option>Loading…</option></select>
    <button id="pick">Pick</button>
    <script>
        const select = document.getElementById('colleagues');

        (async () => {
            const [team] = await puter.teams.list();
            if (!team) {
                select.innerHTML = '<option>You are not on a team</option>';
                return;
            }

            // Off by default, and the usual reason the list comes back empty.
            if (!team.directoryEnabled) {
                select.innerHTML = '<option>Directory is closed to apps</option>';
                return;
            }

            const entries = await puter.teams.listDirectory(team.uid);
            select.innerHTML = '';
            for (const { username, uuid } of entries) {
                const option = document.createElement('option');
                // Store the uuid: it survives a username change.
                option.value = uuid;
                option.textContent = username;
                select.append(option);
            }
        })();

        document.getElementById('pick').addEventListener('click', () => {
            const option = select.selectedOptions[0];
            if (option) puter.print(`${option.textContent} → ${option.value}<br>`);
        });
    </script>
</body>
</html>
```

</div>

## Functions

- **[`puter.teams.list()`](/Teams/list/)** - Get the current user's team information
- **[`puter.teams.listDirectory()`](/Teams/listDirectory/)** - List the members of a team

## Examples

You can see various Puter.js Teams features in action from the following examples:

- [Find the user's team](/playground/teams-list/)
- [Offer colleagues in a picker](/playground/teams-directory/)
