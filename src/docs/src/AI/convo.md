---
title: puter.ai.convo()
description: Prepare an OpenAI realtime conversation with optional audio and text helpers.
platforms: [websites, apps, nodejs, workers]
---

The conversation API prepares a realtime session, verifies Puter sign-in, and lets you connect when your app is ready. Realtime conversations require a paid Puter plan; usage is billed to the signed-in user. Native OpenAI events and convenience methods use the same session. Microphone capture and speaker playback start when your app requests them.

In Node.js, the SDK requires a global `WebSocket`, available in Node.js 22 or later.

**Beta:** This API is incomplete. Its methods, options, events, and behavior may change abruptly, including breaking changes without notice.

To connect without puter.js, see the [Realtime WebSocket API](/AI/realtime/).

## Syntax

```js
const conversation = await puter.ai.convo(options = {});
await conversation.connect();
```

## Parameters

The options object accepts these fields.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `model` | String | `gpt-realtime-2.1-mini` | Also accepts `gpt-realtime-2.1`, `gpt-realtime-2`, `gpt-realtime-1.5`, `gpt-realtime`, and `gpt-realtime-mini`. |
| `instructions` | String | Provider default | Session instructions, up to 8192 characters. |
| `output` | Array of Strings | `['audio']` | Accepts `['text']`, `['audio']`, or both. Audio includes a transcript. Requesting both uses audio output and emits transcript deltas through the `text` event. |
| `voice` | String | Provider default | OpenAI voice identifier, up to 128 characters. |
| `turnDetection` | Boolean | `true` | Whether the provider detects the end of spoken turns automatically. Set to `false` for manual audio commits. |

## Return value

A Promise resolves to a prepared conversation after options and sign-in are checked. In a browser, preparation opens the Puter sign-in prompt if needed. Preparation opens no realtime connection and requests no microphone access.

The conversation exposes these properties and methods.

| Member | Behavior |
| --- | --- |
| `state` | `prepared`, `connecting`, `connected`, or `closed`. |
| `model` | Resolved model name. |
| `connect()` | Opens the connection and applies settings. Resolves after the provider acknowledges session configuration. Concurrent calls share one attempt. Calling it while connected opens no additional connection. During a reconnection, it resolves when the reconnection succeeds and rejects if the conversation closes instead. |
| `configure(options)` | Updates the given session settings and resolves after the provider acknowledges this update. Settings it isn't given, including ones set through native events, are left alone. Accepts the factory options except `model`. One update can be pending at a time. Provider rules apply to changes such as switching a voice after audio has been generated. |
| `sendText(text)` | Adds a user message and requests a response. Text must be nonempty and at most 8192 characters. |
| `appendAudio(pcm)` | Appends an `Int16Array` containing PCM16, 24 kHz mono audio. A chunk contains at most 12000 samples. |
| `commitAudio()` | Commits buffered audio and requests a response. Requires turn detection to be off, through `turnDetection: false` or a native session update. The provider requires at least 100 ms of buffered audio. |
| `interrupt(position?)` | Stops built-in playback immediately and waits for cancellation and playback-history synchronization. A reply requested but not yet started is cancelled as soon as it starts. Custom players provide `{ itemId, contentIndex, playedMs }`. An idle call resolves immediately. |
| `send(event)` | Sends a native OpenAI JSON event. |
| `on(type, handler)` | Registers a listener and returns an unsubscribe function. Use `'*'` to receive every native and convenience event. |
| `off(type, handler)` | Removes a listener. |
| `close()` | Closes the session, rejects pending operations, and releases SDK-owned capture and playback resources. Repeated calls have no additional effect. |

Attach listeners before connecting to receive initial session events. Closing during connection rejects the pending attempt.

If the connection drops because of network loss, a server restart or a provider error, the conversation reconnects on its own. While it reconnects, `state` is `connecting`, a `reconnecting` event fires, and pending operations reject with `connection_lost`. The new session gets every setting the provider acknowledged, from the factory options, `configure()` and native `session.update` events. Then `ready` fires again with `reconnected: true`. Listeners, the microphone and the speaker carry over. Microphone audio captured while reconnecting is dropped. The provider starts a fresh session, so earlier conversation items are not restored. After five failed attempts, or a refusal such as `insufficient_funds`, the conversation closes. A closed conversation cannot reconnect. To start another session, prepare a new one.

Native event definitions are listed in the [OpenAI realtime reference](https://developers.openai.com/api/reference/resources/realtime/server-events). Native events retain their provider fields. Sending native events preserves direct control of the session. Audio helpers expect the session to use PCM16 at 24 kHz.

## Convenience events

The conversation emits these events alongside native events.

| Event | Fields |
| --- | --- |
| `ready` | `model`, `provider`, and `reconnected: true` after a reconnection |
| `reconnecting` | `code`, `reason` of the dropped connection |
| `text` | `delta`, `responseId` |
| `transcript` | `role`, `text`, `final`. Assistant deltas use `final: false`. Completed assistant and user transcripts use `final: true`. User transcripts require transcription to be configured through native session settings. |
| `audio` | `pcm`, `sampleRate`, `responseId`, `itemId`, `contentIndex`. The PCM chunk is an `Int16Array`. |
| `interrupted` | `source` (`manual` or `speech`), `responseId` |
| `turn.done` | `responseId`, native provider `usage`, `status` |
| `close` | `code`, `reason` |

Each event includes its `type`. When the provider event leaves out an ID, `responseId` and `itemId` are empty strings and `contentIndex` is `0`. The `interrupted` event signals local interruption immediately. Its corresponding operation resolves after the provider acknowledges cancellation and any requested truncation. Late audio from a canceled response remains visible as native events and is excluded from convenience audio and built-in playback.

## Browser media

The optional microphone and speaker helpers require a browser with Web Audio support. Microphone capture also requires media permissions and a secure context. Start audio from a user action so the browser can allow playback.

| Member | Behavior |
| --- | --- |
| `microphone.start()` | Requests microphone access and streams PCM16, resampled to 24 kHz, in 20 ms chunks through an AudioWorklet. If the page or network falls behind, chunks are dropped rather than stopping capture. |
| `microphone.mute()` | Disables capture tracks and stops forwarding captured chunks. |
| `microphone.unmute()` | Enables capture tracks and forwarding. |
| `microphone.stop()` | Stops capture tracks and releases capture resources. A `start()` still waiting on the permission prompt rejects with `session_closed`. |
| `speaker.start({ bargeIn: true })` | Starts playback. Barge-in defaults to `true`. With barge-in enabled, provider speech-start events interrupt playback and synchronize played audio with conversation history. Starting the speaker requests no microphone access. |
| `speaker.stop()` | Clears playback and releases its audio context. |

Both start methods require a connected session. Capture and playback are independent, so custom audio input can use the built-in speaker, and built-in capture can use custom playback.

## Errors and limits

Failures use objects containing `code` and `message`. Preparation can reject with `invalid_argument`, `model_not_found`, `auth_required`, `auth_canceled`, or `auth_failed`. Connection can reject with `subscription_required` or `insufficient_funds`, which also show the Puter upgrade prompt. Connection and asynchronous operations can reject with provider errors, `session_closed`, `connection_lost`, `operation_timeout`, or `operation_in_progress`. Sending before readiness, or while reconnecting, throws `session_not_ready`.

Invalid input throws `invalid_argument`, `invalid_event`, or `input_too_large`. A full SDK send queue throws `queue_full`. Media helpers report `unsupported_environment`, `permission_denied`, `media_error`, `media_timeout`, or `queue_full`. Runtime media errors arrive through the `error` event. Provider errors also arrive as native `error` events with a nested `error` object.

Each native event is capped at 64 KiB. The SDK bounds JSON traversal, outgoing queues, acknowledgment waits, microphone work, and playback. All numeric limits are listed on [rate limits and quotas](/rate-limits-and-quotas/).

## Examples

A text conversation uses convenience methods for input and streamed output.

```js
const conversation = await puter.ai.convo({
    output: ['text'],
    instructions: 'Keep replies short.',
});

conversation.on('text', ({ delta }) => console.log(delta));
conversation.on('turn.done', () => conversation.close());
conversation.on('error', (event) => console.error(event));

await conversation.connect();
conversation.sendText('Say hello in three words.');
```

A voice conversation enables the microphone and speaker after connection.

```js
const conversation = await puter.ai.convo();
conversation.on('transcript', ({ role, text }) => console.log(role, text));
conversation.on('error', (event) => console.error(event));

await conversation.connect();
await conversation.speaker.start();
await conversation.microphone.start();

// To interrupt a response and submit a replacement text turn:
await conversation.interrupt();
conversation.sendText('Actually, make it Wednesday.');

// When the user ends the conversation:
conversation.close();
```
