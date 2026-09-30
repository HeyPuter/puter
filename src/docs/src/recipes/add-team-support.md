---
title: Add Team Support
description: "Learn how to add team support with Puter.js, so your app can get the user's team and its members."
tags: [teams, auth]
order: 60
---

<div class="info">The Teams API is in beta. Method shapes, limits, and behavior may change between releases.</div>

On Puter, a user can create a team and add accounts to it. The user who creates
the team becomes its owner. When someone on a
team signs in to your app, you can read which team they belong to and who else
is on it. This lets your app greet them with their team's name and suggest
colleagues in places like an assignee dropdown or a share dialog, instead of
asking for a typed username.

## Check whether the user is on a team

To get the teams the signed-in user belongs to, call
[`list()`](/Teams/list/). An empty array means the user is not on a team:

```js
const teams = await puter.teams.list();

if (teams.length === 0) {
    console.log('Not on a team');
} else {
    console.log(`On ${teams.length} team(s)`);
}
```

## Show which team

Each team has a `name` and a `handle`, and either one may be `null`:

```js
const [team] = await puter.teams.list();

console.log(team.name ?? team.handle ?? 'Unnamed team');
console.log(team.createdAt);       // '2026-09-28T10:04:00Z'
console.log(team.isOwner);         // true if this user owns the team
```

To refer to a team, use `team.uid`. The
[`listDirectory()`](/Teams/listDirectory/) method takes it, and it is the value
to store. The owner can rename the `handle`, and a deleted team's
handle becomes free for another team to take, so only `uid` always points to
the same team.

## List the users in a team

To get the active users in a team, call
[`listDirectory()`](/Teams/listDirectory/) with the team's `uid`. Each entry has a `username` and a `uuid`. The `uuid`
stays the same when the user changes their username, so store the `uuid` if
you save a reference to someone:

```js
const entries = await puter.teams.listDirectory(team.uid);

for (const { username, uuid } of entries) {
    console.log(username, uuid);
}
```

With this list, your app can suggest team members wherever the user picks
people. For example, when the user [shares a file](/recipes/share-a-file/),
your app can suggest usernames from their team, so the user does not have to
type a username from memory.

## Check that the team has turned on its directory

Your app can see a team only after the team owner turns on its directory. It is
off by default. Until the owner turns it on, [`list()`](/Teams/list/) leaves
the team out of its result, and
[`listDirectory()`](/Teams/listDirectory/) rejects with `team_not_found`. The
same calls made from the user's own Puter session still return the team.

Each team has a `directoryEnabled` flag. Check it before listing the users in a team, so
you can tell the user what to do:

```js
const [team] = await puter.teams.list();

if (team.directoryEnabled) {
    const entries = await puter.teams.listDirectory(team.uid);
    console.log(entries);
} else {
    console.log('Ask the team owner to turn on the directory.');
}
```

## List a large team

By default, [`listDirectory()`](/Teams/listDirectory/) returns the whole list
as an array. For a large team, pass `stream: true` to read it one page at a
time. Each page has an `items` array:

```js
for await (const page of puter.teams.listDirectory(team.uid, { stream: true })) {
    for (const { username } of page.items) console.log(username);
}
```

To load one page at a time yourself, such as behind a "Load more" button, pass
`limit` and `cursor`. The result has a `cursor` for the next page while more
pages remain:

```js
const page = await puter.teams.listDirectory(team.uid, { limit: 50, cursor: null });

console.log(page.items);
console.log(page.cursor);
```
