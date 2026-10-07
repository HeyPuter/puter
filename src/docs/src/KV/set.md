---
title: puter.kv.set()
description: Save or update values in the user's own key-value store.
platforms: [websites, apps, nodejs, workers]
---

When passed a key and a value, will add it to the user's key-value store, or update that key's value if it already exists.

<div class="info">Each app has its own key-value store within each user's account. Another app can only reach it if the user explicitly grants that with <a href="/Perms/appData/">puter.perms.request('appData', …)</a> — and never for entries you write with <code>disableSharing</code>.</div>

## Syntax

```js
puter.kv.set(key, value)
puter.kv.set(key, value, expireAt)
puter.kv.set({ key, value, expireAt })
puter.kv.set([ { key, value, expireAt }, ... ])
puter.kv.set({ items: [ { key, value, expireAt }, ... ] })
```

## Parameters

#### `key` (String) (required)

A string containing the name of the key you want to create/update. The maximum allowed `key` size is **1 KB** (1,024 bytes of UTF-8); a longer key rejects with `key_too_large`.

#### `value` (String | Number | Boolean | Object | Array)

The value you want to give the key you are creating/updating. Objects and arrays are stored as-is and come back the same way. The maximum allowed `value` size is **400 KB**, measured as the UTF-8 bytes of the value's JSON encoding (a string's quotes and escapes count); a larger value rejects with `value_too_large`.

Numbers are stored with the precision JavaScript itself keeps: every number in the value — including one nested inside an object or array — must be within **±9,007,199,254,740,991** (`Number.MAX_SAFE_INTEGER`). A number past that is stored clamped to the bound rather than rejected, and `NaN` is stored as `null`. Store an id or a total that has to stay exact past that point as a string.

A value can be at most 32 levels deep, counting the value itself as the first level and each object or array inside it as one more (`{ a: { b: 1 } }` is 3 levels deep); a deeper one rejects with `bad_request`.

#### `expireAt` (Number | null) (optional)

A Unix timestamp in seconds at which the key should expire. Omit it, or pass `null` or `0`, for no expiry. A timestamp at or before now stores the key already expired. An empty string or `false` also means no expiry; a numeric string such as `'1767225600'` is read as that number, and any other text rejects with `bad_request`. Every `set()` replaces the whole entry, TTL included — a later `set()` with no `expireAt` clears an existing one.

#### `disableSharing` (Boolean) (optional)

Pass inside the trailing options object — `set(key, value, { disableSharing: true })` — to mark this entry private to your app. A private entry cannot be read, listed, changed, or deleted by any other app, even one the user has granted access to your app's data with [`puter.perms.request('appData', …)`](/Perms/appData/). It is also not watched by other apps, or by another user through a [share handle](/Events/onLocal/#sharing-key-value-events-with-another-user): those subscriptions get no event, key, or value for it. Use it for anything another app should never see, such as a cached access token: a user approving a request cannot see what your store holds.

The batch form takes it too — `set([...items], { disableSharing: true })` marks every entry in the batch.

Your own app reads and writes the entry normally. Writing the same key again without the flag makes it shareable once more, since `set` replaces the whole entry.

#### `items` (Array) (batch only)

An array of `{ key, value, expireAt? }` objects, set in a single request. At most **1,000** items per call; a larger batch is rejected with `bad_request` and nothing is written. Each `key` is required and follows the same **1 KB** key / **400 KB** value limits. You can pass the array directly (`set([...])`) or wrapped in an object (`set({ items: [...] })`).

You may also pass a single object instead of positional arguments: `set({ key, value, expireAt })`.

## Return value

A `Promise` that will resolve to `true` when the key-value pair has been created or the existing key's value has been updated.

## Examples

<strong class="example-title">Store a value no other app can ever read</strong>

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        puter.kv.set('accessToken', 'secret-value', { disableSharing: true })
            .then(() => puter.print('Stored privately'));
    </script>
</body>
</html>
```

<strong class="example-title">Create a new key-value pair</strong>

```html;kv-set
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        puter.kv.set('name', 'Puter Smith').then((success) => {
            puter.print(`Key-value pair created/updated: ${success}`);
        });
    </script>
</body>
</html>
```

<strong class="example-title">Set multiple key-value pairs at once</strong>

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            await puter.kv.set([
                { key: 'name', value: 'Puter Smith' },
                { key: 'age',  value: 21 },
            ]);
            puter.print('Batch set complete');
        })();
    </script>
</body>
</html>
```
