---
title: puter.ai.txt2speech.listEngines()
description: List available TTS engines/models with pricing information.
platforms: [websites, apps, nodejs, workers]
---

Returns the TTS engines (models) available from a given provider, including pricing metadata where available.

## Syntax

```js
puter.ai.txt2speech.listEngines()
puter.ai.txt2speech.listEngines(provider)
puter.ai.txt2speech.listEngines(options)
```

## Parameters

#### `provider` (String) (optional)

A provider name to query. When passed as a string, this is shorthand for `{ provider }`. Defaults to `'aws-polly'`.

Accepted values: `'aws-polly'`, `'openai'`, `'elevenlabs'`, `'gemini'`, `'xai'`

Common aliases are also accepted (e.g. `'eleven'`, `'google'`, `'grok'`).

#### `options` (Object) (optional)

| Option | Type | Description |
|--------|------|-------------|
| `provider` | `String` | TTS provider to query. Defaults to `'aws-polly'` |

## Return value

A `Promise` that resolves to an array of engine objects. Each object contains:

| Field | Type | Description |
|-------|------|-------------|
| `id` | `String` | Engine/model identifier |
| `name` | `String` | Human-readable engine name |
| `provider` | `String` | Provider this engine belongs to |
| `pricing_per_million_chars` | `Number` | Cost per million characters (may be absent) |

Example response:

```json
[
  {
    "id": "gpt-4o-mini-tts",
    "name": "GPT-4o Mini TTS",
    "provider": "openai",
    "pricing_per_million_chars": 12
  },
  {
    "id": "tts-1",
    "name": "TTS-1",
    "provider": "openai"
  }
]
```

## Examples

<strong class="example-title">List engines for a specific provider</strong>

```html;ai-txt2speech-list-engines
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            const engines = await puter.ai.txt2speech.listEngines('openai');
            puter.print('OpenAI TTS engines:');
            for (const engine of engines) {
                puter.print(`  ${engine.id} - ${engine.name}`);
            }
        })();
    </script>
</body>
</html>
```

<strong class="example-title">List engines using options object</strong>

```js
const engines = await puter.ai.txt2speech.listEngines({ provider: 'elevenlabs' });
for (const engine of engines) {
    console.log(engine.id, engine.name);
}
```
