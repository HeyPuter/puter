---
title: Share a File with a Team
description: "Learn how to share a file with a whole team or with one teammate using Puter.js, so colleagues get access without anyone typing a username."
tags: [teams, fs, auth]
order: 61
---

<div class="info">The Teams API is in beta. Method shapes, limits, and behavior may change between releases.</div>

Sharing inside a team is the collaborative case most apps reach for: a document
everyone on the team can edit, or one draft handed to a single colleague. Both
are [`puter.fs.share()`](/FS/share/) — what changes is who you name.

This carries on from [Add Team Support](/recipes/add-team-support/).

## Share with the whole team

Name the team by its `uid` and everyone on it gets access:

```js
const [team] = await puter.teams.list();

await puter.fs.share('drafts/proposal.md', { team: team.uid }, 'write');
```

**Anyone added to the team later is included too.** That is the reason to prefer
this over looping over the directory and sharing with each person: a per-person
loop is a snapshot taken today, a team share keeps up with the team.

There is no string form for a team. A bare string is always read as a username or
an email, so the object form is what tells the two apart:

```js
await puter.fs.share('drafts/proposal.md', 'alice', 'write');              // a person
await puter.fs.share('drafts/proposal.md', { team: team.uid }, 'write');   // the team
```

Use `uid` rather than `handle`. A handle can be renamed, and deleting a team
releases it for someone else to claim, so today's handle may point somewhere else
tomorrow. `{ teamHandle }` exists for when the handle is all you have.

## Share with one teammate

When the file is for one person, let the user pick them instead of typing a
username. The team directory is the list of candidates:

```js
const colleagues = await puter.teams.listDirectory(team.uid);

for (const { username, uuid } of colleagues) {
    addOption({ label: username, value: username, id: uuid });
}
```

Share by `username` — that is what `share()` accepts for a person:

```js
await puter.fs.share('drafts/proposal.md', { username: picked }, 'write');
```

If you also record who the file went to, store the **`uuid`** next to it. People
rename themselves, and a row that remembers only `alice` points at nobody the day
she becomes `alice-r`. The `uuid` does not move.

## When there is no team to share with

`list()` returns an empty array for a user who is not on a team, and
`listDirectory()` throws `team_not_found` when the owner has not opened the
directory to apps. Either way there is no picker to show, so fall back to sharing
by typed username:

```js
const [team] = await puter.teams.list().catch(() => []);
if (!team) return { mode: 'type-a-username' };

try {
    return { mode: 'pick', colleagues: await puter.teams.listDirectory(team.uid) };
} catch (e) {
    if (e.code !== 'team_not_found') throw e;
    return { mode: 'type-a-username' };   // directory is closed to apps
}
```

[Add Team Support](/recipes/add-team-support/) covers telling those cases apart
when you want to say something more specific about each.

## Notes

- `listDirectory()` carries `uuid`; `listMembers()` gives `username` and nothing
  else to an app. Use the directory when you need a stable id.
- The directory leaves out suspended accounts and ones that never signed in, so
  the picker only offers people who can actually open the file.
- Membership is always the *person's*, never the app's. An app installed by a
  member of one team can never read another's.
- A team share returns one grant, not one per member, and names the team in
  `holder_team` (`{ uid, name, handle }`). `holder` is a username, so it is
  `holder_team` you read to tell a team share from a personal one.
- Withdraw either kind with [`puter.fs.unshare()`](/FS/unshare/), which takes the
  same recipient shapes; revoking the team share removes access for everyone it
  reached.
