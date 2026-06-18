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

- `tool_call_id` (String) - An optional identifier linking this message to the tool call it responds to.

- `cache_control` (Object) - An optional object controlling prompt caching for this message. Contains a `type` (String) property.

- `images` (Array) - An array of image content objects associated with the message. Each object contains a `type` (String) and an `image_url` object with a `url` (String) property.
