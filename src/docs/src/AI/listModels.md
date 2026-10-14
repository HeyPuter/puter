---
title: puter.ai.listModels()
description: Retrieve the available AI chat models (and providers) that Puter currently exposes.
platforms: [websites, apps, nodejs, workers]
---

Returns the AI chat/completion models that are currently available to your app, including pricing and capability metadata where available.

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
    "id": "claude-opus-4-8",
    "provider": "claude",
    "name": "Claude Opus 4.8",
    "aliases": ["claude-opus-4-8-latest"],
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

Network and server failures reject the promise; they do not resolve to an empty
catalogue. Network failures use `{ message, code: "network_error" }`, invalid
catalogue responses use `invalid_response`, idle timeouts use `request_timeout`,
and server errors pass through unchanged.

<div class="info">Successful results are cached for 60 seconds per provider.</div>

## Model variants

Some models have variants. A variant is the same model with a different price, rate limit, or speed. The variant is a suffix on the model ID, separated by a colon.

| Suffix | Meaning |
| --- | --- |
| `:free` | Free. The provider sets rate limits and daily quotas, and may remove the variant at any time. |
| `:flex` | Cheaper than the base model. Requests may be slower and may be rejected when the provider is under load. |
| `:priority` | Faster than the base model. Costs more. |

The model ID without a suffix is the standard variant. Not every model has variants. `:flex` and `:priority` are the provider's service tiers. To use a variant, pass its full ID as the `model` option. Options and response shape are the same as the base model. Price, context window, and max output length can differ. The model's page lists its variants and their limits.

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
