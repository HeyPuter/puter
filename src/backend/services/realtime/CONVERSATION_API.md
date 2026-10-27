# Conversation API contract

The SDK exposes the composable session through `puter.ai.convo()`. OpenAI is the
baseline provider. The lower-level `puter.ai.assistant.connect()` transport is
also supported.

## Preparation and connection

```js
const convo = await puter.ai.convo({
    model: 'gpt-realtime-2.1-mini',
    instructions: 'You are a booking assistant.',
    output: ['text', 'audio'],
    voice: 'alloy',
});

convo.on('response.output_text.delta', ({ delta }) => renderText(delta));
convo.on('error', handleError);
await convo.connect();
convo.sendText('Hello!');
```

The factory validates options, resolves the model, and authenticates the user.
It does not open a provider connection or request media permissions. Connection
rechecks authentication and credit, applies configuration, and resolves when
the provider acknowledges readiness. Attach listeners before connecting.

The lifecycle is `prepared → connecting → connected → closed`. Concurrent
`connect()` calls share the same attempt. Calling it when connected resolves
without opening another socket. After closing, create a new conversation.
Calling `close()` during connection rejects the connection attempt and releases
its resources. Sending before readiness rejects with `session_not_ready`.

## Optional abstractions on one session

Native OpenAI events are the foundation. Convenience methods use the same
connection and event stream. No provider adapter registry is needed.

```js
convo.send({ type: 'response.create' });
convo.on('response.done', handleResponse);
const unsubscribe = convo.on('*', inspectEvent);
unsubscribe();

await convo.configure({ instructions: 'Keep replies short.' });
convo.sendText('Book a table for Tuesday.');
convo.appendAudio(pcmChunk);
convo.commitAudio();
await convo.interrupt();
convo.close();
```

The public shapes are:

```ts
interface ConvoOptions {
    model?: string;
    instructions?: string;
    output?: ('text' | 'audio')[];
    voice?: string;
}
interface ConvoEvent {
    type: string;
    [field: string]: unknown; // Provider-owned event fields pass through.
}
interface PlaybackPosition {
    itemId: string;
    contentIndex: number;
    playedMs: number;
}
interface ConvoError {
    code: string;
    message: string;
}
```

Each helper has a specific effect:

- `configure(options)` changes session settings and resolves on acknowledgment.
- `sendText(text)` creates a user message and requests a reply.
- `appendAudio(pcm)` appends PCM16, 24 kHz mono input without ending a turn.
- `commitAudio()` commits input and requests a reply in manual turn mode.
  Automatic voice activity detection is the default.
- `interrupt(position?)` cancels the response active when called. Idle calls
  resolve immediately. Repeated calls for the same response share one promise.
- `send(event)` sends a native event. Native events remain observable even when
  helpers consume them.
- `close()` ends the connection and releases media resources owned by the SDK.

Normalized text, transcript, audio, and turn-completion events supplement native
events. Audio decoding runs only when playback or an audio listener is active.
The backend does not parse frames again or run media helpers.

## Optional browser media

```js
await convo.microphone.start();
await convo.speaker.start({ bargeIn: true });
convo.microphone.mute();
convo.microphone.unmute();
await convo.microphone.stop();
await convo.speaker.stop();
```

Microphone and speaker are independent. Starting either requires a connected
session. Only microphone start requests capture permission. Browser-only helpers
reject with `unsupported_environment` elsewhere. Raw events and audio input
remain available in Node and workers.

Capture uses an AudioWorklet with bounded chunks. Playback has a bounded queue.
No ScriptProcessor, growing transcript buffer, or retained audio history is
part of the SDK. Custom capture and playback can be mixed with built-in helpers.

## Asynchronous interruption

Explicit interruption and provider speech-start events enter the same operation.
The built-in speaker immediately clears playback, then cancellation and playback
history synchronization run asynchronously. The promise resolves after provider
acknowledgment. A disconnect rejects it with a stable connection error.

Interruption captures the response ID. Late deltas from that response remain
visible as native events but never enter built-in playback. Delayed cancellation
must not cancel a newer response. The speaker tracks item ID, content index,
and played milliseconds. Custom players supply that position explicitly.

The `interrupted` event carries `{ type: 'interrupted', source:
'speech' | 'manual', responseId }`. It signals local interruption immediately.
Await the operation before submitting a replacement text turn:

```js
await convo.interrupt();
convo.sendText('Actually, make it Wednesday.');
```

## Latency and bounded work

The relay passes original bytes through after a single bounded JSON parse.
Metering is serialized outside forwarding with bounded retained work. It never
buffers an entire conversation or transcodes audio. Media and convenience
helpers run in the client only when selected.

The implemented transport caps each message at 64 KiB in either direction,
including fragmented messages. Audio producers must stream chunks rather than
upload recordings. Client traffic has a 64 KiB burst and 128 KiB/s sustained
budget, plus 100 messages/s. Upstream traffic allows 200 messages/s and 256 KiB/s with a 256 KiB burst. Message
rates use token buckets with bursts equal to their one-second allowance.
Pending handshake input is bounded by both 32 messages and 64 KiB. Pending
metering is bounded by both 32 events and 256 KiB. Forwarding queues have a
128 KiB high-water mark and a 192 KiB hard admission cap in each direction.

The SDK must check text, PCM chunk, native event size, and outbound buffered
bytes before sending. Configuration and interruption acknowledgment waits need
timeouts and bounded pending operations. Closing rejects all pending operations
and clears timers and listeners. Automatic reconnect and tool execution are
outside this contract.

## SDK contract tests

Use typed fixtures matching the shapes above, with explicit malformed fixtures
for rejection tests. Exercise the built SDK against a test server as well as
unit tests. Cover authentication cancellation, option validation, readiness,
concurrent connection attempts, close during setup, native event preservation,
helper-to-event mappings, interruption races, media cleanup, queue overflow,
and operation timeouts. No production method should exist only for a test.

Cross-session tests must show that flooding one session does not prevent another
from making progress. Timing measurements are evidence for a specific run, not
a claim about fleet capacity. A deployment load test is required before raising
transport limits or enabling media helpers at scale.
