---
title: puter.fs.listShared()
description: List the files and directories other users have shared with you.
platforms: [websites, apps, nodejs, workers]
---

This method lists what other Puter users have shared with you, a page at a time.

> **What an app can share.** An app never gets more reach than it was given. It
> can share its own AppData, and files the user specifically granted it, at up
> to the level of access it holds itself — so an app with read access can grant
> read, and nothing more. Files its user owns but never handed to the app stay
> out of reach, and `listShared()` shows an app only the shares it can reach.
> Shares an app creates are attributed to the user and carry `issuedByApp`, so
> the owner can tell them apart in [`getShares()`](/FS/getShares/).

## Syntax

```js
puter.fs.listShared()
puter.fs.listShared(options)
```

## Parameters

#### `options` (Object) (optional)

An object with the following properties:

- `limit` (Number) - Maximum shares per page.
- `cursor` (String) - Continuation token from a previous page.
- `includeTotal` (Boolean) - Include the total count in the response. Defaults to `false`.

## Return value

A `Promise` that resolves to an object with:

- `items` (Array) - The shares on this page. Each has `uid`, `mode`, `path`, `entryUid`, `isDir`, `name`, `type`, `thumbnail`, `owner`, `issuer`, `holder`, `modified` and `size`. A share row has no directory listing behind it, so `name`, `type` and `thumbnail` are carried on the row itself for rendering.
- `cursor` (String) - Pass to the next call to get the following page. **Present only while more pages remain.**
- `total` (Number) - Present only when `includeTotal` was set. An approximation: it counts the shares recorded for you, before the filtering described below, so it can be higher than the number of items paging actually yields. Treat it as a headline figure, not a count to reconcile against.

Iterate until `cursor` is absent rather than comparing `items.length` to `limit`. A page can come back short — items you can no longer see are filtered out after the page is read — while more pages still remain.

Items shared with you appear at a **masked path**, `/<owner>/<uid>/<name>`, where `<uid>` stands in for wherever the owner keeps the item. Pass that path back to any `puter.fs` method and it resolves normally; what it does not tell you is the folder the item lives in, or what sits beside it. Your own items are never listed here.

## Examples

<strong class="example-title">List everything shared with you</strong>

```html;fs-listShared
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            const page = await puter.fs.listShared({ includeTotal: true });
            puter.print(`About ${page.total} item(s) shared with you<br>`);
            for (const share of page.items) {
                puter.print(`${share.path} — ${share.mode} from ${share.issuer}<br>`);
            }
        })()
    </script>
</body>
</html>
```

<strong class="example-title">Page through every share</strong>

```js
let cursor;
const all = [];
do {
    const page = await puter.fs.listShared({ limit: 50, cursor });
    all.push(...page.items);
    cursor = page.cursor;
} while (cursor);
```

<strong class="example-title">Open a file someone shared with you</strong>

```js
const page = await puter.fs.listShared();
const shared = page.items.find((item) => !item.isDir);
if (shared) {
    const blob = await puter.fs.read(shared.path);
    puter.print(await blob.text());
}
```

## Related

- [`puter.fs.share()`](/FS/share/) - Grant access
- [`puter.fs.getShares()`](/FS/getShares/) - See who can reach an item you manage
