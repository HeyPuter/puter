---
title: UserProfile
description: A user's public profile.
---

The `UserProfile` object holds what a user chooses to show about themselves. Every attribute is present, and `null` where the user has set nothing.

## Attributes

#### `picture` (String or null)

The profile picture, as a base64 image data URL such as `data:image/png;base64,...`.

#### `displayName` (String or null)

The name shown next to the picture, at most 64 characters.

#### `bio` (String or null)

A short self-description, at most 280 characters.
