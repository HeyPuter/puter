---
title: ChatResponseChunk
description: The ChatResponseChunk object containing a chunk of streaming chat response data.
---

The `ChatResponseChunk` object containing a chunk of streaming chat response data.

Each chunk has a `type` indicating its kind. The other attributes that are present depend on that `type`.

## Attributes

#### `type` (String)

The kind of chunk. One of:

- `"text"` - A portion of the response text.
- `"reasoning"` - A portion of the model's reasoning/thinking output.
- `"tool_use"` - A tool/function the model wants to call.
- `"compaction"` - An inline-compaction summary of earlier context (when `compaction` is enabled).
- `"extra_content"` - Provider-specific metadata.
- `"usage"` - Token usage totals, emitted as the final chunk.

#### `text` (String)

A portion of the chat response text. Present on `text` chunks.

#### `reasoning` (String)

A portion of the model's reasoning output. Present on `reasoning` chunks.

#### `id` (String)

The unique identifier for the tool call (`tool_use` chunks) or the compaction item (`compaction` chunks).

#### `encrypted_content` (String)

The opaque/encrypted compaction summary. Present on `compaction` chunks. The shape is identical across providers — resend this item in `messages` on the next turn in place of the summarized history.

#### `name` (String)

The name of the function/tool to call. Present on `tool_use` chunks.

#### `input` (Object)

The parsed arguments for the tool call. Present on `tool_use` chunks.

#### `extra_content`

Provider-specific metadata attached to the stream.

#### `usage` (Object)

An object containing token usage totals. Present on the final `usage` chunk.
