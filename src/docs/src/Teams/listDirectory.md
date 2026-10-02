---
title: puter.teams.listDirectory()
description: Get the list of members of a team.
platforms: [websites, apps, nodejs, workers]
---

<div class="info">The Teams API is in beta. Method shapes, limits, and behavior may change between releases.</div>

Get the list of members of a team.

The current user must be a member of the team, and the team owner must enable the directory setting in the [Teams dashboard](https://puter.com/#teams).

## Syntax

```js
puter.teams.listDirectory(uid)
puter.teams.listDirectory(uid, options)
```

## Parameters

#### `uid` (String) (required)

The team's `uid`, from [`puter.teams.list()`](/Teams/list/).

#### `options` (Object) (optional)

An object with the following optional properties:

- `limit` (Number): Maximum number of items to return in a single call.
- `cursor` (String): A pagination cursor from a previous call. Pass the `cursor` value returned by the previous page to fetch the next one.
- `includeTotal` (Boolean): If `true`, the result includes a `total` count of every item across all pages.
- `stream` (Boolean): If `true`, the method returns an async iterator of pages instead of a promise, for use with `for await ... of`.

## Return value

A `Promise` that resolves to either:

- An array of [`TeamDirectoryEntry`](/Objects/teamdirectoryentry/) objects, or
- A page object `{ items, cursor, total }` when using `cursor` or `includeTotal` in `options`. `items` is an array of [`TeamDirectoryEntry`](/Objects/teamdirectoryentry/) objects, `cursor` is present only when there are more pages, and `total` is present only when `includeTotal` is `true`.

With `stream: true`, the method returns an async iterator of page objects instead.

## Errors

A rejection carries an `Error` with a `code`:

| Code | Meaning |
| -- | -- |
| `invalid_request` | `uid` is empty, or `options` contains `offset`, which is not supported. Use `cursor` instead. |
| `token_missing` | The user is not signed in. |
| `token_auth_failed` | The user's session is invalid. |
| `forbidden` | Called with a scoped access token. |
| `account_is_not_verified` | The user's email has not been confirmed. |
| `team_not_found` | The team does not exist, the user is not a member, or the owner has not enabled the directory setting. |
| `too_many_requests` | The rate limit was exceeded. See [Rate Limits & Quotas](/rate-limits-and-quotas/). |

## Example

```html;teams-directory
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <select id="colleagues"><option>Loading…</option></select>
    <button id="pick">Pick</button>
    <script>
        const select = document.getElementById('colleagues');

        (async () => {
            const [team] = await puter.teams.list();
            if (!team) {
                select.innerHTML = '<option>You are not on a team</option>';
                return;
            }

            // Off by default, and the usual reason the list comes back empty.
            if (!team.directoryEnabled) {
                select.innerHTML = '<option>Directory is closed to apps</option>';
                return;
            }

            const entries = await puter.teams.listDirectory(team.uid);
            select.innerHTML = '';
            for (const { username, uuid } of entries) {
                const option = document.createElement('option');
                // Store the uuid: it survives a username change.
                option.value = uuid;
                option.textContent = username;
                select.append(option);
            }
        })();

        document.getElementById('pick').addEventListener('click', () => {
            const option = select.selectedOptions[0];
            if (option) puter.print(`${option.textContent} → ${option.value}<br>`);
        });
    </script>
</body>
</html>
```
