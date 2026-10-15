---
title: puter.ai.assistant.connect()
description: Open a realtime voice and text session with OpenAI's Realtime API.
platforms: [websites, apps, nodejs]
---

Opens a live session with OpenAI's Realtime API through Puter. The session is a WebSocket: you send [OpenAI Realtime client events](https://developers.openai.com/api/docs/guides/realtime) and receive its server events unchanged, so OpenAI's realtime guides apply as written.

In Node.js this needs a global `WebSocket` (Node.js 22 or later).

## Syntax

```js
puter.ai.assistant.connect(options = {})
```

## Parameters

#### `options` (Object) (optional)

- `model` (String): The realtime model. `gpt-realtime-2.1-mini` (default), `gpt-realtime-2.1`, `gpt-realtime-2`, `gpt-realtime-1.5`, `gpt-realtime` or `gpt-realtime-mini`.

## Return value

A `Promise` that resolves to a session once the socket opens. The session has:

- `send(event)`: send a client event such as `{ type: 'response.create' }`. Throws `{ code: 'session_closed' }` once the session has closed.
- `on(type, handler)`: listen for server events by `type`. `'*'` receives every event, and `'close'` fires once with `{ code, reason }` when the session ends. Returns a function that removes the listener.
- `off(type, handler)`: remove a listener.
- `close()`: end the session.
- `socket`: the underlying `WebSocket`.

The promise rejects with `{ code: 'connection_failed' }` if the socket can't open, with `{ code: 'auth_canceled' }` if the user closes the browser sign-in prompt, and with `{ code: 'auth_required' }` when there is no signed-in user outside the browser.

Errors after the socket opens arrive the way OpenAI sends them: an `error` event whose `error.code` says what went wrong. Puter's own checks use the same shape and then close the session with code `1008`:

| `error.code`          | Meaning                                                        |
| --------------------- | -------------------------------------------------------------- |
| `invalid_api_key`     | The credential was missing or rejected.                        |
| `model_not_found`     | `model` isn't one of the realtime models above.                |
| `insufficient_funds`  | No usage left, at connect time or after a response.           |
| `rate_limit_exceeded` | Too many concurrent realtime sessions for this account.        |

Usage is charged per token at the model's rate, as each `response.done` arrives.

## Examples

<strong class="example-title">Text conversation</strong>

```js
const session = await puter.ai.assistant.connect();

session.on('response.output_text.delta', (e) => puter.print(e.delta));
session.on('response.done', () => session.close());

session.send({
    type: 'session.update',
    session: { type: 'realtime', output_modalities: ['text'] },
});
session.send({
    type: 'conversation.item.create',
    item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'Say hi in three words.' }],
    },
});
session.send({ type: 'response.create' });
```

<strong class="example-title">Spoken reply</strong>

Audio arrives as base64-encoded 24 kHz 16-bit mono PCM in `response.output_audio.delta` events.

```js
const session = await puter.ai.assistant.connect({ model: 'gpt-realtime-2.1' });
const chunks = [];

session.on('response.output_audio.delta', (e) => chunks.push(e.delta));
session.on('response.output_audio_transcript.done', (e) => puter.print(e.transcript));
session.on('response.done', () => session.close());

session.send({
    type: 'conversation.item.create',
    item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'Tell me a one-line joke.' }],
    },
});
session.send({ type: 'response.create' });
```
