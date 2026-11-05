---
title: puter.fs.space()
description: Check how much storage capacity the user has and how much they have used.
platforms: [websites, apps, nodejs, workers]
---

Returns the storage capacity and usage of the current user.

## Syntax

```js
puter.fs.space()
```

## Parameters

None.

## Return value

A `Promise` that resolves to a [`SpaceInfo`](/Objects/spaceinfo/) object with these properties:

- `capacity` (Number): The total storage capacity available to the user, in bytes.
- `used` (Number): The amount of storage the user has used, in bytes.

## Examples

<strong class="example-title">Show how much storage the user has used</strong>

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            const { used, capacity } = await puter.fs.space();
            const toMB = (bytes) => (bytes / 1024 / 1024).toFixed(1);
            puter.print(`Used ${toMB(used)} MB of ${toMB(capacity)} MB`);
        })();
    </script>
</body>
</html>
```
