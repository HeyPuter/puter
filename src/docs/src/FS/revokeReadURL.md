---
title: puter.fs.revokeReadURL()
description: Revoke a URL created by getReadURL(), so it stops serving the file.
platforms: [websites, apps, nodejs, workers]
---

Revokes a URL created by [`getReadURL()`](/FS/getReadURL/), so it immediately stops serving the file. An app can revoke only URLs it created; the account itself, through its own session or API token, can revoke any of its read URLs. Revoking a URL that is already revoked or has expired resolves without error.

## Syntax

```js
puter.fs.revokeReadURL(url)
```

## Parameters

#### `url` (String) (Required)

The URL `getReadURL()` returned, or the bare token it carries.

## Return value

A `Promise` that resolves to `undefined` once the URL is revoked.

## Errors

A rejection carries an `Error` with a stable `code`:

| Code | Meaning |
| -- | -- |
| `field_missing` | Refused before reaching the server — `url` is empty. |
| `field_invalid` | Refused before reaching the server — no token could be found in `url`. |
| `token_missing` | No authentication token was presented. |
| `token_auth_failed` | The token presented did not authenticate. |
| `forbidden` | Called with a scoped access token, or `url` carries a personal API token (revoke those from account settings). |
| `token_invalid` | `url` doesn't carry a Puter access token: it is forged, malformed, or another kind of token. |
| `not_found` | The URL was created by a different app, or belongs to another account. |
| `too_many_requests` | The rate limit was exceeded. See [Rate Limits & Quotas](/rate-limits-and-quotas/). |

## Example

<strong class="example-title">Revoke a read URL</strong>

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            await puter.fs.write('~/shared.txt', 'temporary contents');
            const url = await puter.fs.getReadURL('~/shared.txt');
            puter.print(`Readable at: ${url}<br>`);

            await puter.fs.revokeReadURL(url);
            puter.print('Revoked — the URL no longer serves the file.');
        })();
    </script>
</body>
</html>
```
