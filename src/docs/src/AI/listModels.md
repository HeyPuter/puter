---
title: puter.ai.listModels()
description: Retrieve the available AI chat models (and providers) that Puter currently exposes.
platforms: [websites, apps, nodejs, workers]
---

Returns the AI chat/completion models that are currently available to your app. The list is pulled from the same source as the public `/puterai/chat/models/details` endpoint and includes pricing and capability metadata where available.

## Syntax

```js
puter.ai.listModels(provider = null)
```

## Parameters

#### `provider` (String) (Optional)

A string containing the provider you want to list the models for.

## Return value

Resolves to an array of model objects. Each object always contains `id` and `provider`, and may include fields such as `name`, `aliases`, `context`, `max_tokens`, and a `cost` object (`currency`, `tokens`, `input` and `output` costs in cents). Additional provider-specific capability fields may also be present.

Example model entry:

```json
[
  {
    "id": "claude-opus-4-5",
    "provider": "claude",
    "name": "Claude Opus 4.5",
    "aliases": ["claude-opus-4-5-latest"],
    "context": 200000,
    "max_tokens": 64000,
    "cost": {
      "currency": "usd-cents",
      "tokens": 1000000,
      "input": 500,
      "output": 2500
    }
  }
]
```

## Examples

```html;ai-list-models
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            // Fetch all models
            const models = await puter.ai.listModels();
            puter.print('First model:', JSON.stringify(models[0]));
        })();
    </script>
</body>
</html>
```
