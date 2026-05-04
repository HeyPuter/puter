---
title: puter.ai.txt2speech.listVoices()
description: List available TTS voices, optionally filtered by provider.
platforms: [websites, apps, nodejs, workers]
---

Returns the voices available from a TTS provider. Each voice entry includes metadata such as language, category, and supported models.

## Syntax

```js
puter.ai.txt2speech.listVoices()
puter.ai.txt2speech.listVoices(options)
```

## Parameters

#### `options` (Object) (optional)

| Option | Type | Description |
|--------|------|-------------|
| `provider` | `String` | TTS provider to query. Defaults to `'aws-polly'`. Accepted: `'aws-polly'`, `'openai'`, `'elevenlabs'`, `'gemini'`, `'xai'` |
| `engine` | `String` | Engine/model filter (provider-specific, ignored by some providers) |

When `options` is a plain string it is treated as an `engine` filter for the default (AWS Polly) provider.

## Return value

A `Promise` that resolves to an array of voice objects. Each object contains:

| Field | Type | Description |
|-------|------|-------------|
| `id` | `String` | Voice identifier to pass to `txt2speech()` |
| `name` | `String` | Human-readable voice name |
| `provider` | `String` | Provider this voice belongs to |
| `language` | `Object` | `{ name, code }` language info (may be absent) |
| `description` | `String` | Short description of the voice (may be absent) |
| `category` | `String` | Voice category, e.g. `'premade'` (may be absent) |
| `labels` | `Object` | Provider-specific labels (may be absent) |
| `supported_models` | `Array` | Model IDs this voice works with (may be absent) |
| `supported_engines` | `Array` | Engine types this voice supports (may be absent) |

Example response:

```json
[
  {
    "id": "alloy",
    "name": "Alloy",
    "provider": "openai",
    "description": "A balanced, neutral voice"
  },
  {
    "id": "Joanna",
    "name": "Joanna",
    "provider": "aws-polly",
    "language": { "name": "English (US)", "code": "en-US" },
    "supported_engines": ["standard", "neural"]
  }
]
```

## Examples

<strong class="example-title">List voices for a provider</strong>

```html;ai-txt2speech-list-voices
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            const voices = await puter.ai.txt2speech.listVoices({ provider: 'openai' });
            puter.print('OpenAI voices:');
            for (const voice of voices) {
                puter.print(`  ${voice.id} - ${voice.name}`);
            }
        })();
    </script>
</body>
</html>
```

<strong class="example-title">List all default (AWS Polly) voices</strong>

```js
const voices = await puter.ai.txt2speech.listVoices();
for (const voice of voices) {
    const lang = voice.language ? ` (${voice.language.code})` : '';
    console.log(`${voice.id} - ${voice.name}${lang}`);
}
```

<strong class="example-title">List Gemini voices</strong>

```js
const voices = await puter.ai.txt2speech.listVoices({ provider: 'gemini' });
for (const voice of voices) {
    console.log(voice.id, voice.name);
}
```
