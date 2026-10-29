# OpenAI Realtime relay

The relay serves `/puterai/openai/v1/realtime` on the API host. The SDK exposes
it through `puter.ai.convo()` and `puter.ai.assistant.connect()`. The composable conversation
API is specified in [CONVERSATION_API.md](CONVERSATION_API.md).

## Transport

The relay forwards native OpenAI JSON events unchanged after validating the
event envelope. An event must be an object with a nonempty string `type` of at
most 128 characters. Binary messages and malformed envelopes close the session.
Usage fields consumed by metering are validated before use. Event field order
does not affect billing.

Clients authenticate with a Puter token through the Authorization header,
OpenAI's browser key subprotocol, or `auth_token`. Server clients should use the
header because URL and subprotocol logging can expose credentials.

The socket opens before authentication completes. Authentication and model
failures arrive as OpenAI-shaped error events followed by a close frame.

```js
const session = await puter.ai.assistant.connect();
session.on('error', ({ error }) => console.error(error.code, error.message));
session.on('response.output_text.delta', ({ delta }) => console.log(delta));
session.send({
    type: 'session.update',
    session: { type: 'realtime', output_modalities: ['text'] },
});
session.send({
    type: 'conversation.item.create',
    item: {
        type: 'message', role: 'user',
        content: [{ type: 'input_text', text: 'Hello!' }],
    },
});
session.send({ type: 'response.create' });
```

## Limits and lifecycle

All transport limits are published in
[rate-limits-and-quotas.md](../../../docs/src/rate-limits-and-quotas.md).
Message size applies in both directions and includes reassembled fragments.
Read backpressure is supplemented by hard queue admission limits because a
paused socket can still deliver messages already in its receive buffer.

Each frame is parsed once and the original bytes are forwarded. Upstream
traffic is not rate limited: OpenAI sends audio faster than real time, and
backpressure bounds what a slow client can queue. Usage is priced as each event
arrives, before any forwarding decision, and recorded serially off the
forwarding path through the AI cost-factor hook. Pricing follows the model the
session reports, falling back to the connection's; a client `session.update`
that changes the model is refused.

When a session closes with a response still generating, the relay cancels it
and keeps the upstream open for up to five seconds so the cancelled response
reports, and is billed for, what it generated.

Credential checks run in batches of at most 16 with no overlapping sweeps.
During drain, new sessions receive `server_restarting` and close with 1012.
Open sessions can finish an in-flight response for up to five seconds at shutdown.

## Configuration

The provider key resolves through `openai-realtime`, `openai-completion`, then
`openai`. The default upstream is OpenAI. A deployment may override
`realtime.upstreamUrl`; the tests point it at an in-process fake provider
(the SDK tests live in `src/puter-js/tests/api/realtime`). The per-user connection cap is configured with
`realtime.maxConnectionsPerUser` and defaults to 20.

The relay does not run load generators, periodic process-memory sampling, or
per-frame statistics counters. Tests use a local WebSocket fixture, not provider
credentials.

## Remaining constraints

Responses and input transcriptions are billed after completion. There is no
credit hold. Sessions require a paid plan (`subscription.gate.realtime.openai`
can waive it) and accept session, app and full-access API tokens. Conversation
state lives upstream and is lost when a connection ends; the SDK reconnects
with the same settings but an empty conversation.
