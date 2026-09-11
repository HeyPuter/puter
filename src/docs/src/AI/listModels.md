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

Resolves to an array of model objects. Each object always contains `id` and `provider`, and may include fields such as `name`, `aliases`, `context` and `max_tokens`.

Pricing is reported as a `costs` object alongside `costs_currency`. The keys of `costs` differ by vendor, so each model names its own with `input_cost_key` and `output_cost_key`; read prices through those rather than hard-coding a key. `costs.tokens` is the number of tokens the prices are quoted per — 1,000,000 throughout — and the remaining keys cover vendor-specific extras such as cache reads. Additional provider-specific capability fields may also be present.

A model sold at several service tiers appears once per tier, under ids suffixed with the tier name (`…:flex`, `…:priority`), each carrying its own `costs` and `context`. See [Service tiers](/AI/chat#service-tiers) for how to pick one.

Example model entry:

```json
[
  {
    "id": "claude-opus-4-5-20251101",
    "provider": "claude",
    "name": "Claude Opus 4.5",
    "aliases": ["claude-opus-4-5-latest", "claude-opus-4-5"],
    "context": 200000,
    "max_tokens": 64000,
    "costs_currency": "usd-cents",
    "input_cost_key": "input_tokens",
    "output_cost_key": "output_tokens",
    "costs": {
      "tokens": 1000000,
      "input_tokens": 500,
      "cache_read_input_tokens": 50,
      "output_tokens": 2500
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
