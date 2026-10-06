---
title: Add a Team Admin Page
description: "Learn how to check if a user owns their team with Puter.js, so your app can show an admin page to the team owner only."
tags: [teams, auth]
order: 62
---

<div class="info">The Teams API is in beta. Method shapes, limits, and behavior may change between releases.</div>

On Puter, a user can create a team and add accounts to it. The user who creates
the team becomes its owner, and everyone else on it is a member. If your app has
an admin page for the team, you can check whether the signed-in user is the
owner and show the page only to them.

To read the user's team, see [Add Team Support](/recipes/add-team-support/).

## Check whether the user owns the team

Each team from [`puter.teams.list()`](/Teams/list/) has an `isOwner` flag. It is
`true` for the owner and `false` for members:

```js
const [team] = await puter.teams.list();

if (team?.isOwner) {
    showAdminPage();
}
```

When the user is not on a team, [`puter.teams.list()`](/Teams/list/) returns an
empty array, so `team` is `undefined` and the admin page stays hidden. The same
happens when the owner hasn't turned on the team's directory, since the team is
left out of the result until they do.

## Check ownership in your backend too

The `isOwner` check above runs in the user's browser, so it only controls what
your app shows. If your app has its own backend that runs owner-only actions,
check that the caller owns the team there as well before running the action.
