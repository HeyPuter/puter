---
title: ChatResponse
description: The ChatResponse object containing AI chat response data.
---

The `ChatResponse` object containing AI chat response data.

## Attributes

#### `message` (Object)

An object containing the chat message data.

- `role` (String) - The role of the message sender.

- `content` (String) - The content of the message.

- `tool_calls` (Array) - An optional array of [`ToolCall`](/Objects/toolcall) objects if the model wants to call tools.
