---
title: puter.kv.MAX_KEY_SIZE
description: Returns the maximum key size (in bytes) for the key-value store.
platforms: [websites, apps, nodejs, workers]
---

The largest key the key-value store accepts, in bytes. It's `1024` (1 KB). A key is measured in UTF-8 bytes, so a key with non-ASCII characters fits fewer characters. Through a share's `handle`, a key can be at most 768 bytes.

## Syntax

```js
puter.kv.MAX_KEY_SIZE
```

## Examples

<strong class="example-title">Get the max key size</strong>

```html
<html>
  <body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
      puter.print("Max Key Size: " + puter.kv.MAX_KEY_SIZE);
    </script>
  </body>
</html>
```
