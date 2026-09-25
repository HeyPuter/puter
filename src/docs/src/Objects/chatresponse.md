---
title: ChatResponse
description: The ChatResponse object containing AI chat response data.
---

The `ChatResponse` object containing AI chat response data.

## Attributes

#### `message` (Object)

An object containing the chat message data.

- `role` (String) - The role of the message sender.

- `content` (String | Array) - The content of the message. On normalized (OpenAI-format) responses — which includes all models released on or after September 1, 2026 and any call made with `normalize: true` — this is a string, or `null` when the model returned only tool calls and no text. On older Anthropic models without `normalize: true`, this is the vendor-native array of content blocks such as `[{ type: "text", text: "..." }]`. See [Response Normalization](/AI/chat#response-normalization).

- `tool_calls` (Array) - An optional array of [`ToolCall`](/Objects/toolcall) objects if the model wants to call tools.

- `reasoning` (String) - Optional extended-thinking output, when the model exposes it. Multiple reasoning segments are joined with a blank line between them.

- `reasoning_details` (Array) - Optional opaque reasoning artifacts from models that expose them. Present on normalized Anthropic responses, and on OpenAI Responses-API models whether or not the response was normalized. Contents: Anthropic `thinking`/`redacted_thinking` blocks with their `signature`, or OpenAI reasoning items with their `id` and `encrypted_content`. Treat the contents as opaque and resend the array verbatim to continue an extended-thinking turn — providers reject a continuation whose reasoning lost its signature. The human-readable text is in `reasoning`; this field is only for the round trip.

- `tool_call_id` (String) - An optional identifier linking this message to the tool call it responds to.

- `cache_control` (Object) - An optional object controlling prompt caching for this message. Contains a `type` (String) property.

- `images` (Array) - An array of image content objects associated with the message. Each object contains a `type` (String) and an `image_url` object with a `url` (String) property.

#### `finish_reason` (String)

Why generation stopped. On normalized responses, known vendor stop reasons map to the OpenAI vocabulary — `stop`, `length`, `tool_calls`, or `content_filter` — and a vendor value with no OpenAI analog passes through unchanged rather than being flattened to `stop`.

Anthropic models are the main source of both cases. Their stop reasons map as follows:

| Anthropic `stop_reason` | Normalized `finish_reason` | Meaning |
| --- | --- | --- |
| `end_turn` | `stop` | The model finished its turn. |
| `stop_sequence` | `stop` | One of your stop sequences was produced. |
| `max_tokens` | `length` | The token limit was hit mid-answer. |
| `tool_use` | `tool_calls` | The model wants to call a tool; see `message.tool_calls`. |
| `refusal` | `content_filter` | The model declined to continue. |
| `pause_turn` | `pause_turn` | A long-running server-side tool turn was paused — it has no OpenAI analog, so it passes through unchanged. Send the response back as-is to let the model continue. |

Because unmapped values pass through, treat `finish_reason` as an open set: branch on the four OpenAI values you care about and handle anything else as vendor-specific rather than assuming it means `stop`.

#### `normalized` (Boolean)

Present and `true` when the response was normalized to the OpenAI format (see [Response Normalization](/AI/chat#response-normalization)).

#### `usage` (Object)

Token accounting for the request. Values are always numbers, but the key names are provider-specific: most OpenAI-compatible providers report `prompt_tokens`, `completion_tokens`, and `cached_tokens`, while Anthropic and OpenAI Responses models report `input_tokens` and `output_tokens`.

#### `compaction` (Object)

Present only on non-streaming responses where the model compacted earlier context (see [Compaction](/AI/chat#compaction)). A drop-in `messages` item of the form `{ type: 'compaction', id, encrypted_content }` — resend it on the next turn in place of the summarized history. Absent when no compaction occurred.
