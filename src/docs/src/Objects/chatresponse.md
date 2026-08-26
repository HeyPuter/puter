---
title: ChatResponse
description: The ChatResponse object containing AI chat response data.
---

The `ChatResponse` object containing AI chat response data.

## Attributes

#### `message` (Object)

An object containing the chat message data.

- `role` (String) - The role of the message sender.

- `content` (String | Array) - The content of the message. A string on normalized (OpenAI-format) responses — which includes all models released on or after September 1, 2026 and any call made with `normalize: true`. On older Anthropic models without `normalize: true`, this is the vendor-native array of content blocks such as `[{ type: "text", text: "..." }]`. See [Response Normalization](/AI/chat#response-normalization).

- `tool_calls` (Array) - An optional array of [`ToolCall`](/Objects/toolcall) objects if the model wants to call tools.

- `reasoning` (String) - Optional extended-thinking output, when the model exposes it.

- `tool_call_id` (String) - An optional identifier linking this message to the tool call it responds to.

- `cache_control` (Object) - An optional object controlling prompt caching for this message. Contains a `type` (String) property.

- `images` (Array) - An array of image content objects associated with the message. Each object contains a `type` (String) and an `image_url` object with a `url` (String) property.

#### `finish_reason` (String)

Why generation stopped. On normalized responses, known vendor stop reasons map to `stop`, `length`, `tool_calls`, or `content_filter`; a vendor value with no OpenAI analog passes through unchanged.

#### `normalized` (Boolean)

Present and `true` when the response was normalized to the OpenAI format (see [Response Normalization](/AI/chat#response-normalization)).

#### `usage` (Object)

Token accounting for the request. Values are always numbers, but the key names are provider-specific: most OpenAI-compatible providers report `prompt_tokens`, `completion_tokens`, and `cached_tokens`, while Anthropic and OpenAI Responses models report `input_tokens` and `output_tokens`.

#### `compaction` (Object)

Present only on non-streaming responses where the model compacted earlier context (see [Compaction](/AI/chat#compaction)). A drop-in `messages` item of the form `{ type: 'compaction', id, encrypted_content }` — resend it on the next turn in place of the summarized history. Absent when no compaction occurred.
