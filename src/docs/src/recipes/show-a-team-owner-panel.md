---
title: Show a Team Owner Panel
description: "Learn how to check isOwner with Puter.js, so your app shows admin views like billing or settings to a team's owner and hides them from everyone else."
tags: [teams, auth]
order: 62
---

<div class="info">The Teams API is in beta. Method shapes, limits, and behavior may change between releases.</div>

Most team apps have a corner meant for whoever runs the team — billing, seats,
a settings tab. Puter already tells you who that is, so gating it needs no extra
call.

This carries on from [Add Team Support](/recipes/add-team-support/).

## Check who owns the team

`isOwner` comes back on every team [`list()`](/Teams/list/) returns:

```js
const [team] = await puter.teams.list();

if (team?.isOwner) {
    renderBillingTab();
}
```

The user who creates a team is its owner. Everyone else on it is a member, and
reads `isOwner: false`.

## Treat it as a UI hint, not a boundary

`isOwner` decides what you *render*. It does not decide what the server allows —
the server checks ownership itself on every route that needs it, whatever your UI
chose to show.

That split is the useful one:

```js
// Fine: hide a control the user cannot use anyway.
if (team.isOwner) showSeatControls();

// Not a guard: the call is still checked server-side, so handle the refusal.
try {
    await inviteTeammate(email);
} catch (e) {
    if (e.code === 'forbidden') showNotOwnerMessage();
    else throw e;
}
```

Hiding a button is a courtesy to the user, not a lock. Anyone can call your app's
code with the devtools open, and the only thing that stops them is the check on
the other end.

## Notes

- A user with no team gets `[]` from `list()`, so `team?.isOwner` is `undefined`
  — render the panel for nobody rather than throwing.
- `isOwner` is about the team, not about a file. Access to a shared document is
  decided by the share, covered in
  [Share a File with a Team](/recipes/share-a-file-with-a-team/).
