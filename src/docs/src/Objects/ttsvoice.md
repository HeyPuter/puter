---
title: TTSVoice
description: The TTSVoice object describing an available text-to-speech voice.
---

The `TTSVoice` object describes a text-to-speech voice available from a provider, including metadata such as language, category, and supported models/engines. Arrays of these objects are returned by [`puter.ai.txt2speech.listVoices()`](/AI/txt2speech.listVoices).

## Attributes

#### `id` (String)

The voice identifier to pass to [`puter.ai.txt2speech()`](/AI/txt2speech).

#### `name` (String)

A human-readable voice name.

#### `provider` (String)

The provider this voice belongs to, e.g. `'aws-polly'`, `'openai'`, `'elevenlabs'`, `'gemini'`, `'xai'`.

#### `language` (Object)

An optional object describing the voice's language. Contains a `name` (String) and a `code` (String) property. May be absent.

#### `description` (String)

An optional short description of the voice. May be absent.

#### `category` (String)

An optional voice category, e.g. `'premade'`. May be absent.

#### `labels` (Object)

An optional object of provider-specific labels. May be absent.

#### `supported_models` (Array)

An optional array of model IDs (Strings) this voice works with. May be absent.

#### `supported_engines` (Array)

An optional array of engine types (Strings) this voice supports. May be absent.
