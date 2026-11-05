---
title: Share a File with a Team
description: "Learn how to share files with a user's team using Puter.js, so colleagues can open them without anyone typing a username."
tags: [teams, fs, auth]
order: 61
---

<div class="info">The Teams API is in beta. Method shapes, limits, and behavior may change between releases.</div>

On Puter, a user can create a team and add accounts to it. When someone on a
team uses your app, they often want to share a file with their colleagues, such
as a document the whole team edits or a draft for one coworker. You can share
the file with the whole team in one call, or let the user pick a teammate from
a list.

To read the user's team, see [Add Team Support](/recipes/add-team-support/).

## Share with the whole team

To share a file with everyone on a team, call
[`puter.fs.share()`](/FS/share/) with `{ team }` set to the team's `uid`:

```js
const [team] = await puter.teams.list();

await puter.fs.share('drafts/proposal.md', { team: team.uid }, 'write');
```

This is one share for the team, so anyone added to the team later gets access
too. Use the `uid` from [`puter.teams.list()`](/Teams/list/), since it always
points to the same team.

To take the team's access back, call [`puter.fs.unshare()`](/FS/unshare/) with
the same object. Everyone on the team loses access at once:

```js
await puter.fs.unshare('drafts/proposal.md', { team: team.uid });
```

## Share with one teammate

To share a file with one colleague, let the user pick them from a list. Get the
people on the team with [`puter.teams.listDirectory()`](/Teams/listDirectory/)
and use each `username` as an option:

```js
const colleagues = await puter.teams.listDirectory(team.uid);

for (const { username, uuid } of colleagues) {
    addOption({ label: username, value: username, id: uuid });
}
```

Then share with the picked username using
[`puter.fs.share()`](/FS/share/):

```js
await puter.fs.share('drafts/proposal.md', { username: picked }, 'write');
```

If your app saves who it shared the file with, save the `uuid` too. A user can
change their username, but their `uuid` stays the same.

## Fall back to typing a username

Some users have no team list to pick from. [`puter.teams.list()`](/Teams/list/)
returns an empty array when the user is not on a team, and
[`puter.teams.listDirectory()`](/Teams/listDirectory/) rejects with
`team_not_found` when the team owner has not turned on the directory. In both
cases, show a field where the user types a username, and share with what they
type:

```js
async function getShareOptions() {
    const [team] = await puter.teams.list();
    if (!team) return { mode: 'type-a-username' };

    try {
        const colleagues = await puter.teams.listDirectory(team.uid);
        return { mode: 'pick', team, colleagues };
    } catch (e) {
        if (e.code === 'team_not_found') return { mode: 'type-a-username' };
        throw e;
    }
}
```

To share with a typed username, see [Share a File](/recipes/share-a-file/).
