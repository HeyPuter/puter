---
title: puter.auth.getProfilePicture()
description: Read a user's profile picture, returning null when unavailable.
platforms: [websites, apps, nodejs, workers]
---

Returns the `picture` field of a user's profile (see [`puter.auth.getProfile()`](/Auth/getProfile/)). A user can always read their own picture. Another user's picture is available only while that user is on a paid plan.

## Syntax

```js
puter.auth.getProfilePicture();
puter.auth.getProfilePicture(username);
```

## Parameters

### `username` (optional)

The username to look up. Defaults to the signed-in user.

## Return value

A promise that resolves to the picture's base64 image data URL, or `null` if no picture is available. The method checks the data URL's format but does not decode or verify the image itself.

Missing users, profiles that are not public to the caller, profiles with no picture set, and request failures all resolve to `null`.

When signed out with no `username`, it resolves to `null` without opening a sign-in prompt.

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
