---
title: puter.fs.listSharedByMe()
description: List everything you have shared with other users, across all items.
platforms: [websites, apps, nodejs, workers]
---

This method lists everything you have shared out, a page at a time, without naming an item first. [`getShares()`](/FS/getShares/) answers the same question for one item you can already point at; this is what answers it when you can't. The listing includes invites to addresses that have no account yet (marked `pending`), and — for items you own — shares that a delegate with `manage` access issued on your behalf.

> **What an app sees.** An app never gets more reach than it was given: this
> listing shows an app only the shares on items it can reach in its own right.
> Shares an app creates are attributed to the user and carry `issuedByApp`, so
> the owner can tell them apart.

## Syntax

```js
puter.fs.listSharedByMe()
puter.fs.listSharedByMe(options)
```

## Parameters

#### `options` (Object) (optional)

An object with the following properties:

- `limit` (Number) - Maximum shares per page.
- `cursor` (String) - Continuation token from a previous page.
- `includeTotal` (Boolean) - Include the total count in the response. Defaults to `false`.
- `appUid` (String) - Narrow the listing to the shares one app issued in your name, or pass `'none'` for the ones you made yourself. An app calling this is bound to its own grants whatever it asks for.

## Return value

A `Promise` that resolves to an object with:

- `items` (Array) - The shares on this page. Each has `uid`, `mode`, `path`, `entryUid`, `isDir`, `name`, `type`, `thumbnail`, `owner`, `issuer`, `holder`, `issuedByApp`, `modified` and `size`. An unclaimed invite additionally carries `pending: true` and `recipientEmail`, with a `holder` of `null`.
- `cursor` (String) - Pass to the next call to get the following page. **Present only while more pages remain.**
- `total` (Number) - Present only when `includeTotal` was set. An approximation: it counts the shares recorded, before per-grant filtering, so it can be higher than the number of items paging actually yields.

Iterate until `cursor` is absent rather than comparing `items.length` to `limit`. A page can come back short — rows whose grant has since been withdrawn are filtered out after the page is read — while more pages still remain.

Items you own appear at their real path. An item you shared as a delegate (from someone else's folder you hold `manage` on) appears at the same masked path you reach it by.

## Examples

<strong class="example-title">See everything you have shared</strong>

```html;fs-listSharedByMe
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            const page = await puter.fs.listSharedByMe({ includeTotal: true });
            puter.print(`About ${page.total} share(s) you made<br>`);
            for (const share of page.items) {
                const who = share.pending
                    ? `${share.recipientEmail} (invited)`
                    : share.holder;
                puter.print(`${share.path} — ${share.mode} to ${who}<br>`);
            }
        })()
    </script>
</body>
</html>
```

<strong class="example-title">Page through every share you made</strong>

```js
let cursor;
const all = [];
do {
    const page = await puter.fs.listSharedByMe({ limit: 50, cursor });
    all.push(...page.items);
    cursor = page.cursor;
} while (cursor);
```

<strong class="example-title">Withdraw everything shared on one item</strong>

```js
const page = await puter.fs.listSharedByMe();
const target = page.items.find((share) => share.name === 'report.txt');
if (target && !target.pending) {
    await puter.fs.unshare(target.path, target.holder);
}
```

## Related

- [`puter.fs.share()`](/FS/share/) - Grant access
- [`puter.fs.listShared()`](/FS/listShared/) - List what others shared with you
- [`puter.fs.getShares()`](/FS/getShares/) - See who can reach one item you manage
