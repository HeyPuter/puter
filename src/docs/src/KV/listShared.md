---
title: puter.kv.listShared()
description: List the key-value data other users have shared with you.
platforms: [websites, apps, nodejs, workers]
---

Lists the live shares other users made with you, a page at a time. Each share comes with the `handle` you pass to the other [`puter.kv`](/KV/) methods to use it.

A share tells you its level, its app, and the owner's label. It never says who shared it or what the prefix is. To tell shares apart, read the label, or read a key the owner keeps for that, such as `meta`, through the handle. Reading needs `read` or `write` access, so a `watch` share only has its label.

In an app, the listing has only the shares of that app's data. Outside an app, it has every share made with you.

## Syntax

```js
puter.kv.listShared()
puter.kv.listShared(options)
```

## Parameters

#### `options` (Object) (optional)

- `limit` (Number): Shares per page. Defaults to `50`, at most `200`.
- `cursor` (String): The `cursor` from the previous page.
- `includeTotal` (Boolean): Add `total` to the result. Defaults to `false`.

## Return value

A `Promise` that resolves to:

- `items` (Array): The shares on this page, oldest first. Each has:
    - `handle` (String): Pass it as `handle` to use the share.
    - `access` (String): `'watch'`, `'read'`, or `'write'`.
    - `appUid` (String | null): The app whose data it is, or `null` for the store that belongs to no app.
    - `label` (String | null): Plain text the owner set. Render it as text, with `textContent`, never as HTML.
    - `createdAt` (Number): When the share was made, in Unix seconds.
- `cursor` (String): Pass it as `cursor` to get the next page. It's included only if there are more pages to load.
- `total` (Number): The number of live shares across every page. Only included when `includeTotal` is `true`.

Shares that stopped aren't listed. An access token scoped to less than the account, such as the one in a [`getReadURL()`](/FS/getReadURL/) URL, gets an empty page.

## Errors

The promise rejects with `{ message, code }`. A `limit` that isn't a positive number is rejected with `bad_request`, and going over the rate limit with `too_many_requests`. See [Rate Limits and Quotas](/rate-limits-and-quotas/#events).

## Examples

<strong class="example-title">Read every list shared with you</strong>

```js
const { items } = await puter.kv.listShared();
for (const { handle, access, label } of items) {
    // A watch share can't read keys, so it has only its label.
    const meta = access === 'watch' ? null : await puter.kv.get('meta', { handle });
    const row = document.createElement('li');
    row.textContent = label ?? meta?.title ?? 'Shared list';
    document.querySelector('#lists').append(row);
}
```

<strong class="example-title">Page through every share</strong>

```js
let cursor;
const all = [];
do {
    const page = await puter.kv.listShared({ limit: 50, cursor });
    all.push(...page.items);
    cursor = page.cursor;
} while (cursor);
```

## Related

- [`puter.kv.share()`](/KV/share/) - Share keys with another user
- [`puter.kv.unshare()`](/KV/unshare/) - Remove your own access
- [`puter.kv.listSharedByMe()`](/KV/listSharedByMe/) - List the shares you made
