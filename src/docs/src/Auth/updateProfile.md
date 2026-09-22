---
title: puter.auth.updateProfile()
description: Update the signed-in user's profile picture, display name, or bio.
platforms: [websites, apps, nodejs, workers]
---

Changes fields on the signed-in user's profile and returns the updated profile. Fields left out of the patch are left as they are; `null` clears a field.

## Syntax

```js
puter.auth.updateProfile(patch);
```

## Parameters

### `patch` (required)

An object with any of these fields:

- `picture` (String or `null`): a base64 image data URL such as `data:image/png;base64,...`. At most 512 KiB.
- `displayName` (String or `null`): at most 64 characters. Surrounding whitespace is removed.
- `bio` (String or `null`): at most 280 characters. Surrounding whitespace is removed.

Any other field is rejected.

## Return value

A promise that resolves to the stored [`UserProfile`](/Objects/userprofile). It rejects with an object carrying a `code` and `message` when the patch is not accepted:

| `code`                      | Meaning                                               |
| --------------------------- | ----------------------------------------------------- |
| `profile_field_not_allowed` | The patch names a field that is not part of a profile |
| `profile_field_invalid`     | A field is not a string or `null`                     |
| `profile_picture_invalid`   | `picture` is not a base64 image data URL              |
| `profile_picture_too_large` | `picture` is over the size limit                      |
| `profile_field_too_long`    | `displayName` or `bio` is over its length limit       |

The profile belongs to the account, so the call must be made with a user session; an app acting on a user's behalf cannot change it.

## Example

```html;auth-update-profile
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <input id="display-name" placeholder="Display name">
    <button id="save">Save</button>
    <p id="status"></p>
    <script>
        document.getElementById('save').addEventListener('click', async () => {
            if (!puter.auth.isSignedIn()) await puter.auth.signIn();
            const displayName = document.getElementById('display-name').value;
            try {
                const profile = await puter.auth.updateProfile({ displayName });
                document.getElementById('status').textContent = `Saved as ${profile.displayName ?? '(no name)'}`;
            } catch (error) {
                document.getElementById('status').textContent = `${error.code}: ${error.message}`;
            }
        });
    </script>
</body>
</html>
```
