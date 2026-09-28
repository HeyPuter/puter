---
title: Work With a Team
description: "Build an assignee picker, scope your data per team, share a document with everyone, and say the right thing when there is no team to show."
tags: [teams, fs, auth]
order: 61
---

**Use this when** you are past `list()` and building something with it — a task
board that assigns cards to colleagues, an editor that shares a draft with the
team, a workspace that keeps each team's data apart.

This carries on from [reading the user's team](/recipes/teams-read-membership/).

## An assignee picker that survives a rename

The common case: a card, an issue, a document needs an owner, and the candidates
are the user's colleagues.

```js
const [team] = await puter.teams.list();
const colleagues = await puter.teams.listDirectory(team.uid);

for (const { username, uuid } of colleagues) {
    addOption({ label: username, value: uuid });
}
```

Store the **`uuid`**, never the username. People rename themselves, and a card
assigned to `alice` becomes a card assigned to nobody the day she becomes
`alice-r`. The `uuid` does not move.

Show the username, because that is what a colleague recognises. Keep the `uuid`,
because that is what still resolves next month.

## Load a big team without freezing the UI

A fifty-seat team is fine in one call. If you cannot promise that, stream it and
let the list fill in:

```js
for await (const page of puter.teams.listDirectory(team.uid, { stream: true })) {
    for (const entry of page.items) addOption(entry);
}
```

If you are rendering a scrolling picker and want to fetch the next page only
when the user reaches the bottom, hold the cursor instead:

```js
let cursor = null;

async function loadMore () {
    const page = await puter.teams.listDirectory(team.uid, { limit: 50, cursor });
    page.items.forEach(addOption);
    cursor = page.cursor ?? null;
    return Boolean(page.cursor);   // false once there is nothing left
}
```

`cursor` is present only while more pages remain, so its absence is what ends
the loop. Do not compare `items.length` against `limit` — a page can come back
short while more still remain.

`offset` is refused outright with `invalid_request`; these listings are
keyset-paginated, and a rejected call is easier to find than page one returned
four times.

## Keep each team's data apart

Someone can belong to more than one team, so `list()[0]` is a demo, not a
design. Let them choose, and key your storage on the team they picked:

```js
const teams = await puter.teams.list();

// The picked team's uid namespaces everything this app stores for it.
const active = teams.find(t => t.uid === savedUid) ?? teams[0];

await puter.kv.set(`board:${active.uid}:columns`, columns);
```

Using `uid` rather than `handle` matters here too: a handle can be renamed, and
deleting a team releases it for someone else to claim, so yesterday's key could
belong to a different team tomorrow.

## Share a document with the whole team

`puter.fs.share()` takes a team, not just a person:

```js
await puter.fs.share('drafts/proposal.md', { team: team.uid }, 'write');
```

Everyone in the team gets access — **including anyone added to it later**, which
is the reason to prefer this over looping over `listDirectory()` and sharing with
each person. A per-person loop is a snapshot; a team share keeps up.

There is no string form for a team. A bare string is always read as a username or
an email, so the object form is what distinguishes it. See
[sharing a file](/recipes/share-a-file/).

## Show an owner-only panel

`isOwner` is on every team the user belongs to, so gating an admin view needs no
extra call:

```js
if (team.isOwner) {
    renderBillingTab();
}
```

Treat this as a UI hint, not a security boundary — the server enforces ownership
on every route that needs it, whatever your UI chooses to render.

## Say the right thing when there is no team

Three different situations all end with an empty picker, and they want three
different messages:

```js
async function loadColleagues () {
    let teams;
    try {
        teams = await puter.teams.list();
    } catch (e) {
        if (e.code !== 'not_found') throw e;
        return { state: 'unavailable' };      // teams are off on this Puter
    }

    const team = teams[0];
    if (!team) return { state: 'no-team' };    // signed in, but not on a team

    try {
        return { state: 'ok', items: await puter.teams.listDirectory(team.uid) };
    } catch (e) {
        if (e.code !== 'team_not_found') throw e;
        return { state: 'closed', team };      // directory not opened to apps
    }
}
```

- `not_found` — the deployment has no teams feature. Hide the team parts of your
  UI entirely.
- `[]` — they are signed in and simply have no team. Offer whatever your app does
  for a lone user.
- `team_not_found` — the team exists and they are in it, but the owner has not
  opened its directory to apps. Say *that*, and the owner can go turn it on.

An empty list with no explanation is the one outcome that leaves a user with
nothing to do about it.

## When your app uses an access token

The directory is readable with the user's session or a full-access token. A
**scoped** access token is refused with `403 forbidden`:

> This endpoint is not available to scoped access tokens

A scoped token holds only what it was minted for, and a colleague roster is not
that. If your app works through scoped tokens, read the directory on the
session and pass what you need onward, rather than widening the token.

## Notes

- From an app, `listMembers()` gives `username` and nothing else. `orgOwned`,
  `createdAt` and `uuid` appear only for the user's own session — so an assignee
  picker should use `listDirectory()`, which does carry `uuid`.
- The directory leaves out suspended accounts and ones that never signed in, so
  the picker only offers people who can actually be reached.
- Membership is always the *person's*, never the app's. An app installed by a
  member of one team can never read another's.
- `includeTotal: true` adds a `total` alongside `items`, useful for a
  "showing 50 of 214" label without giving up paging.
