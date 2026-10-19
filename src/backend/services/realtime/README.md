# OpenAI Realtime relay

`OpenAIRealtimeRelayService` relays OpenAI's [Realtime API](https://developers.openai.com/api/docs/guides/realtime) over WebSocket. puter.js exposes it as `puter.ai.assistant.connect()` (`src/puter-js/src/modules/ai/assistant.js`).

It is a deliberately rough, 1:1 relay built to measure how long-lived realtime sessions behave on our nodes. The question it answers: do they need a dedicated worker, or can they be load-balanced onto another location? Treat everything below as the current state, not a settled design.

## Examples

Every example speaks plain [OpenAI Realtime events](https://developers.openai.com/api/docs/guides/realtime); only the URL and the credential differ from OpenAI's. On a test deployment, replace `api.puter.com` with `api.<test-domain>`.

| Example                          | Checked how                                                |
| -------------------------------- | ---------------------------------------------------------- |
| puter.js, text                   | Live against OpenAI, Node.js                               |
| puter.js, spoken reply           | Live against OpenAI, Node.js (audio deltas and transcript) |
| puter.js, microphone in browser  | **Not run** — browser audio plumbing, written to OpenAI's PCM16 format |
| puter.js in Node.js              | Live against OpenAI                                        |
| Raw WebSocket                    | Live (this is what `tools/realtime-stress/loadtest.mjs` does); the websocat event was checked against OpenAI directly |
| OpenAI SDK `OpenAIRealtimeWS`    | URL and `Authorization` header verified; end to end needs an `https` host (the SDK always dials `wss://`) |

### puter.js: text

```js
const session = await puter.ai.assistant.connect(); // gpt-realtime-2.1-mini

session.on('response.output_text.delta', (e) => puter.print(e.delta));
session.on('response.done', (e) => console.log('usage', e.response.usage));
session.on('error', (e) => console.error(e.error.code, e.error.message));
session.on('close', (e) => console.log('closed', e.code, e.reason));

session.send({
    type: 'session.update',
    session: { type: 'realtime', output_modalities: ['text'], instructions: 'Be brief.' },
});
session.send({
    type: 'conversation.item.create',
    item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Say hi in three words.' }] },
});
session.send({ type: 'response.create' });
```

### puter.js: spoken reply, played in the browser

Output audio is base64 PCM16, 24 kHz mono.

```js
const session = await puter.ai.assistant.connect({ model: 'gpt-realtime-2.1' });
const ctx = new AudioContext({ sampleRate: 24000 });
let playAt = ctx.currentTime;

session.on('response.output_audio.delta', ({ delta }) => {
    const bytes = Uint8Array.from(atob(delta), (c) => c.charCodeAt(0));
    const pcm = new Int16Array(bytes.buffer);
    const buf = ctx.createBuffer(1, pcm.length, 24000);
    buf.getChannelData(0).set(Float32Array.from(pcm, (v) => v / 32768));
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    playAt = Math.max(playAt, ctx.currentTime);
    src.start(playAt);
    playAt += buf.duration;
});
session.on('response.output_audio_transcript.done', (e) => puter.print(e.transcript));

session.send({
    type: 'conversation.item.create',
    item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Tell me a one-line joke.' }] },
});
session.send({ type: 'response.create' });
```

### puter.js: talk to it with the microphone (browser, not run)

Server VAD is on by default, so OpenAI detects the end of each utterance and answers on its own; you only stream audio in.

```js
const session = await puter.ai.assistant.connect();
const ctx = new AudioContext({ sampleRate: 24000 });
const mic = ctx.createMediaStreamSource(await navigator.mediaDevices.getUserMedia({ audio: true }));
// ScriptProcessor keeps the example short; use an AudioWorklet in real code.
const tap = ctx.createScriptProcessor(4096, 1, 1);
tap.onaudioprocess = ({ inputBuffer }) => {
    const f32 = inputBuffer.getChannelData(0);
    const i16 = Int16Array.from(f32, (v) => Math.max(-1, Math.min(1, v)) * 0x7fff);
    let bin = '';
    new Uint8Array(i16.buffer).forEach((b) => (bin += String.fromCharCode(b)));
    session.send({ type: 'input_audio_buffer.append', audio: btoa(bin) });
};
mic.connect(tap);
tap.connect(ctx.destination);

session.on('response.output_audio_transcript.done', (e) => console.log('assistant:', e.transcript));
// Play `response.output_audio.delta` as in the previous example.
```

### puter.js in Node.js (22+, for the global `WebSocket`)

```js
import { init } from '@heyputer/puter.js/src/init.cjs';

const puter = init(process.env.PUTER_TOKEN);
// puter.APIOrigin = 'https://api.<test-domain>'; // when targeting a test deployment

const session = await puter.ai.assistant.connect({ model: 'gpt-realtime-mini' });
session.on('response.output_text.delta', (e) => process.stdout.write(e.delta));
session.on('response.done', () => session.close());
session.send({ type: 'session.update', session: { type: 'realtime', output_modalities: ['text'] } });
session.send({
    type: 'conversation.item.create',
    item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Hi!' }] },
});
session.send({ type: 'response.create' });
```

### Raw WebSocket, no SDK

Any WebSocket client works. From a browser, pass the token as OpenAI's subprotocol; from a server, prefer the header (subprotocols and query strings end up in proxy logs).

```js
// Browser or Node 22+
const ws = new WebSocket('wss://api.puter.com/puterai/openai/v1/realtime?model=gpt-realtime-mini', [
    'realtime',
    `openai-insecure-api-key.${PUTER_TOKEN}`,
]);

// Node with the `ws` package
import WebSocket from 'ws';
const ws2 = new WebSocket('wss://api.puter.com/puterai/openai/v1/realtime?model=gpt-realtime-mini', {
    headers: { Authorization: `Bearer ${process.env.PUTER_TOKEN}` },
});
```

```sh
# Shell, with websocat
websocat -H "Authorization: Bearer $PUTER_TOKEN" \
  'wss://api.puter.com/puterai/openai/v1/realtime?model=gpt-realtime-mini'
{"type":"response.create","response":{"output_modalities":["text"],"instructions":"Say hi."}}
```

### OpenAI's own SDK

Point `baseURL` at Puter and use a Puter token as the API key. Needs an `https` deployment.

```js
import OpenAI from 'openai';
import { OpenAIRealtimeWS } from 'openai/realtime/ws';

const client = new OpenAI({ apiKey: process.env.PUTER_TOKEN, baseURL: 'https://api.puter.com/puterai/openai/v1' });
const rt = new OpenAIRealtimeWS({ model: 'gpt-realtime-mini' }, client);
rt.on('response.output_text.delta', (e) => process.stdout.write(e.delta));
rt.socket.on('open', () => {
    rt.send({ type: 'session.update', session: { type: 'realtime', output_modalities: ['text'] } });
    rt.send({ type: 'response.create' });
});
```

## How a session runs

```
client ──ws──▶ api.<domain>/puterai/openai/v1/realtime?model=…
                 │ 101 immediately, then: model check → auth → credit check → per-user slot
                 ▼
               wss://api.openai.com/v1/realtime?model=…   (one upstream socket per client socket)
```

1. The `upgrade` listener only handles `REALTIME_PATH`. Any other host than `api.<config.domain>` gets `404`, and so does every host when `domain` is unset.
2. The client socket is **accepted before authenticating** (see [Quirks](#quirks)).
3. The relay checks the model, then the credential, then that the account has at least 1 cent of usage left, then takes a per-user concurrency slot. Any failure sends an OpenAI-shaped `error` event and closes with `1008`.
4. It dials OpenAI with the server key. Client frames sent while that is in flight are buffered and replayed in order, keeping their text/binary type.
5. From then on frames pass through untouched in both directions. Only `response.done` is parsed, to meter its `usage`.
6. Either side closing tears down the other.

### Credentials

These are checked in order:

1. `Authorization: Bearer <token>`, for server SDKs.
2. The `openai-insecure-api-key.<token>` subprotocol, which is OpenAI's own browser convention and what puter.js sends. When the client offers `realtime`, the server echoes it back; it never echoes the key protocol.
3. The `?auth_token=<token>` query parameter.

The token is a Puter token, never an OpenAI key. Users, app-under-user actors and full-access API tokens are admitted; scoped access tokens, blocked apps, and suspended or unverified accounts are rejected (via `decideSocketAuth` with `allowAppActors: true`).

### Models and billing

| Model                          | Text in / cached / out | Audio in / cached / out | Image in / cached |
| ------------------------------ | ---------------------- | ----------------------- | ----------------- |
| `gpt-realtime-2.1` (and `-2`)  | $4 / $0.40 / $24       | $32 / $0.40 / $64       | $5 / $0.50        |
| `gpt-realtime-1.5`, `gpt-realtime` | $4 / $0.40 / $16   | $32 / $0.40 / $64       | $5 / $0.50        |
| `gpt-realtime-2.1-mini` (default), `gpt-realtime-mini` | $0.60 / $0.06 / $2.40 | $10 / $0.30 / $20 | $0.80 / $0.08 |

Prices are per 1M tokens, taken from OpenAI's pricing page on 2026-10-15. `REALTIME_MODELS` stores them in micro-cents per token (100 µ¢ = $1/M). `gpt-realtime-translate` and `gpt-realtime-whisper` are billed per minute and are not supported.

Each `response.done` records usage rows `openai:<model>:realtime:<kind>`, where `kind` is one of `text_input`, `text_cached`, `audio_input`, `audio_cached`, `image_input`, `image_cached`, `text_output` or `audio_output`. Each row carries a `costOverride`. Cached tokens are subtracted from their modality's input count, so nothing is billed twice.

## Configuration

```jsonc
{
    "providers": {
        // First key found wins: openai-realtime → openai-completion → openai.
        "openai-realtime": { "apiKey": "sk-…" },
    },
    "realtime": {
        "maxConnectionsPerUser": 20, // default 20, same on every plan
        "upstreamUrl": "ws://mock:9000", // default wss://api.openai.com/v1/realtime
    },
}
```

`upstreamUrl` exists so a load test can target a fake OpenAI and cost nothing. The relay appends `?model=<model>` to it.

## Limits

| Limit                                         | Value  | On breach                                   |
| --------------------------------------------- | ------ | ------------------------------------------- |
| Concurrent sessions per user (Redis, cluster-wide) | 20 | `rate_limit_exceeded` error event, `1008`   |
| Single client frame                           | 16 MiB | `ws` closes with `1009`                     |
| Client data buffered before upstream opens    | 1 MiB  | client reads pause until upstream opens     |
| Client → upstream rate                        | 1 MiB/s sustained, 16 MiB burst (`realtime.maxClientBytesPerSecond`) | client reads pause until the budget refills |
| Data queued toward either side                | 1 MiB  | the other side's reads pause until it drains |
| Upstream paused by a client not reading       | 30 s   | close `1008` "client too slow" (no event)   |
| Client missing a ping                         | 30–60 s | socket terminated, upstream closed         |
| Upstream handshake                            | 10 s   | close `1011`                                |
| Credit needed to open a session               | 1 ¢    | `insufficient_funds` error event, `1008`    |
| Session length                                | none here | OpenAI ends sessions at 60 min           |

The per-user cap is published in `src/docs/src/rate-limits-and-quotas.md`; keep the two in step.

## Quirks

**Auth failures arrive after the handshake.** socket.io's engine (`destroyUpgrade`) ends any HTTP upgrade that hasn't written a byte within 1 s. An auth lookup under load can miss that, so the relay answers `101` first and reports failures in-band. As a result:
- `connect()` in puter.js **resolves** for a bad token or model. The failure shows up as an `error` event followed by `close` with code `1008`.
- The relay never returns the HTTP `401`/`403` that OpenAI would.
- Every rejected attempt still costs a full WebSocket upgrade, and counts toward `opened`/`closed` as well as `rejected`.

**The model is checked before the credential.** An unauthenticated caller can learn which model names are valid. The keyless puter.js API test relies on this order (`ai.suite.ts`, "assistant.connect surfaces relay errors…").

**Metering depends on OpenAI's field order.** To avoid parsing every audio delta, the relay only parses frames whose first 64 bytes contain `"response.done"`. OpenAI currently serialises `type` first. If that changes, usage silently stops being recorded. Check for that before trusting billing numbers.

**Billing happens after the fact.** No credit is held while a response runs. A response is charged when it finishes, and only then does the relay check for a positive balance, closing the session (`insufficient_funds`) if there is none. An account can therefore go negative by one response's worth. Responses cancelled before `response.done`, and anything OpenAI bills outside `response.done` (for example input transcription), are not metered.

**It skips the shared AI gates.** Sessions don't count against `AI_RATE_LIMIT`/`AI_CONCURRENT` (`drivers/util/aiLimits.ts`), only against their own per-user cap. They also bypass the AI cost-factor hook (`withAiCostFactor`), so `ai.cost.factor.*` listeners don't apply.

**It isn't paid-only.** Every other `/puterai/openai/v1/*` route requires a subscription and a full-access token. This one accepts session and app tokens on any plan. The docs say so.

**The credential is never re-checked.** Unlike `SocketService`, there is no periodic re-auth sweep. A revoked session or newly suspended account keeps an open session until it ends (60 min at most, OpenAI's cap). A team's 2FA requirement is not enforced either (`teamRequires2fa` isn't passed).

**Tokens can end up in logs.** The subprotocol header and `?auth_token=` query both carry the Puter token. Proxies or access logs that record them will capture it, so prefer the `Authorization` header from servers.

**Nothing is rewritten.** Query parameters other than `model` and `auth_token` are dropped. Events are not validated, filtered or rewritten in either direction, so a client can send anything OpenAI accepts (tools, instructions, voice changes).

**Close codes aren't passed through.** If the client closes, the upstream is `terminate()`d, which drops it without a close frame. If the upstream closes with no code (`1005`/`1006`), the client gets `1011`; its reason is cut to 120 characters.

**Backpressure, not buffering.** The relay never queues more than about 1 MiB toward either side: when one side backs up, it stops reading the other, so the excess waits in TCP buffers and at the sender. A client that leaves OpenAI's side paused for 30 s is closed. Client uploads are also budgeted per session (1 MiB/s sustained), which keeps a few clients streaming 16 MiB frames from saturating the node's event loop; legitimate voice input is about 64 KB/s.

**It isn't in the catalog.** Realtime models are absent from `puter.ai.listModels()` and can't be reached through `/drivers/call`.

**It lives in the service layer.** Only services receive the raw `http.Server` (`attachHttpServer`), so this edge component, which applies auth gates, sits in `services/` instead of `controllers/`. Move it if the relay outlives the experiment.

**Shutdown closes sessions immediately.** `onServerPrepareShutdown` closes every session with `1001`. They are not drained, so a deploy drops live conversations.

## Observing it

Each node logs one line every 30 s once it has seen a session:

```
[realtime] active=… opened=… closed=… rejected=… upstreamFailed=… avgUpstreamConnectMs=… framesUp=… framesDown=… bytesUp=… bytesDown=… loopP50Ms=… loopP99Ms=… loopMaxMs=… elu=… rssMb=… heapMb=…
```

- The counters are per process and cumulative since boot (never reset). `stats()` returns the same numbers.
- `loopP50Ms`/`loopP99Ms`/`loopMaxMs` are event-loop delay over the last interval only (reset after each line). Sustained `loopP99Ms` above ~50 ms means the node is CPU-bound and every session on it (and every other request) is getting slower. The histogram's 10 ms resolution puts an idle node at about 11–13 ms.
- `elu` is event-loop utilization over the same interval (0–1). It rises linearly with relayed bytes long before delay moves, so it is the capacity signal; delay only tells you when you've run out.
- `rssMb`/`heapMb` are the whole process, not just the relay. Compare against the same numbers with zero sessions.
- `active` can briefly lag a close.
- `avgUpstreamConnectMs` covers the TLS and WebSocket handshake to OpenAI. It averaged about 800 ms from a dev machine, which dominates time-to-first-event.
- Upstream rejections log `[realtime] upstream rejected: HTTP <status>` and upstream socket errors log `[realtime] upstream error <message>`.

## Load-testing notes

- Every session holds **two** long-lived sockets on the node: client and upstream TLS. Watch file descriptors, memory per session, and event-loop lag alongside the counters above.
- Audio is the heavy path. A spoken reply streams base64 PCM (24 kHz, 16-bit mono, about 64 KB/s once base64-encoded) through the node, and microphone input streams the same way up.
- Sessions stick to the node that accepted them. Whatever sits in front must allow WebSocket upgrades on the api host, and idle and keep-alive timeouts of at least 60 min.
- Use `realtime.upstreamUrl` with a mock upstream to measure the relay alone. Use the real upstream (and money) to measure end-to-end latency.
- Raise `realtime.maxConnectionsPerUser` when driving many sessions from one account.
- The kit for this lives in [`tools/realtime-stress/`](../../../../tools/realtime-stress/README.md): a mock upstream, a load generator with a JSON report, and a runbook written for agents.

## Verification so far (2026-10-15)

- **Live against OpenAI with `gpt-realtime-mini`, through puter.js:**
  - text reply in about 1.2 s
  - audio reply, about 91 KB of PCM relayed, with transcript
  - 10 parallel sessions, 10/10 succeeded in about 1.6 s
  - usage rows matched the price table
- **Load, local laptop, mock upstream with 800 ms handshake and 3 s spoken replies** (load generator, server and mock on one machine, so read the numbers as a floor):
  - 300 sessions × 3 audio turns with 1 s of mic input each: 100% success, 182 MB relayed down; first delta p99 400 ms
  - 1000 sessions × 4 audio turns with 1 s of mic input each: 100% success, 4000/4000 turns; connect p99 1.9 s, first delta p99 1.2 s (latency starts to stretch here)
- **Load generator against real OpenAI:** 5 sessions × 2 text turns, 100% success; session setup p50 0.9 s, first delta p50 0.37 s.
- **Tests:**
  - `OpenAIRealtimeRelayService.test.ts`: helpers, plus the relay against a fake upstream that rejects binary frames the way OpenAI does
  - `assistant.test.js`: the puter.js session object
  - keyless API-suite test on Node, browser and workerd
