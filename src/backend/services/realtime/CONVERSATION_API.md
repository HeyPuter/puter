# `puter.ai.conversation()`: API shape proposal

Starting point for turning the realtime relay into a high-level API that works the same across OpenAI Realtime, Gemini Live and xAI Grok Voice. This is a proposal, not a decision. Provider facts were checked against their docs on 2026-10-25; items marked *(verify)* weren't.

## Target shape

Simple by default, as easy to start as `puter.ai.chat()`:

```js
const convo = puter.ai.conversation(); // default model, voice in/out
convo.on('transcript', (t) => console.log(t.role, t.text));
await convo.start(); // asks for the mic, plays replies, handles barge-in
// ...
await convo.stop();
```

With options:

```js
const convo = puter.ai.conversation({
    model: 'gemini-…-native-audio', // provider picked from the model, like chat()
    instructions: 'You are a booking assistant.',
    voice: 'alloy',              // provider-specific id, passed through
    modalities: ['audio'],       // or ['text']
    tools: [{
        type: 'function',
        function: { name: 'getWeather', description: '…', parameters: { /* JSON schema */ } },
        run: async ({ city }) => fetchWeather(city), // optional; SDK sends the result back
    }],
    providerOptions: { /* merged into session.update / Gemini setup as-is */ },
});

await convo.start({
    input: myMediaStream,   // default: getUserMedia() in browsers; false = text only
    output: myAudioElement, // default: built-in player; false = emit 'audio' events only
    resume: savedHandle,    // continue an earlier conversation where the provider supports it
});

convo.say('Actually, make it Tuesday.'); // text turn
convo.interrupt();                        // cancel the current reply, flush playback
convo.mute(true);
convo.update({ instructions: '…' });      // mid-session config change
```

Escape hatches, so nobody is boxed in:

```js
convo.provider;           // 'openai' | 'gemini' | 'xai'
convo.on('raw', (frame) => …); // every provider-native server event
convo.raw.send(event);    // provider-native client event, unchanged
```

`start()` without a browser (Node, workers): `input` takes an async iterable of PCM chunks, `output: false` is implied, and audio arrives as `'audio'` events.

### Normalized events

Keep the set small. Anything not here is still available on `'raw'`.

| Event | Payload |
| --- | --- |
| `ready` | `{ provider, model }` |
| `speech.start` / `speech.stop` | user started/stopped talking (server VAD) |
| `transcript` | `{ role: 'user' \| 'assistant', text, final }` |
| `text` | `{ delta }` for text output |
| `audio` | `{ pcm: Int16Array, sampleRate }` (only when the SDK isn't playing it) |
| `tool.call` | `{ name, args, id }`; skipped if the tool has `run` |
| `interrupted` | reply was cut off by barge-in or `interrupt()` |
| `turn.done` | `{ usage: { costMicroCents } }` |
| `reconnecting` / `reconnected` | transparent reconnects (Gemini resets, drains) |
| `error` | `{ code, message }`; same codes as today (`insufficient_funds`, …) |
| `close` | `{ code, reason }` |

## Providers side by side

| | OpenAI Realtime | Gemini Live | xAI Grok Voice |
| --- | --- | --- | --- |
| Endpoint | `wss://api.openai.com/v1/realtime?model=` | `wss://generativelanguage.googleapis.com/ws/…BidiGenerateContent` | `wss://api.x.ai/v1/realtime?model=` |
| Other transports | WebRTC, SIP | none | SIP (WebRTC only via your own server) |
| Wire protocol | OpenAI Realtime events | Own protocol: `setup`, `realtimeInput`, `clientContent`, `toolResponse` / `serverContent`, `toolCall`, `goAway`, `sessionResumptionUpdate` | OpenAI Realtime-compatible (`session.update`, `response.create`, `response.function_call_arguments.done`, `function_call_output`) with its own fields |
| Config | `session.update`, any time | `setup` must be the first frame (model, tools, instructions); limited changes after | `session.update`, any time |
| Audio in / out | PCM16 24 kHz, G.711 | PCM16 16 kHz in, 24 kHz out | PCM16 8–48 kHz, Opus, G.711; optional raw binary frames instead of base64 |
| Session limits | 60 min | Connection ~10 min; session 15 min audio-only, 2 min with video, unlimited with context compression | not documented *(verify)* |
| Resume | none | `sessionResumption` handle, valid 2 h after disconnect | `?conversation_id=` with `resumption.enabled`, history kept 30 min idle |
| Tools | function, MCP, hosted | function, Google Search, code execution | function, `web_search`, `x_search`, `file_search`, MCP |
| Billing unit | tokens per modality, in `response.done` | tokens per modality, in `usageMetadata` *(verify exact shape)* | $0.08/min + text input |
| Browser tokens | client secrets (+ sideband attach, see below) | ephemeral tokens, can lock model/config | `client_secrets`, expiry only, no config lock |

xAI is close enough to OpenAI that Filip's passthrough relay mostly works for it already: different upstream URL and key, a different metering function. Gemini needs a real adapter.

## User pays: what it rules in and out

1. **Usage has to pass through us.** Handing out provider ephemeral tokens for direct browser → provider sessions means we can't see usage, so it's out for Gemini and xAI. The relay stays the default for every provider.
2. **OpenAI is the one exception worth considering later.** Browser on WebRTC with a client secret we mint, plus a server sideband (`/v1/live/sessions/{id}/attach`) that receives events and final session usage. Lower latency and no audio through our nodes. Risk: a dropped sideband is an unmetered session, so it needs a hold and a cap. Phase 2 at best.
3. **Charge as it goes, with a hold.** Today a response is billed at `response.done` and a session can go negative by one response. That's tolerable per token; for xAI's per-minute billing an idle open socket costs money, so the relay needs to meter wall-clock minutes and enforce an idle timeout. A small credit hold at `start()` that's topped up per turn covers both.
4. **Hosted tools cost extra upstream** (web search, `x_search`, MCP calls made by the provider). Block them until they're metered; function tools are free to us since they run in the user's client.
5. **Out of credit mid-call** should surface the same upgrade prompt other AI calls use, then `error` + `close`. The conversation object can offer `resume` after top-up where the provider supports it.

## Where the normalization lives

Recommendation: **relay stays provider-native, normalization lives in the SDK.**

- The relay has to parse provider frames for billing anyway, but only a few message types. Translating every audio frame (Gemini sends base64 PCM in JSON) costs CPU on the busiest path, and the relay's capacity numbers in `README.md` are already dominated by audio bytes.
- Raw access stays honest: `'raw'` is exactly what the provider sent, and third-party clients (OpenAI SDK, websocat) keep working against the relay.
- Each SDK adapter is roughly: `openSocket(opts)`, `configure(opts)` → first frames, `toEvents(frame)` → normalized events, `say/interrupt/sendToolResult` → provider frames, `inputRate/outputRate`.

Backend side, the relay becomes one service with a provider table:

```ts
interface RealtimeProvider {
    upstreamUrl(model: string): string;
    authHeaders(): Record<string, string>;
    // Gemini: model and tools come from the client's first `setup` frame, so validate there
    validateFirstFrame?(frame: Buffer): { model: string } | { error: string };
    meter(frame: Buffer, state: SessionState): UsageRow[]; // tokens or minutes
    reconnect?(state: SessionState): string; // Gemini: dial again with the resumption handle
}
```

Gemini's ~10 min connection reset is the main thing the SDK hides: on `goAway`, reconnect with the latest `sessionResumptionUpdate.newHandle`, emit `reconnecting`/`reconnected`, keep the mic running and buffer meanwhile. Doing it relay-side (keep the client socket, re-dial upstream) is also possible and saves a client round trip, but means the relay holds resumption state. Pick one.

## Audio defaults in the SDK

- Mic: `getUserMedia` → AudioWorklet → resample to the provider's input rate (24 kHz OpenAI/xAI, 16 kHz Gemini) → PCM16.
- Playback: queue PCM at the output rate; on `speech.start` or `interrupted`, flush the queue and tell the provider how much was played (OpenAI `conversation.item.truncate`) so its transcript matches what the user heard.
- Echo cancellation from `getUserMedia` constraints; no custom DSP.
- xAI's binary audio transport cuts the base64 overhead; use it once the relay forwards binary frames for xAI.

## Doesn't map cleanly

- **Voices** differ per provider; `voice` is a pass-through string. A voice list per model could come later.
- **Video / images** (Gemini video input, OpenAI image input): `convo.raw.send()` for now. Gemini video sessions are 2 min without compression.
- **Provider extras** (Gemini affective/proactive audio, OpenAI MCP/SIP, xAI custom voices, `x_search`): `providerOptions` + `raw`.
- **Usage** is tokens for two providers and minutes for one, so `turn.done.usage` reports cost, not tokens.
- **Config after start**: Gemini can't change model or tools mid-session; `update()` rejects those for Gemini.

## Suggested order

1. `conversation()` + `start()` on top of the existing OpenAI relay (`assistant.connect()` becomes the transport underneath, or stays as the raw API).
2. xAI: second upstream in the relay, per-minute metering, idle timeout.
3. Gemini: relay adapter (first-frame validation, `usageMetadata` metering) and SDK adapter with transparent reconnect.
4. Credit hold + upgrade prompt.
5. Maybe: OpenAI WebRTC + sideband.

## Open questions

- SDK-side vs relay-side Gemini reconnect.
- Paid-only or not. Other `/puterai/openai/v1/*` routes are; the relay isn't.
- Hold size and idle timeout values.
- Does the `'raw'` passthrough stay stable API, or is it documented as provider-dependent?
- Does `puter.ai.assistant.connect()` ship publicly, or stay internal once `conversation()` exists?

## Links

- OpenAI: [Realtime](https://developers.openai.com/api/docs/guides/realtime), [server-side controls / sideband](https://developers.openai.com/api/docs/guides/realtime-server-controls)
- Gemini: [Live API](https://ai.google.dev/gemini-api/docs/live), [session management](https://ai.google.dev/gemini-api/docs/live-session), [ephemeral tokens](https://ai.google.dev/gemini-api/docs/ephemeral-tokens)
- xAI: [Speech to Speech](https://docs.x.ai/developers/model-capabilities/audio/speech-to-speech), [ephemeral tokens](https://docs.x.ai/developers/model-capabilities/audio/ephemeral-tokens), [pricing](https://docs.x.ai/developers/pricing)
