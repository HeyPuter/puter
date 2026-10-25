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
puter.kv.set(key, value, optConfig)
puter.kv.set(key, value, expireAt, optConfig)
puter.kv.set({ key, value, expireAt, optConfig })
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

Pass inside the trailing options object, as in `set(key, value, { disableSharing: true })`, to mark this entry private to your app. A private entry cannot be read, listed, changed, or deleted by any other app, even one the user has granted access to your app's data with [`puter.perms.request('appData', …)`](/Perms/appData/). It is also hidden from another user you share its prefix with through [`puter.kv.share()`](/KV/share/). They can't read, list, or watch it, and a write to it through the share is refused. Use it for anything another app should never see, such as a cached access token. A user approving a request can't see what your store holds. It can't be combined with `appUuid` or `handle`.

The batch form takes it too — `set([...items], { disableSharing: true })` marks every entry in the batch.

Your own app reads and writes the entry normally. Writing the same key again without the flag makes it shareable once more, since `set` replaces the whole entry.

#### `onlyIfAbsent` (Boolean) (optional)

Pass inside the trailing options object, as in `set(key, value, { onlyIfAbsent: true })`, to write the key only when it has no live entry. An expired entry counts as absent. When a live entry holds the key, nothing is written and the promise resolves to `false`.

Two writes at nearly the same time from different places may both succeed and both get `true`, and the later write wins. Use it to create something once where a rare double create is harmless, such as claiming a room id or setting up a new document. It isn't a lock, and it can't hand out unique numbers. For a log of changes, give each change its own key, such as `chg:<timestamp>-<writer>-<random>`, and order the changes by timestamp instead of using a shared counter. A counter kept with [`puter.kv.incr()`](/KV/incr/) has the same limit.

The batch form rejects it with `invalid_request`.

#### `handle` (String) (optional)

Pass inside the trailing options object, as in `set(key, value, { handle })`, to write into data another user shared with you, using the `handle` from [`puter.kv.listShared()`](/KV/listShared/). The key is then relative to the shared prefix, and the share needs `write` access. See [Sharing with other users](/KV/#sharing-with-other-users). The batch form takes it too. With `handle`, a key can be at most 768 bytes.

#### `items` (Array) (batch only)

An array of `{ key, value, expireAt? }` objects, set in a single request. At most **1,000** items per call; a larger batch is rejected with `bad_request` and nothing is written. Each `key` is required and follows the same **1 KB** key / **400 KB** value limits. You can pass the array directly (`set([...])`) or wrapped in an object (`set({ items: [...] })`).

You may also pass a single object instead of positional arguments: `set({ key, value, expireAt })`.

## Return value

A `Promise` that will resolve to `true` when the key-value pair has been created or the existing key's value has been updated. With `onlyIfAbsent`, it resolves to `false` when a live entry already held the key and nothing was written.

## Errors

These codes come from the options above:

| Code | Meaning |
| -- | -- |
| `invalid_request` | `onlyIfAbsent` was passed to the batch form. |
| `bad_request` | `onlyIfAbsent` isn't `true` or `false`. |
| `kv_handle_not_found` | `handle` doesn't exist, the share stopped, or it isn't shared with you. |
| `kv_handle_access_denied` | The share's access is below `write`. |
| `kv_handle_option_invalid` | `handle` was combined with `appUuid` or `disableSharing`. |
| `kv_handle_key_invalid` | With `handle`, a key is empty or longer than 768 bytes. |
| `kv_handles_disabled` | Shares can't be used this way on this deployment. |

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

<strong class="example-title">Claim a name only if nobody has it yet</strong>

```js
const claimed = await puter.kv.set('room:lobby', { createdAt: Date.now() }, { onlyIfAbsent: true });
puter.print(claimed ? 'Room created' : 'That room already exists');
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
