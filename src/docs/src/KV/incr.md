---
title: puter.kv.incr()
description: Increment values in the user's own key-value store by a specified amount.
platforms: [websites, apps, nodejs, workers]
---

Increments the value of a key. A missing or expired key starts from 0 and loses any TTL it had; a live TTL is kept. Rejects if the target — the whole value, or with a path map the field at each path — holds anything other than a number, including a numeric string.

## Syntax

```js
puter.kv.incr(key)
puter.kv.incr(key, amount)
puter.kv.incr(key, pathAndAmount)
```

## Parameters

#### `key` (String) (required)

The key of the value to increment.

#### `amount` (Number | Object) (optional)

The amount to increment the value by, which may be fractional or negative. Defaults to 1.

When `amount` is an object: Increments a property within an object value stored in the key.

- Key: the path to the property (e.g., `"user.score"`)
- Value: the amount to increment by

`amount` must be within **±9,007,199,254,740,991** (`Number.MAX_SAFE_INTEGER`); a larger one is applied clamped to that bound. A counter stays exact only while its total is inside the same range — store anything that has to count past it as a string with [`puter.kv.set()`](/KV/set/).

Paths support dot notation, array indexes at any level (`[0]`, `items[0]`, or `some.path[1].to.value`), and quoted property names (`["key.with.dots"]`). An empty path (`""`) targets the whole stored value. Use non-negative integer indexes in brackets to address arrays. When a path continues through an array element (for example, `[0].score`), that element must already exist. Missing object parents are created automatically; sparse array elements are not created. A path may chain at most 31 levels; a deeper one rejects with `bad_request`. Quoted names can't be empty. All of a call's paths go into one write, so a call fits at most 1,500 path segments and, with short field names, about 60 paths; split larger changes across calls. See [Rate Limits and Quotas](/rate-limits-and-quotas/).

## Return Value

Returns the new value of the key after the increment operation — a number for the plain form, or the whole stored value when `amount` is a path map.

## Errors

A rejection carries an `Error` with a stable `code`:

| Code | Meaning |
| -- | -- |
| `key_undefined` | No key was given. |
| `key_too_large` | The key is over the 1 KB limit. |
| `arguments_required` | Called with no arguments at all. |
| `value_not_a_number` | The value, or with a path map the field at a path, isn't a number. |
| `invalid_path` | A path map addressed a field inside a stored number, boolean, null, string, or array, or went through a missing array element. |
| `value_too_large` | The write would take the stored value over 400 KB. |
| `bad_request` | A malformed path (including an empty quoted name such as `[""]`), a path nested over 31 levels, two paths that overlap (one is the same as or inside the other) or conflict (one treats a shared step as a list index, the other as a field name), more or longer paths than one write can apply (see [Rate Limits and Quotas](/rate-limits-and-quotas/)), or an amount that isn't a number. |
| `insufficient_funds` | No usage left on the account. |
| `forbidden` | Called with `optConfig.appUuid` for another app's data without permission, or the entry is private to that app. |
| `subject_does_not_exist` | `optConfig.appUuid` names an app that doesn't exist. |
| `response_timeout` | Too many writers on the key right now — retry. |
| `too_many_requests` | The rate limit was exceeded. See [Rate Limits and Quotas](/rate-limits-and-quotas/). |

## Examples

<strong class="example-title">Increment the value of a key</strong>

```html;kv-incr
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        puter.kv.incr('testIncrKey').then((newValue) => {
            puter.print(`New value: ${newValue}`);
        });
    </script>
</body>
</html>
```

<strong class="example-title">Increment a property within an object value</strong>

```html;kv-incr-nested
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            // If 'stats' contains: { user: { score: 10 } }
            await puter.kv.set('stats', {user: {score: 10}})

            // This increments user.score by 2
            const newValue = await puter.kv.incr('stats', {"user.score": 2});

            // newValue will be: { user: { score: 12 } }
            puter.print(`New value: ${JSON.stringify(newValue)}`);
        })();
    </script>
</body>
</html>
```
