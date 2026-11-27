# Alarms

`clients.alarm` is the one way code reports that something is wrong. It
de-dupes by alarm id, counts occurrences, and routes each alarm to alert
transports by **severity**, then to a chat channel by its **channel key**.

```ts
this.clients.alarm.create(
    `metering_write_failed:${userUuid}`, // de-dupe key
    'Metering write failed', // what a human reads
    { userUuid, appId, error }, // context fields
    'info', // severity
    { channel: 'billing' }, // who owns it
);
```

## Severity is the routing decision

| Severity   | Meaning                                                      | Goes to     |
| ---------- | ------------------------------------------------------------ | ----------- |
| `critical` | An unhandled server error. Someone gets woken up.            | Pager       |
| `error`    | Same urgency as critical; prefer one of the other two.       | Pager       |
| `warning`  | For on-call to work through today. Nobody is woken up.       | Pager (low) |
| `info`     | For the area that owns it, in that area's chat channel.      | Chat        |

Each transport declares the severity window it accepts, so the value a call
site passes is what decides where the alarm lands. The two windows don't
overlap by default: anything that pages lives in the paging system, and chat
is the record of what didn't. The bar for `critical` is deliberately high: an
unhandled 5xx out of the HTTP error handler is the main thing that still
pages. `warning` is on-call's low-urgency queue, mostly abuse signals (signup
farms, usage spikes) someone should look at today. Everything else that isn't
urgent is `info` with a channel key, so the people who own that area see it.

Omitting the severity takes `pager.defaultSeverity` (itself `critical`), so
pass one explicitly unless you really mean "page someone".

### Choosing one

- Did the server fail to do its job in a way nobody expected? → `critical`
- Is a user or the fleet doing something on-call should look at today
  (tripping a signup or usage abuse heuristic, spending far past its
  credits)? → `warning`
- Is a background job, dependency, or one area's pipeline degraded? → `info`,
  with that area's channel key
- Did one of *our own* limits reject a caller — a rate limit, a concurrency
  cap, a quota? → don't alarm at all. The limit doing its job is not an
  event; the 429 is the whole signal, and alarming on it only produces noise
  proportional to traffic. An *upstream provider* rate-limiting us is the
  opposite case and still alarms (`upstream_rate_limited`, `info` in
  `ai_providers`) — that one
  is not something we chose. The exception is a free model: nothing is billed,
  nothing is actionable, and the throttling is the price of the model, so the
  AI chat driver marks those `noAlarm` and only paid models still record.

`noAlarm` is the code-level mute: an `HttpError` carrying it skips the
terminal gate entirely, no matter its status or code. It is for failures the
call site *already knows* are expected and traffic-proportional — reach for it
there, not as a way to quiet an alarm you haven't diagnosed
(`severityOverrides` below is the knob for that).

An extension whose signals are all one tier and channel can fix both in its
own local alarm helper instead of repeating them at every call site.

A call can pass a plain-language `summary` in its options. Slack shows it instead
of the diagnostic field grid and stack trace, and keeps only the short reference
and region in the footer. The alarm record and other transports retain the
diagnostic fields and full alarm id.

The HTTP alarm gate supplies a compact summary for known AI provider credit,
rate-limit, authentication, timeout, and availability errors. It includes up to
three provider/model attempts and their upstream HTTP statuses. This changes
only the Slack display. Alarm severity, routing, repeat throttling, and which
failures raise an alarm follow the same rules above. Unexpected failures keep
their diagnostic fields and stack trace in Slack.

## Channel keys

`{ channel: '<key>' }` names the area that owns an alarm. Config maps each key
to a chat channel (`pager.slack.channels`); an alarm with no key, or a key the
map doesn't list, goes to the default channel (`pager.slack.channel`). A
thrown `HttpError` sets its key with `alarmChannel`. Keys only matter for what
reaches chat; the pager ignores them.

The keys in use:

| Key             | Area                                                       |
| --------------- | ---------------------------------------------------------- |
| `billing`       | Purchases, subscriptions, top-ups, metering correctness    |
| `ai_providers`  | Upstream AI provider failures: credits, auth, rate limits  |
| `content_abuse` | Hosted site and app abuse verdicts, and the scanner itself |
| `signup`        | The signup pipeline and the checks it depends on           |
| `email`         | Sending and mailbox infrastructure                         |
| `platform`      | Jobs, events, KV, and other shared backend machinery       |

Reuse one before adding a new key; a key nobody maps lands in the default
channel.

## One incident per occurrence, unless you say otherwise

Alarms always de-dupe *in process* — repeats of an id bump its occurrence
count rather than creating a second alarm. What that means for the pager is a
separate decision, and by default every occurrence opens its own PagerDuty
incident: two failed scans an hour apart are two things that happened, and
closing one shouldn't hide the other.

Pass `{ dedup: true }` as a fifth argument when repeats of the id really are
one recurring fault, and they collapse onto a single incident carrying the
occurrence count:

```ts
this.clients.alarm.create(alarmId, message, fields, 'critical', {
    dedup: true,
});
```

The HTTP error handler uses it: its id is route + error signature, so a hot
loop of the same crash is one incident with N occurrences instead of N pages.
Dedup and Slack's repeat throttle mean a responder sees only the latest
occurrence, so the handler attaches the `HttpError`'s `fields` to the alarm as
`details` — put what a responder needs (which upstreams failed, and how)
there. Everything in `fields` is also returned to the client in the response
body, so it has to be safe to show the caller.
Reach for it anywhere else only when the id is that specific — otherwise a
per-request alarm can flood the pager.

## Phone calls

Some alarms should phone someone, whatever their severity and wherever else
they go. `pager.calls.rules`
maps alarm ids, or prefixes ending in `*`, to a **call group**; the exact id
beats a pattern and the longest prefix wins. While an alarm in a group keeps
firing, it is recorded in the system KV store until it has been quiet for
`ttlMs` (default 30 minutes, minimum 5).

An external uptime monitor polls `GET /alarms/calls?group=<group>` on the
`api` subdomain, sending `pager.calls.secret` in `x-puter-internal-auth`. The
route answers 200 while nothing in the group is calling and 503 while
something is, or when it couldn't read the whole listing, so the monitor's own
escalation policy places the call; leave out `group` to watch every group.
The body is short plain text, one line per call, with a link to where the
alarm landed: the PagerDuty incident when `pagerduty.apiToken` is set, or the
chat message when Slack posts with a `botToken`. A call with no link shows the
alarm's short id.

A call resolves by going quiet, not by a clear: acknowledge it in the monitor,
and the route goes back to 200 once the alarm stops firing for `ttlMs`.

## Configuration

Everything lives under `pager` in config (see
[config.template.jsonc](../config.template.jsonc) for the annotated version).
Both transports are off unless enabled, so a self-hosted node just logs
alarms to the console.

```jsonc
"pager": {
    "defaultSeverity": "critical",
    "severityOverrides": { "cronMonitor:*": "info" },
    "pagerduty": {
        "enabled": true,
        "routingKey": "…",
        "apiToken": "…",
        "minSeverity": "warning",
    },
    "slack": {
        "enabled": true,
        "botToken": "xoxb-…",
        "channel": "#alerts",
        "channels": { "billing": "#alerts-billing", "ai_providers": "#alerts-ai" },
        "minSeverity": "info",
        "maxSeverity": "info",
        "repeatThrottleMs": 900000,
    },
    "calls": {
        "secret": "…",
        "rules": { "metering_usage_dropped:*": "billing" },
        "ttlMs": 1800000,
    },
}
```

Slack posts through the Web API when `botToken` is set (scope `chat:write`;
invite the bot to each channel, or add `chat:write.public`). `channel` is then
required. Channels can be names or IDs; IDs survive a rename. `username` needs
the `chat:write.customize` scope with a bot token, so leave it out otherwise.
With only a `webhookUrl`, every alarm lands in the webhook's own channel and
calls carry no chat link.

PagerDuty's `apiToken` is a REST API key; read-only is enough. It's only used
to find the incident an alarm that calls just opened.

Slack's `maxSeverity` defaults to `info` whenever PagerDuty is configured, and
to `critical` when it isn't — a node with only Slack still sees everything.
Raise it to have chat mirror the paging tiers as well.

### Retiering without a deploy

`severityOverrides` is the escape hatch for an alarm that turns out to be
noisier or more serious than its call site assumed. Keys are alarm ids or a
prefix ending in `*`; the exact id beats a pattern, and the longest matching
prefix wins among patterns. Values are a severity, or `mute` to drop the
alarm before any transport sees it.

It is applied *after* the call site's severity, so config always has the last
word.

### Repeat throttling

Two levels, and they stack.

The client itself backs off before a repeat is reported at all: every
occurrence is reported up to a small burst, then one per interval. A fault
recurring hundreds of times a second still counts every occurrence, but it
does not write a log line or build an alert payload for each one.

The count lasts only as long as the client remembers the alarm. One that
hasn't recurred for 24 hours is forgotten, and the client holds at most 1000
at once, dropping the least recently raised first. Either way the next
occurrence is a new alarm, with its count and burst starting over.

Below that, the chat transport won't repost the same alarm id within
`repeatThrottleMs` (default 15 minutes). The first occurrence always posts,
and the next one that gets through reports how many piled up in between —
so a hot loop reads as one message with a count, not a wall of them.

## AI model catalog monitoring

The `aiModelMonitor` extension registers a fleet job automatically at boot.
The scheduler checks for due work at startup and runs scans every 30 minutes
until shutdown. It uses the configured provider keys,
fetches complete upstream model lists, and records snapshots in the system KV
store. The first successful scan establishes a baseline. A different endpoint
or API key establishes a fresh baseline because account visibility can differ.

Each added or removed model raises an `info` alarm on `ai_providers`, which can
map to `#alerts-ai` through `pager.slack.channels`. Unchanged catalogs are quiet.
A failed, invalid, oversized, or incomplete listing raises a fetch-failure alarm
and retains the last successful snapshot. Snapshot read or write failures raise
a separate snapshot-failure alarm without emitting model changes. The monitor
saves the new snapshot before emitting change alerts, so a failed save can be
retried without replaying alerts. This isn't a durable alert queue. A process
that stops after saving and before emitting can miss those alerts.
Removing a provider's configuration
doesn't report all of its models as removed.

| Providers | Monitoring |
| --- | --- |
| OpenAI, Azure, Claude, Gemini, Groq, DeepSeek, Mistral, Moonshot, MiniMax, Z.ai, BytePlus, Hoonify, Meta, ElevenLabs, Replicate | Model-listing API, including configured OpenAI and Gemini media keys |
| Alibaba, Infron, Neuralwatt, Ollama, OpenRouter, Together, xAI, Cloudflare | Excluded because their upstream catalogs already refresh automatically |
| AWS Polly and Textract, Kling, Speechify | No supported model-listing endpoint in this monitor |
| Fake | Test provider with no upstream endpoint |

The monitor compares identifiers returned by each provider, across all model
modalities that endpoint exposes. It doesn't modify Puter's model catalogs.
The scheduler runs once across the fleet when a fleet scheduler is installed,
and once per region with the built-in scheduler. See the scheduler's deployment
configuration when running the monitor across regions.
