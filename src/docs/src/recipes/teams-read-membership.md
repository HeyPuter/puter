---
title: Read the User's Team
description: "Find out whether the signed-in user belongs to a team, show which one, and list their colleagues so your app can suggest them."
tags: [teams, auth]
order: 60
---

**Use this when** your app should adapt to the team the signed-in user belongs
to, such as labelling their workspace or offering colleagues in a picker
instead of asking them to type usernames.

Everything here is read-only. Creating a team, adding accounts to it and paying
for them are done by the team owner from their own Puter account, never from an
app, so `puter.teams` gives an app three calls: [`list()`](/Teams/list/),
[`listMembers()`](/Teams/listMembers/) and
[`listDirectory()`](/Teams/listDirectory/).

## Check whether the user is on a team

`list()` returns the teams the signed-in user belongs to:

```js
const teams = await puter.teams.list();

if (teams.length === 0) {
    console.log('Not on a team');
} else {
    console.log(`On ${teams.length} team(s)`);
}
```

An empty array means *this user has no team*. It does not mean the deployment
has no teams: where the feature is turned off there is no `/teams` route at
all, so the call rejects with `not_found` instead of resolving. Handle the two
separately, or a user on a Puter without teams looks identical to one who
simply has not joined anything:

```js
let teams = [];
try {
    teams = await puter.teams.list();
} catch (e) {
    if (e.code !== 'not_found') throw e;
    // Teams aren't available here — hide the team parts of your UI.
}
```

Failures reject with an error carrying a `code`, so `e.code` is what you branch
on.

## Show which team

A team carries a `name` and a `handle`, and either may be `null`:

```js
const [team] = await puter.teams.list();

console.log(team.name ?? team.handle ?? 'Unnamed team');
console.log(team.createdAt);       // '2026-09-28T10:04:00Z'
console.log(team.isOwner);         // true if this user owns the team
```

Pass `team.uid` to the other two methods, and store that if you store anything.
Never key on `handle`: it is a label the owner can rename, and deleting a team
releases it for someone else to take, so a saved handle can later resolve to a
different team. `uid` is the stable reference.

## List the user's colleagues

`listMembers()` takes the team's `uid`. Any member may call it:

```js
const [team] = await puter.teams.list();
const members = await puter.teams.listMembers(team.uid);

for (const member of members) {
    console.log(member.username);
}
```

From an app each entry carries `username` and nothing else — no email, no
activation state, no usage. The extra fields you will see in the type
(`orgOwned`, `createdAt`, `uuid`) are filled in only when the user's own Puter
session makes the call, so write your UI against `username` alone.

## Offer colleagues in a picker

`listDirectory()` is the one built for suggesting people. It returns each
colleague's `username` together with a `uuid` that survives a rename, which is
what you want to store against a share or an assignment:

```js
const entries = await puter.teams.listDirectory(team.uid);

for (const { username, uuid } of entries) {
    addOption(username, uuid);
}
```

Accounts that are suspended, or that never signed in for the first time, are
left out, so the list is people your user can actually reach.

## The team has to opt in

An app sees a team only once that team's owner has turned its directory on.
This is off by default, and it is the single most common reason these calls
come back empty from an app but full from the user's own Puter session.

The behaviour differs per call, which is worth knowing when you are debugging:

- `list()` **omits** teams that have not opted in. It does not throw — a user
  on one closed team gets `[]`.
- `listMembers()` and `listDirectory()` **reject** with `team_not_found`.

`directoryEnabled` on the team tells you which case you are in, so you can say
something useful instead of showing an empty list:

```js
const [team] = await puter.teams.list();

if (!team.directoryEnabled) {
    console.log('Ask the team owner to turn on the directory.');
} else {
    const entries = await puter.teams.listDirectory(team.uid);
}
```

## Longer lists

All three methods share the same three forms. By default you get the whole list
as an array, which is what every example above uses:

```js
const members = await puter.teams.listMembers(team.uid);
```

Passing `cursor` or `includeTotal` switches to a page envelope instead:

```js
const page = await puter.teams.listMembers(team.uid, { limit: 50, cursor: null });

page.items;        // this page's members
page.cursor;       // present only while more pages remain
```

And `stream: true` hands back an async iterator of those envelopes, for walking
a large team without holding it all at once:

```js
for await (const page of puter.teams.listMembers(team.uid, { stream: true })) {
    for (const member of page.items) console.log(member.username);
}
```

## Notes

- These routes are keyset-paginated, so `offset` is rejected rather than
  silently ignored. Pass `cursor` to resume from a position.
- Everything is scoped to the signed-in person's own membership, so an app
  installed by a member of one team can never read another team.
- A user may belong to more than one team. `list()[0]` is fine for a demo, but
  let the user choose if your app acts on a specific one.
