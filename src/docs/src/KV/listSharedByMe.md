---
title: puter.kv.listSharedByMe()
description: List the key-value shares you made with other users, including ones that stopped.
platforms: [websites, apps, nodejs, workers]
---

Lists the shares you made with [`puter.kv.share()`](/KV/share/), a page at a time. Shares that stopped stay in the listing with `revokedAt` and `revokedBy` set, as a record of who had access and when it ended.

In an app, the listing has only the shares of that app's data. Outside an app, it has every share you made.

## Syntax

```js
puter.kv.listSharedByMe()
puter.kv.listSharedByMe(options)
```

## Parameters

#### `options` (Object) (optional)

- `limit` (Number): Shares per page. Defaults to `50`, at most `200`.
- `cursor` (String): The `cursor` from the previous page.
- `includeTotal` (Boolean): Add `total` to the result. Defaults to `false`.

## Return value

A `Promise` that resolves to:

- `items` (Array): The shares on this page, oldest first. Each has:
    - `handle` (String): The share's id.
    - `prefix` (String): The shared prefix, ending with `:`.
    - `access` (String): `'watch'`, `'read'`, or `'write'`.
    - `appUid` (String | null): The app whose data is shared, or `null` for the store that belongs to no app.
    - `holder` (String | null): The holder's username. When the holder deletes their account, their shares are deleted with it and leave this listing.
    - `label` (String | null): The label the holder is shown.
    - `createdAt` (Number): When the share was made, in Unix seconds.
    - `revokedAt` (Number | null): When the share stopped, in Unix seconds, or `null` while it's live.
    - `revokedBy` (String | null): Who stopped it. It's `'owner'` when you revoked it, `'holder'` when the holder removed their own access, and `'system'` when the app whose data it was got deleted. It's `null` while the share is live, and on some shares that stopped before Puter recorded who stopped them.
- `cursor` (String): Pass it as `cursor` to get the next page. It's included only if there are more pages to load.
- `total` (Number): The number of shares across every page, stopped ones included. Only included when `includeTotal` is `true`.

## Errors

The promise rejects with `{ message, code }`:

| Code | Meaning |
| -- | -- |
| `events_kv_handle_owner_only` | The call came from an access token with less access than the account. |
| `bad_request` | `limit` isn't a positive number. |
| `too_many_requests` | Over the rate limit. See [Rate Limits and Quotas](/rate-limits-and-quotas/#events). |

## Examples

<strong class="example-title">Show who has access, and who left</strong>

```js
const { items } = await puter.kv.listSharedByMe({ includeTotal: true });
for (const share of items) {
    const state = share.revokedBy === 'holder'
        ? 'left'
        : share.revokedAt
            ? 'removed'
            : share.access;
    puter.print(`${share.holder}: ${share.prefix} (${state})<br>`);
}
```

<strong class="example-title">Revoke everyone's access to one prefix</strong>

```js
let cursor;
do {
    const page = await puter.kv.listSharedByMe({ limit: 100, cursor });
    for (const share of page.items) {
        if (share.prefix === 'list:42:' && share.revokedAt === null) {
            await puter.kv.unshare(share.handle);
        }
    }
    cursor = page.cursor;
} while (cursor);
```

## Related

- [`puter.kv.share()`](/KV/share/) - Share keys with another user
- [`puter.kv.unshare()`](/KV/unshare/) - Stop a share
- [`puter.kv.listShared()`](/KV/listShared/) - List the shares made with you
