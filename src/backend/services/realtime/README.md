# OpenAI Realtime relay

The relay serves `/puterai/openai/v1/realtime` on the API host. The SDK exposes
it through [`puter.ai.convo()`](../../../docs/src/AI/convo.md).

**Beta:** This API is incomplete. Its methods, options, events, and behavior may change abruptly, including breaking changes without notice.

Direct clients are documented in the [Realtime WebSocket API reference](../../../docs/src/AI/realtime.md).

## Transport

The relay forwards native OpenAI JSON events unchanged after validating the
event envelope, except that `rate_limits.updated` (Puter's provider account) is
dropped and provider organization IDs are removed from diagnostic messages in
`error`, `response.done.status_details.error`, and
`conversation.item.input_audio_transcription.failed.error`, and from provider
close reasons. Conversation content is preserved. An event must be an object with a nonempty string `type` of at
most 128 characters. Binary messages and malformed envelopes close the session.
Usage fields consumed by metering are validated before use. Event field order
does not affect billing.

Clients authenticate with a Puter token through the Authorization header,
OpenAI's browser key subprotocol, or `auth_token`. Server clients should use the
header because URL and subprotocol logging can expose credentials.

The socket opens before authentication completes. Authentication and model
failures arrive as OpenAI-shaped error events followed by a close frame.

```js
const conversation = await puter.ai.convo({ output: ['text'] });
conversation.on('error', (event) => console.error(event));
conversation.on('text', ({ delta }) => console.log(delta));
conversation.on('turn.done', () => conversation.close());
await conversation.connect();
conversation.sendText('Hello!');
```

## Limits and lifecycle

All transport limits are published in
[rate-limits-and-quotas.md](../../../docs/src/rate-limits-and-quotas.md).
Message size includes reassembled fragments. Client messages are capped at
64 KiB; upstream messages at 4 MiB, since OpenAI events can carry whole items.
Read backpressure is supplemented by hard queue admission limits because a
paused socket can still deliver messages already in its receive buffer.

Each frame is parsed once and the original bytes are forwarded. Upstream
traffic is not rate limited: OpenAI sends audio faster than real time, and
backpressure bounds what a slow client can queue. Usage is priced as each event
arrives, before any forwarding decision, and recorded serially off the
forwarding path through the AI cost-factor hook. Pricing follows the model the
session reports. A missing model uses the last known model, while an explicitly
unpriced model closes the connection; a client `session.update`
that changes the model is refused. So are `conversation.item.retrieve` and MCP
tools in `session.update` or `response.create`, since a retrieved item or MCP
output can exceed the upstream message cap.

When a session closes with a response still generating, the relay cancels it
and keeps the upstream open for up to five seconds so the cancelled response
reports, and is billed for, what it generated. A response the client requested
that starts during that window is cancelled the same way. When the upstream
closes, for any reason, with a started response that hasn't reported usage,
that response is billed its full hold through the same metering path and a
warning alarm is raised. A response the client requested but that never
started isn't billed.

Each response holds a fixed amount of the account's budget
(`RESPONSE_HOLD_*_TOKENS` at the model's audio rates) from `response.created`
until its usage is recorded, so concurrent sessions can't overdraw it; a session
opens only if one hold fits. Input transcription is priced at the costlier of
the transcription models in force at commit and at completion. Session attempts
are limited per credential after signature verification. Local, bounded IP and
node admission limits protect signature verification and authentication lookups.
Upgrades use Express's configured proxy trust policy and the `ip.validate` gate.
Authentication uses `touch: false` on both initial connection and rechecks, so
opening or maintaining a realtime socket does not update session activity metadata.

Input transcription takes a reservation before its configuration or audio is
forwarded. One window covers 64 items at a conservative fixed budget per item.
The account must cover the entire window, including the largest supported AI
cost factor. Client reads pause when the window is consumed. Once its accepted
items have been recorded, its hold is released and another window can be reserved.
Each committed item retains its model until completion, failure, or bounded
settlement. Missing usage is billed the item's fixed budget. Overflow closes the
connection without evicting existing pending identities.

Text, transcripts and raw audio are forwarded without new content logging.
The relay does not invoke `ai.prompt.validate`. A realtime adapter needs the host
listeners' chat payload and denial contracts before that hook can safely apply
to instructions and conversation text. Raw audio and generated transcripts need
separate policy decisions.

Credential checks run in batches of at most 16 with no overlapping sweeps.
Session and access-token revocation events close affected sockets and invalidate
their auth cache entries. Subscription eligibility is checked independently of
authentication and after subscription invalidations. A sustained verification
outage gets a 60-second retry grace from the first failed lookup, then closes
with a retryable internal error. Periodic checks remain the missed-event fallback.
When the drain starts, open sessions get a `puter.reconnect` event and new
sessions receive `server_restarting` and close with 1012. Open sessions can
finish an in-flight response for up to five seconds at shutdown, then close
with 1012. A host extension can announce a restart early by emitting
`serverRestartAnnounced` (optionally with `closeInMs`); that only sends the
notice, so a false alarm leaves the server working normally. Each session gets
the notice at most once a minute.

## Configuration

The provider key resolves through `openai-realtime`, `openai-completion`, then
`openai`. The default upstream is OpenAI. A deployment may override
`realtime.upstreamUrl`; the tests point it at an in-process fake provider
(the SDK tests live in `src/puter-js/tests/api/realtime`). The per-user connection cap is configured with
`realtime.maxConnectionsPerUser` and defaults to 20.

Unit tests use a local WebSocket fixture. Optional live integration tests use
`PUTER_TEST_AI_OPENAI_API_KEY`.

## Remaining constraints

Responses and input transcriptions are billed after completion; holds bound
what is in flight. Sessions require a paid plan (`subscription.gate.realtime.openai`
can waive it) and accept session, app and full-access API tokens. Conversation
state lives upstream and is lost when a connection ends; the SDK reconnects
with the same settings and replays its recent items, with assistant replies cut
to what the user heard.
