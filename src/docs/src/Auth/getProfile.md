---
title: puter.auth.getProfile()
description: Read a user's profile, returning null when it is not available.
platforms: [websites, apps, nodejs, workers]
---

Returns a user's profile: their picture, display name, and bio. A user can always read their own profile. Another user's profile is available only while that user is on a paid plan; otherwise the method resolves to `null`, the same as for a user who does not exist.

## Syntax

```js
puter.auth.getProfile();
puter.auth.getProfile(username);
```

## Parameters

### `username` (optional)

The username to look up. Defaults to the signed-in user.

## Return value

A promise that resolves to a [`UserProfile`](/Objects/userprofile) object, or `null` when no profile is available: the user does not exist, their profile is not public and they are not the signed-in user, or the request failed. Every field of the object is present, and `null` where the user has set nothing.

When signed out with no `username`, it resolves to `null` without opening a sign-in prompt.

## Example

```html;auth-get-profile
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <button id="show-profile">Show my profile</button>
    <pre id="profile"></pre>
    <script>
        document.getElementById('show-profile').addEventListener('click', async () => {
            if (!puter.auth.isSignedIn()) await puter.auth.signIn();
            const profile = await puter.auth.getProfile();
            document.getElementById('profile').textContent = profile
                ? JSON.stringify({ ...profile, picture: profile.picture ? '(picture set)' : null }, null, 2)
                : 'No profile available.';
        });
    </script>
</body>
</html>
```
