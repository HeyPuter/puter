---
title: TTSEngine
description: The TTSEngine object describing an available text-to-speech engine/model.
---

The `TTSEngine` object describes a text-to-speech engine/model available from a provider, including pricing metadata where available. Arrays of these objects are returned by [`puter.ai.txt2speech.listEngines()`](/AI/txt2speech.listEngines).

## Attributes

#### `id` (String)

The engine/model identifier.

#### `name` (String)

A human-readable engine name.

#### `provider` (String)

The provider this engine belongs to, e.g. `'aws-polly'`, `'openai'`, `'elevenlabs'`, `'gemini'`, `'xai'`.

#### `pricing_per_million_chars` (Number)

An optional cost per million characters. May be absent when the provider does not expose pricing.
