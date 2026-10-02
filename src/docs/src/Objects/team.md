---
title: Team
description: The Team object containing information about a Puter team.
---

The `Team` object contains information about a Puter team, returned by [`puter.teams.list()`](/Teams/list/).

## Attributes

#### `uid` (String)

The team's unique identifier. Pass this to [`puter.teams.listDirectory()`](/Teams/listDirectory/).

#### `name` (String)

The team's display name, or `null` if it has none.

#### `handle` (String)

The team's short handle, or `null` if it has none. The handle can change, so store the `uid` instead.

#### `isOwner` (Boolean)

Whether the current user is the team owner.

#### `directoryEnabled` (Boolean)

Whether the team owner has enabled the directory setting, which lets apps use the Teams API for this team.

#### `createdAt` (String)

When the team was created, in `YYYY-MM-DDTHH:MM:SSZ` format.
