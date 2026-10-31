---
title: puter.kv.set()
description: Save or update values in the user's own key-value store.
platforms: [websites, apps, nodejs, workers]
---

Saves a value under a key in the user's key-value store, or replaces the value if the key already exists.

<div class="info">Each app has its own key-value store within each user's account. Another app can reach it only if the user grants that with <a href="/Perms/appData/">puter.perms.request('appData', …)</a>, and never reaches entries you write with <code>disableSharing</code>.</div>

## Syntax

```js
puter.kv.set(key, value)
puter.kv.set(key, value, expireAt)
puter.kv.set(key, value, optConfig)
puter.kv.set(key, value, expireAt, optConfig)
puter.kv.set({ key, value, expireAt, optConfig })
puter.kv.set([ { key, value, expireAt }, ... ])
puter.kv.set([ { key, value, expireAt }, ... ], optConfig)
puter.kv.set({ items: [ { key, value, expireAt }, ... ], optConfig })
```

## Parameters

#### `key` (String) (required)

The key to create or update, at most **1 KB** (1,024 bytes of UTF-8). A longer key rejects with `key_too_large`.

#### `value` (String | Number | Boolean | Object | Array) (required)

The value to store. Objects and arrays come back the same way they were stored. A value can be at most **399 KB** ([`puter.kv.MAX_VALUE_SIZE`](/KV/MAX_VALUE_SIZE/) bytes), measured as the UTF-8 bytes of its JSON encoding, so a string's quotes and escapes count. A larger value rejects with `value_too_large`.

Every number in the value, at any depth, must be within **±9,007,199,254,740,991** (`Number.MAX_SAFE_INTEGER`). A number past that is stored clamped to the bound, and `NaN` is stored as `null`. Store an id or a total that has to stay exact past that point as a string.

A value can be at most 32 levels deep. The value itself is the first level, and each object or array inside it adds one, so `{ a: { b: 1 } }` is 3 levels deep. A deeper value rejects with `bad_request`.

#### `expireAt` (Number | null) (optional)

The Unix timestamp, in seconds, when the key expires. Omit it, or pass `null`, `0`, an empty string, or `false`, for no expiry. A timestamp at or before now stores the key already expired. A numeric string such as `'1767225600'` is read as that number, and any other text rejects with `bad_request`.

Every `set()` replaces the whole entry, TTL included, so a later `set()` without `expireAt` clears the TTL.

#### `optConfig` (Object) (optional)

<div class="info">KV sharing is in beta. Method shapes, limits, and behavior may change between releases.</div>

The last argument. It takes these properties:

- `disableSharing` (Boolean): Makes the entry private to your app. See [Private entries](#private-entries).
- `onlyIfAbsent` (Boolean): Writes the key only when it has no live entry. See [Writing only if absent](#writing-only-if-absent). The batch form rejects it with `invalid_request`.
- `handle` (String): Writes into data another user shared with you, using the `handle` from [`puter.kv.listShared()`](/KV/listShared/). The key is then relative to the shared prefix and can be at most 768 bytes, and the share needs `write` access. See [Sharing with other users](/KV/#sharing-with-other-users).
- `appUuid` (String): Writes to another app's data, which the user let your app reach with [`puter.perms.request('appData', …)`](/Perms/appData/).

The `handle` option can't be combined with `appUuid` or `disableSharing`.

#### `items` (Array) (batch only)

An array of `{ key, value, expireAt? }` objects, written in one request. Pass it directly, as in `set([...])`, or wrapped, as in `set({ items: [...] })`. A batch can have at most **1,000** items. A larger one is rejected with `bad_request`, and nothing is written. Each item follows the same key and value limits.

## Return value

A `Promise` that resolves to `true` when the key was written. With `onlyIfAbsent`, it resolves to `false` when a live entry already held the key and nothing was written.

## Private entries

An entry written with `disableSharing: true` is private to your app. No other app can read, list, change, or delete it, even one the user let reach your app's data with [`puter.perms.request('appData', …)`](/Perms/appData/). Use it for anything another app should never see, such as a cached access token. A user approving such a request can't see what your store holds.

A private entry is also hidden from users you share its prefix with through [`puter.kv.share()`](/KV/share/). They can't read, list, or watch it. Deleting it through the share resolves the same way deleting a missing key does and leaves the entry in place. Any other write to it through the share is refused with `kv_handle_access_denied`. So a holder with write access can tell that the key exists, but can't read its value.

Your own app reads and writes the entry normally. Writing the key again without the flag makes it shareable again, since `set()` replaces the whole entry. In the batch form, `disableSharing` marks every entry in the batch.

## Writing only if absent

With `onlyIfAbsent: true`, `set()` writes the key only when it has no live entry. An expired entry counts as absent. When a live entry holds the key, nothing is written and the promise resolves to `false`.

Two writes at nearly the same time from different places may both succeed and both resolve to `true`, and the later write wins. Use it to create something once where a rare double create is harmless, such as claiming a room id or setting up a new document. It isn't a lock, and it can't hand out unique numbers. For a log of changes, give each change its own key, such as `chg:<timestamp>-<writer>-<random>`, and order the changes by timestamp instead of using a shared counter. A counter kept with [`puter.kv.incr()`](/KV/incr/) has the same limit.

## Errors

The promise rejects with `{ message, code }`:

| Code | Meaning |
| -- | -- |
| `key_too_large` | A key is over 1 KB. |
| `value_too_large` | A value is over 399 KB. |
| `bad_request` | A value is nested more than 32 levels deep, `expireAt` is text that isn't a number, a batch has more than 1,000 items, `onlyIfAbsent` isn't `true` or `false`, or `disableSharing` was passed with another app's `appUuid`. |
| `invalid_request` | `onlyIfAbsent` was passed to the batch form. |
| `forbidden` | `appUuid` names another app's data that your app may not write, or the entry is private to that app. |
| `subject_does_not_exist` | `appUuid` names an app that doesn't exist. |
| `kv_handle_not_found` | `handle` doesn't exist, the share stopped, it isn't shared with you, or the call comes from an app other than the one whose data it shares. |
| `kv_handle_access_denied` | The share's access is below `write`, or a key is private to the owner's app. |
| `kv_handle_option_invalid` | `handle` was combined with `appUuid` or `disableSharing`. |
| `kv_handle_key_invalid` | With `handle`, a key is empty or longer than 768 bytes. |
| `kv_handles_disabled` | Shares can't be used this way on this deployment. |

## Examples

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

<strong class="example-title">Claim a name only if nobody has it yet</strong>

```js
const claimed = await puter.kv.set('room:lobby', { createdAt: Date.now() }, { onlyIfAbsent: true });
puter.print(claimed ? 'Room created' : 'That room already exists');
```

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
