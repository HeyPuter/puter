---
title: puter.kv.list()
description: Retrieve all keys from the user's own key-value store for your app.
platforms: [websites, apps, nodejs, workers]
---

Returns the keys in the user's key-value store for the current app, or an empty array if there are none.

Keys are sorted lexicographically (string order), ascending by default. Pass `reverse: true` to list them in descending order.

## Syntax

```js
puter.kv.list()
puter.kv.list(pattern)
puter.kv.list(returnValues = false)
puter.kv.list(pattern, returnValues = false)
puter.kv.list(pattern, optConfig)
puter.kv.list(pattern, returnValues, optConfig)
puter.kv.list(returnValues, optConfig)
puter.kv.list(options)
```

## Parameters

#### `pattern` (String) (optional)

Returns only the keys that start with this prefix. A `*` is a wildcard only at the end, so `abc` and `abc*` both match keys that start with `abc` (such as `abc`, `abc123`, and `abc123xyz`). To match a literal `*`, add one more at the end. For example, `key**` matches keys that start with `key*`, and `k*y*` matches keys that start with `k*y`. Defaults to `*`, which matches every key.

> Patterns here are **always** prefix matches, with or without a trailing `*`. [Events](/Events/) subjects are the other way round. The subject `kv:cart` watches that one key, and you add `*` to widen it to a prefix.

#### `returnValues` (Boolean) (optional)

When `true`, the result holds [`KVPair`](/Objects/kvpair) objects with `key` and `value`. When `false`, it holds only the keys. Defaults to `false`.

#### `optConfig` (Object) (optional)

<div class="info">KV sharing is in beta. Method shapes, limits, and behavior may change between releases.</div>

The last argument of the positional forms. It takes these properties:

- `handle` (String): Lists data another user shared with you, using the `handle` from [`puter.kv.listShared()`](/KV/listShared/). Listing keys works at any access level, and listing values needs `read` or `write` access. The `pattern` is relative to the shared prefix and can be at most 768 bytes, and the returned keys are relative to the prefix too. The results and `total` leave out entries the owner's app keeps private. See [Sharing with other users](/KV/#sharing-with-other-users).
- `appUuid` (String): Lists another app's data, which the user let your app reach with [`puter.perms.request('appData', …)`](/Perms/appData/). It can't be combined with `handle`.

#### `options` (Object) (optional)

An object with these optional properties:

- `pattern` (String): Same as the `pattern` parameter.
- `returnValues` (Boolean): Same as the `returnValues` parameter.
- `reverse` (Boolean): Lists keys in descending order when `true`. Defaults to `false`. It works with full listings, pages, and streams. On its own, it keeps the plain array return shape.
- `limit` (Number): The most items to return in one call, at most `1000`. A larger value is lowered to `1000`, and the `cursor` picks up from there.
- `cursor` (String): The `cursor` from the previous page, to fetch the next one. The cursor keeps the listing's direction, so leave out `reverse` or pass the same value. A different `reverse` is rejected.
- `offset` (Number): Skips this many items before the page starts, at most `5000`. It can't be combined with `cursor`. Requests get slower and more expensive the larger the offset, so prefer `cursor`.
- `includeTotal` (Boolean): When `true`, the result includes `total`, the number of items that match across all pages. The count is metered, and its cost grows with the size of your store. Request it once, on the first page, and keep it out of hot paths. To find out whether more pages exist, check for `cursor` instead.
- `fetchUntilFull` (Boolean): A page can come back with fewer than `limit` items even when more exist, such as when expired keys are left out. When `true`, the page is filled up to `limit` items when possible. Requires `limit`.
- `optConfig` (Object): Same as the `optConfig` parameter, as in `list({ pattern, optConfig: { handle } })`.
- `stream` (Boolean): When `true`, the method returns an async iterator of [`KVListPage`](/Objects/kvlistpage) objects instead of a promise, for use with `for await ... of`. Combine it with `limit` to set the page size, or with `cursor` to resume from a page. It can't be combined with `offset`. With `includeTotal`, only the first page has `total`.

## Return value

A `Promise` that resolves to one of these:

- An array of keys.
- An array of [`KVPair`](/Objects/kvpair) objects, when `returnValues` is `true`.
- A [`KVListPage`](/Objects/kvlistpage) object, when `options` has `limit`, `cursor`, `offset`, `includeTotal`, or `fetchUntilFull`.

When paging, keep going until a page has no `cursor`. A page can hold fewer than `limit` items while more pages exist.

Without paging options, the whole listing comes back as one array. It reads the entire store and is metered per page, so on a large store a bare `list()` gets slow and costly. The SDK logs a one-time console warning when a full listing spans more than one page. Use `stream: true`, or `limit` and `cursor`, and narrow the scan with a `pattern`.

With `stream: true`, the method returns an async iterator of [`KVListPage`](/Objects/kvlistpage) objects instead:

```js
for await (const page of puter.kv.list({ pattern: 'log:*', stream: true })) {
    for (const key of page.items) {
        console.log(key);
    }
}
```

## Errors

The promise rejects with `{ message, code }`. With `stream: true`, the iterator's first `next()` rejects instead. The method never throws synchronously.

| Code | Meaning |
| -- | -- |
| `invalid_request` | An option is invalid, such as a `reverse` that isn't a boolean or `offset` combined with `stream`. |
| `kv_handle_not_found` | `handle` doesn't exist, the share stopped, it isn't shared with you, or the call comes from an app other than the one whose data it shares. |
| `kv_handle_access_denied` | The listing asks for values, and the share is `watch` only. |
| `kv_handle_option_invalid` | `handle` was combined with `appUuid`. |
| `kv_handle_key_invalid` | With `handle`, the `pattern` is longer than 768 bytes. |
| `kv_handles_disabled` | Calls through a share are turned off on this deployment. |

## Examples

<strong class="example-title">List keys in reverse order</strong>

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            await puter.kv.set('reverse-demo:a', 1);
            await puter.kv.set('reverse-demo:b', 2);
            const keys = await puter.kv.list({ pattern: 'reverse-demo:*', reverse: true });
            puter.print(JSON.stringify(keys));
        })();
    </script>
</body>
</html>
```

<strong class="example-title">Retrieve all keys in the user's key-value store for the current app</strong>

```html;kv-list
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            // (1) Create a number of key-value pairs
            await puter.kv.set('name', 'Puter Smith');
            await puter.kv.set('age', 21);
            await puter.kv.set('isCool', true);
            puter.print("Key-value pairs created/updated<br><br>");

            // (2) Retrieve all keys
            const keys = await puter.kv.list();
            puter.print(`Keys are: ${keys}<br><br>`);

            // (3) Retrieve all keys and values
            const key_vals = await puter.kv.list(true);
            puter.print(`Keys and values are: ${(key_vals).map((key_val) => key_val.key + ' => ' + key_val.value)}<br><br>`);

            // (4) Match keys with a pattern
            const keys_matching_pattern = await puter.kv.list('is*');
            puter.print(`Keys matching pattern are: ${keys_matching_pattern}<br>`);

            // (5) Delete all keys (cleanup)
            await puter.kv.del('name');
            await puter.kv.del('age');
            await puter.kv.del('isCool');
        })();
    </script>
</body>
</html>
```

<strong class="example-title">Paginate results with a cursor</strong>

```html;kv-list-pagination
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            // Create sample data
            for (let i = 1; i <= 6; i++) {
                await puter.kv.set(`item-${i}`, `value-${i}`);
            }
            puter.print('Created 6 key-value pairs<br><br>');

            // Paginate with cursor (2 items per page)
            let currentCursor = undefined;
            let page = 1;
            do {
                const result = await puter.kv.list({
                    limit: 2,
                    returnValues: true,
                    cursor: currentCursor,
                });
                const items = result.items;
                puter.print(`<b>Page ${page}:</b><br>`);
                for (const item of items) {
                    puter.print(`  ${item.key} => ${item.value}<br>`);
                }
                puter.print('<br>');
                currentCursor = result.cursor;
                page++;
            } while (currentCursor);

            puter.print('Done paginating.<br><br>');

            // Cleanup
            for (let i = 1; i <= 6; i++) {
                await puter.kv.del(`item-${i}`);
            }
            puter.print('Cleaned up sample data.');
        })();
    </script>
</body>
</html>

```

<strong class="example-title">Sort keys lexicographically</strong>

```html;kv-list-sort
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            await puter.kv.set('log:2025-03-15T10:00:00Z', { msg: 'third' });
            await puter.kv.set('log:2025-01-01T00:00:00Z', { msg: 'first' });
            await puter.kv.set('log:2025-02-14T08:00:00Z', { msg: 'second' });

            const logs = await puter.kv.list('log:*');
            puter.print('Sorted keys: <br/>');
            puter.print(logs.join('<br/>'));

            // Cleanup
            await puter.kv.del('log:2025-03-15T10:00:00Z');
            await puter.kv.del('log:2025-01-01T00:00:00Z');
            await puter.kv.del('log:2025-02-14T08:00:00Z');
        })();
    </script>
</body>
</html>
```

<strong class="example-title">Sort numeric keys with zero-padding</strong>

```html;kv-list-padding
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            // Pad numbers to a fixed width, so string order matches number order
            const keys = ['item:010', 'item:002', 'item:100', 'item:001'];
            for (const key of keys) {
                await puter.kv.set(key, '...');
            }

            const items = await puter.kv.list('item:*');
            puter.print('Items with zero-padding: <br/>');
            puter.print(items.join('<br/>'));

            // Cleanup
            for (const key of keys) {
                await puter.kv.del(key);
            }
        })();
    </script>
</body>
</html>
```

<strong class="example-title">Design keys for query-like filtering with prefix patterns</strong>

```html;kv-prefix-patterns
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            const orders = [
                { id: '0001', status: 'pending', customer: 'alice', total: 48 },
                { id: '0002', status: 'shipped', customer: 'alice', total: 72 },
                { id: '0003', status: 'pending', customer: 'bob', total: 15 },
            ];

            // In KV, key design is your query plan.
            // We store the same order under multiple prefixes so each read path
            // becomes a simple prefix query with puter.kv.list().
            for (const order of orders) {
                await puter.kv.set(`demo:order:by-id:${order.id}`, order);
                await puter.kv.set(`demo:order:by-status:${order.status}:${order.id}`, order);
                await puter.kv.set(`demo:order:by-customer:${order.customer}:${order.id}`, order);
                await puter.kv.set(`demo:order:by-status-customer:${order.status}:${order.customer}:${order.id}`, order);
            }

            puter.print('<b>Stored read paths</b><br>');
            puter.print('demo:order:by-status:pending:*<br>');
            puter.print('demo:order:by-customer:alice:*<br>');
            puter.print('demo:order:by-status-customer:pending:alice:*<br><br>');

            const pendingOrders = await puter.kv.list('demo:order:by-status:pending:*', true);
            puter.print('<b>Query: status = pending</b><br>');
            pendingOrders.forEach(({ key, value }) => {
                puter.print(`${key} => ${value.customer} ($${value.total})<br>`);
            });
            puter.print('<br>');

            const aliceOrders = await puter.kv.list('demo:order:by-customer:alice:*', true);
            puter.print('<b>Query: customer = alice</b><br>');
            aliceOrders.forEach(({ key, value }) => {
                puter.print(`${key} => ${value.status} ($${value.total})<br>`);
            });
            puter.print('<br>');

            const alicePendingOrders = await puter.kv.list('demo:order:by-status-customer:pending:alice:*', true);
            puter.print('<b>Query: status = pending AND customer = alice</b><br>');
            alicePendingOrders.forEach(({ key, value }) => {
                puter.print(`${key} => order ${value.id} ($${value.total})<br>`);
            });
            puter.print('<br>');

            puter.print('<b>Takeaway</b><br>');
            puter.print('With puter.kv.list(), filtering comes from key prefixes.<br>');
            puter.print('If you need another query path, add another prefix-friendly key.<br><br>');

            // Cleanup
            for (const order of orders) {
                await puter.kv.del(`demo:order:by-id:${order.id}`);
                await puter.kv.del(`demo:order:by-status:${order.status}:${order.id}`);
                await puter.kv.del(`demo:order:by-customer:${order.customer}:${order.id}`);
                await puter.kv.del(`demo:order:by-status-customer:${order.status}:${order.customer}:${order.id}`);
            }
        })();
    </script>
</body>
</html>
```
