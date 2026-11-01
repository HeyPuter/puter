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

To open a replacement while another connection remains healthy, set the optional `purpose=handover` query parameter. These attempts share a smaller per-credential budget, checked before the general connection-attempt budget. Initial connections and dropped-connection recovery use the URL without this parameter. The limits are listed in [rate limits and quotas](/rate-limits-and-quotas/).

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

The endpoint refuses `conversation.item.retrieve` events and MCP tools (`"type": "mcp"`) in `session.update` and `response.create` events. A refused event isn't sent to the provider. The session gets an `invalid_event` error and closes with 1008.

PCM16 audio configured at 24 kHz mono is sent as base64 chunks in `input_audio_buffer.append` events. Output arrives in `response.output_audio.delta` events. With manual turn detection, commit buffered input with `input_audio_buffer.commit`, then request a reply with `response.create`.

To interrupt, stop local playback immediately and send `response.cancel` with the active `response_id`. If some generated audio was not played, send `conversation.item.truncate` with its `item_id`, `content_index`, and `audio_end_ms` set to the amount actually played. Wait for `response.done` and any requested `conversation.item.truncated` acknowledgment before submitting a replacement turn.

Connection loss ends the session. Reconnecting creates a new conversation. Tool execution and automatic reconnection belong to your client.

## Server restarts

When Puter knows ahead of time that the server a session runs on will restart, it sends each open session this event, at most once a minute:

```json
{
    "type": "puter.reconnect",
    "event_id": "event_puter_1767225600000",
    "reason": "server_restarting",
    "close_in_ms": 90000
}
```

The `reason` field is `server_restarting`. The `close_in_ms` field, when present, is about how long until the server closes the session itself. The session keeps working until then. Open a new connection after a short, randomized delay, and once it gets `session.created` and your client is idle, with no response generating and no user turn in progress, move to it and close the old one. A connection that reaches a server that is also restarting gets a `server_restarting` error and closes with 1012. In that case keep the old session and try again after a short, randomized delay. If the server closes the old session first, the close code is 1012, and your client reconnects the same way. A restart can also drop the connection without any notice, so treat an unexpected close the same way.

A new connection starts an empty conversation. To keep context, add earlier items back with `conversation.item.create` before you request a response. Event types that start with `puter.` come from Puter, not the provider.

## Errors, billing, and limits

API errors arrive as `{ "type": "error", "error": { "code": "...", "message": "..." } }`. Handle socket errors and close frames too. Invalid, missing, or revoked credentials use `invalid_api_key`. If Puter can't check a credential or the account's plan, the error is `internal_error` and the session closes with 1011, so try again after a short, randomized delay. Other relay codes include `permission_denied`, `model_not_found`, `insufficient_funds`, `subscription_required`, `rate_limit_exceeded`, `invalid_event`, `connection_timeout`, `provider_unavailable`, `upstream_error`, and `server_restarting`.

Policy failures generally close with 1008, oversized client messages with 1009, upstream or setup failures with 1011, server restarts with 1012, and temporary server overload with 1013. Reconnect after 1011, 1012, or 1013. Authentication and model failures can arrive after the WebSocket handshake succeeds.

The endpoint requires a paid Puter plan. Usage is charged after completed responses and input transcriptions. While a response generates, part of your balance is held for it, so a session opens only if your balance covers one response. If the provider connection closes before a response reports its usage, the response is charged the full amount held for it. Each account can open 20 sessions at once by default. Each JSON message you send is limited to 64 KiB, including reassembled fragments. Messages from the provider can be up to 4 MiB. Stream audio in small chunks. All message rates, queue caps, timeouts, and other bounds are published in [rate limits and quotas](/rate-limits-and-quotas/).

Input transcription reserves a whole window before its configuration or audio is forwarded. The reservation remains held while that window has unused capacity or unsettled items. When the window is consumed, audio waits until its items settle and another reservation succeeds. Failed transcriptions and items without final usage are charged a conservative fixed amount. The reservation amounts, timeout and audio budget are listed in [rate limits and quotas](/rate-limits-and-quotas/).

Provider-reported realtime models must have a known price. A missing model uses the last known model. An explicitly unpriced model closes the connection with `upstream_error`.

After recording usage, the connection can continue while settled credit is positive, including a fractional balance. Each new billable operation still needs its full reservation after accounting for other outstanding holds.
