---
title: puter.teams.list()
description: Get the current user's team information.
platforms: [websites, apps, nodejs, workers]
---

<div class="info">The Teams API is in beta. Method shapes, limits, and behavior may change between releases.</div>

Get the current user's team information. If the user is not on a team, it resolves to an empty array.

The team owner must enable the directory setting in the [Teams dashboard](https://puter.com/#teams) for the team to be returned to your app.

## Syntax

```js
puter.teams.list()
puter.teams.list(options)
```

## Parameters

#### `options` (Object) (optional)

An object with the following optional properties:

- `limit` (Number): Maximum number of items to return in a single call.
- `cursor` (String): A pagination cursor from a previous call. Pass the `cursor` value returned by the previous page to fetch the next one.
- `includeTotal` (Boolean): If `true`, the result includes a `total` count of every item across all pages.
- `stream` (Boolean): If `true`, the method returns an async iterator of pages instead of a promise, for use with `for await ... of`.

## Return value

A `Promise` that resolves to either:

- An array of [`Team`](/Objects/team/) objects, or
- A page object `{ items, cursor, total }` when using `cursor` or `includeTotal` in `options`. `items` is an array of [`Team`](/Objects/team/) objects, `cursor` is present only when there are more pages, and `total` is present only when `includeTotal` is `true`.

With `stream: true`, the method returns an async iterator of page objects instead.

## Errors

A rejection carries an `Error` with a `code`:

| Code | Meaning |
| -- | -- |
| `invalid_request` | `options` contains `offset`, which is not supported. Use `cursor` instead. |
| `token_missing` | The user is not signed in. |
| `token_auth_failed` | The user's session is invalid. |
| `forbidden` | Called with a scoped access token. |
| `account_is_not_verified` | The user's email has not been confirmed. |
| `too_many_requests` | The rate limit was exceeded. See [Rate Limits & Quotas](/rate-limits-and-quotas/). |

## Example

```html;teams-list
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            const teams = await puter.teams.list();

            if (teams.length === 0) {
                puter.print('You are not on a team.');
                return;
            }

            for (const team of teams) {
                puter.print(`${team.name ?? team.handle ?? 'Unnamed team'}<br>`);
                puter.print(`uid: ${team.uid}<br>`);
                puter.print(`owner: ${team.isOwner}<br>`);
                puter.print(`directory open to apps: ${team.directoryEnabled}<br><br>`);
            }
        })();
    </script>
</body>
</html>
```
