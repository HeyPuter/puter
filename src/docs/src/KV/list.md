---
title: puter.kv.list()
description: Retrieve all keys from your app's key-value store.
platforms: [websites, apps, nodejs, workers]
---

Returns an array of all keys in the user's key-value store for the current app. If the user has no keys, the array will be empty.

Because filtering is prefix-based, `list()` works best when you design keys around the read patterns your app needs. In practice, that means your key naming convention becomes your query plan.

Results are sorted lexicographically (string order) by key.

## Syntax

```js
puter.kv.list()
puter.kv.list(pattern)
puter.kv.list(returnValues = false)
puter.kv.list(pattern, returnValues = false)
puter.kv.list(options)
```

## Parameters

#### `pattern` (String) (optional)

If set, only keys that match the given pattern will be returned. The pattern is prefix-based and can include a `*` wildcard only at the end. For example, `abc` and `abc*` both match keys that start with `abc` (such as `abc`, `abc123`, `abc123xyz`). If you need to match a literal `*` in the prefix, use `*` at the end (for example, `key**` matches keys that start with `key*`, or `k*y*` will match `k*y` prefixes). Default is `*`, which matches all keys.

#### `returnValues` (Boolean) (optional)

If set to `true`, the returned array will contain objects with both `key` and `value` properties. If set to `false`, the returned array will contain only the keys. Default is `false`.

#### `options` (Object) (optional)

An object with the following optional properties:

- `pattern` (String): Same as the `pattern` parameter.
- `returnValues` (Boolean): Same as the `returnValues` parameter.
- `limit` (Number): Maximum number of items to return in a single call.
- `cursor` (String): A pagination cursor from a previous call.

## Return value

A `Promise` that will resolve to either:

- An array of all keys the user has for the current app, or
- An array of [`KVPair`](/Objects/kvpair) objects containing the user's key-value pairs for the current app, or
- A [`KVListPage`](/Objects/kvlistpage) object when using `limit` or `cursor` in `options`

If the user has no keys, the array will be empty.

## Examples

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
            // Wrong — will sort as 1, 10, 100, 2, 20
            await puter.kv.set('item:1', '...');
            await puter.kv.set('item:10', '...');
            await puter.kv.set('item:2', '...');

            // Correct — zero-pad to a fixed width
            await puter.kv.set('item:001', '...');
            await puter.kv.set('item:002', '...');
            await puter.kv.set('item:010', '...');
            await puter.kv.set('item:100', '...');

            const items = await puter.kv.list('item:*');
            puter.print('Items with zero-padding: <br/>');
            puter.print(items.join('<br/>'));

            // Cleanup
            await puter.kv.del('item:1');
            await puter.kv.del('item:10');
            await puter.kv.del('item:2');
            await puter.kv.del('item:001');
            await puter.kv.del('item:002');
            await puter.kv.del('item:010');
            await puter.kv.del('item:100');
        })();
    </script>
</body>
</html>
```
