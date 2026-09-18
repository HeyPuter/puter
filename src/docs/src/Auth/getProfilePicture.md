---
title: puter.auth.getProfilePicture()
description: Read a user's public profile picture, returning null when unavailable.
platforms: [websites, apps, nodejs, workers]
---

Reads the `picture` field from `/<username>/Public/.profile`. The file must contain a JSON object with a base64 image data URL, such as `{"picture":"data:image/png;base64,..."}`.

## Syntax

```js
puter.auth.getProfilePicture()
puter.auth.getProfilePicture(username)
```

## Parameters

### `username` (optional)

The username to look up. Defaults to the signed-in user's username. Pass a username, not a filesystem path.

## Return value

A promise that resolves to the picture's base64 image data URL, or `null` if no picture is available. The method checks the data URL's format but does not decode or verify the image itself.

Missing users, directories or files, invalid usernames, malformed JSON, missing or invalid `picture` fields, permission errors, and request failures all resolve to `null`. The method uses the caller's existing filesystem permissions and does not create or modify the profile file.

When signed out, it returns `null` without opening a sign-in prompt. Sign in first if needed.

## Example

```html;auth-get-profile-picture
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <button id="show-picture">Show my profile picture</button>
    <p id="status"></p>
    <img id="picture" alt="Your profile picture" width="96" height="96" hidden>
    <script>
        document.getElementById('show-picture').addEventListener('click', async () => {
            if (!puter.auth.isSignedIn()) await puter.auth.signIn();
            const picture = await puter.auth.getProfilePicture();
            const image = document.getElementById('picture');
            image.hidden = !picture;
            if (picture) image.src = picture;
            document.getElementById('status').textContent = picture ? '' : 'No profile picture available.';
        });
    </script>
</body>
</html>
```
