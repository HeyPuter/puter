---
title: puter.fs.listShared()
description: List the files and directories other users have shared with you.
platforms: [websites, apps, nodejs, workers]
---

This method lists what other Puter users have shared with you, a page at a time.

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

- `items` (Array) - The shares on this page. Each has `uid`, `mode`, `path`, `entryUid`, `isDir`, `issuer` and `holder`.
- `cursor` (String) - Pass to the next call to get the following page. **Present only while more pages remain.**
- `total` (Number) - Present only when `includeTotal` was set.

Iterate until `cursor` is absent rather than comparing `items.length` to `limit`. A page can come back short — items you can no longer see are filtered out after the page is read — while more pages still remain.

Items shared with you appear at their real path, under the owner's directory. Your own items are never listed here.

## Examples

<strong class="example-title">List everything shared with you</strong>

```html;fs-listShared
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            const page = await puter.fs.listShared({ includeTotal: true });
            puter.print(`${page.total} item(s) shared with you<br>`);
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
