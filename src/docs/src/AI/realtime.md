---
title: Realtime WebSocket API (Beta)
description: Connect to OpenAI realtime conversations through Puter without puter.js.
platforms: [websites, apps, nodejs, workers]
---

The Realtime WebSocket API lets your client send and receive native OpenAI realtime JSON events through Puter. Puter authenticates the user and charges their account for usage.

**Beta:** This API is incomplete. Its methods, options, events, and behavior may change abruptly, including breaking changes without notice.

For optional text, microphone, playback, and interruption helpers, use [`puter.ai.convo()`](/AI/convo/).

## Connection and authentication

Connect to this URL on the Puter API host:

```text
wss://api.puter.com/puterai/openai/v1/realtime?model=gpt-realtime-2.1-mini
```

Self-hosted clients use their deployment's API host. The `model` query parameter defaults to `gpt-realtime-2.1-mini`. The model is fixed for the connection. A session update that changes it is rejected. It also accepts `gpt-realtime-2.1`, `gpt-realtime-2`, `gpt-realtime-1.5`, `gpt-realtime`, and `gpt-realtime-mini`.

Authenticate with a Puter session, app, or full-access API token. Puter supplies the provider credential. Server clients pass this header:

```text
Authorization: Bearer <PUTER_TOKEN>
```

Browser WebSocket clients pass `realtime` and `openai-insecure-api-key.<PUTER_TOKEN>` as subprotocols. The server echoes only `realtime`. The endpoint also accepts an `auth_token` query parameter. Prefer the authorization header where supported because URLs and subprotocols can appear in logs. Authentication takes precedence in this order, header, subprotocol, then query parameter.

The socket can open before authentication and provider setup finish. Listen for errors and closure immediately. Wait for `session.created`, send your session settings, then wait for `session.updated` before submitting a turn.

## Text example

Install the `ws` package and set `PUTER_TOKEN` to your Puter token. Run this example as a Node.js ES module:

```js
import WebSocket from 'ws';

const socket = new WebSocket(
    'wss://api.puter.com/puterai/openai/v1/realtime?model=gpt-realtime-2.1-mini',
    { headers: { Authorization: `Bearer ${process.env.PUTER_TOKEN}` } },
);
const send = (event) => socket.send(JSON.stringify(event));

socket.on('message', (data) => {
    const event = JSON.parse(data.toString());

    if (event.type === 'session.created') {
        send({
            type: 'session.update',
            session: {
                type: 'realtime',
                output_modalities: ['text'],
                instructions: 'Keep replies short.',
            },
        });
    }
    if (event.type === 'session.updated') {
        send({
            type: 'conversation.item.create',
            item: {
                type: 'message',
                role: 'user',
                content: [{ type: 'input_text', text: 'Hello!' }],
            },
        });
        send({ type: 'response.create' });
    }
    if (event.type === 'response.output_text.delta')
        process.stdout.write(event.delta);
    if (event.type === 'error')
        console.error(event.error);
    if (event.type === 'response.done')
        socket.close();
});
socket.on('error', console.error);
socket.on('close', (code, reason) => console.log(code, reason.toString()));
```

## Events, audio, and interruption

Each message contains one JSON object with a nonempty string `type` of at most 128 characters. Binary messages are rejected. Native events retain their provider fields. The endpoint doesn't deliver `rate_limits.updated`, which describes Puter's provider account rather than yours, and it removes provider organization IDs from error messages. The endpoint exposes the WebSocket event protocol. Your client manages capture, playback, acknowledgments, and timeouts.

PCM16 audio configured at 24 kHz mono is sent as base64 chunks in `input_audio_buffer.append` events. Output arrives in `response.output_audio.delta` events. With manual turn detection, commit buffered input with `input_audio_buffer.commit`, then request a reply with `response.create`.

To interrupt, stop local playback immediately and send `response.cancel` with the active `response_id`. If some generated audio was not played, send `conversation.item.truncate` with its `item_id`, `content_index`, and `audio_end_ms` set to the amount actually played. Wait for `response.done` and any requested `conversation.item.truncated` acknowledgment before submitting a replacement turn.

Connection loss ends the session. Reconnecting creates a new conversation. Tool execution and automatic reconnection belong to your client.

## Errors, billing, and limits

API errors arrive as `{ "type": "error", "error": { "code": "...", "message": "..." } }`. Handle socket errors and close frames too. Authentication failures use `invalid_api_key`. Other relay codes include `model_not_found`, `insufficient_funds`, `subscription_required`, `rate_limit_exceeded`, `invalid_event`, `connection_timeout`, `provider_unavailable`, `upstream_error`, and `server_restarting`.

Policy failures generally close with 1008, oversized client messages with 1009, upstream or setup failures with 1011, and server restarts with 1012. Authentication and model failures can arrive after the WebSocket handshake succeeds.

The endpoint requires a paid Puter plan. Usage is charged after completed responses and input transcriptions. While a response generates, part of your balance is held for it, so a session opens only if your balance covers one response. Each account can open 20 sessions at once by default. Each JSON message you send is limited to 64 KiB, including reassembled fragments. Messages from the provider can be up to 4 MiB. Stream audio in small chunks. All message rates, queue caps, timeouts, and other bounds are published in [rate limits and quotas](/rate-limits-and-quotas/).
