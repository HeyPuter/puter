---
title: puter.ai.listModelProviders()
description: Retrieve the available AI providers that Puter currently exposes.
platforms: [websites, apps, nodejs, workers]
---

Returns the AI providers that are available through Puter.js.

## Syntax

```js
puter.ai.listModelProviders()
```

## Parameters

None

## Return value

A `Promise` that will resolve to an array of string containing each AI providers.

## Examples

```html;ai-list-model-providers
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            // Fetch all providers
            const providers = await puter.ai.listModelProviders();
            puter.print(providers)
        })();
    </script>
</body>
</html>
```
