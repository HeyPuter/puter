---
title: puter.kv.remove()
description: Remove values at one or more paths from a key.
platforms: [websites, apps, nodejs, workers]
---

Remove values from an existing key by path. Paths use dot notation to target nested fields.

## Syntax

```js
puter.kv.remove(key, ...paths)
```

## Parameters

#### `key` (String) (required)

The key to remove values from.

#### `paths` (String[]) (required)

One or more dot-separated paths to remove (for example, `"profile.bio"`).

## Return value

Returns a `Promise` that resolves to the updated value stored at `key`.

## Examples

<strong class="example-title">Remove nested fields from an object</strong>

```html;kv-remove
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            await puter.kv.set('profile', { name: 'Puter', stats: { score: 10, level: 2 } });

            const updated = await puter.kv.remove('profile', 'stats.score');
            puter.print(`Updated profile: ${JSON.stringify(updated)}`);
        })();
    </script>
</body>
</html>
```
