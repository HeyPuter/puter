# Alarms

`clients.alarm` is the one way code reports that something is wrong. It
de-dupes by alarm id, counts occurrences, and routes each alarm to alert
transports by **severity**.

```ts
this.clients.alarm.create(
    `metering_write_failed:${userUuid}`, // de-dupe key
    'Metering write failed', // what a human reads
    { userUuid, appId, error }, // context fields
    'info', // severity
);
```

## Severity is the routing decision

| Severity   | Meaning                                                | Goes to     |
| ---------- | ------------------------------------------------------ | ----------- |
| `critical` | An unhandled server error. Someone gets woken up.      | Pager       |
| `error`    | Same urgency as critical; prefer one of the other two. | Pager       |
| `warning`  | Worth a look today. Nobody is paged.                   | Pager (low) |
| `info`     | A record of something expected-but-notable.            | Chat        |

Each transport declares the severity window it accepts, so the value a call
site passes is what decides where the alarm lands. The two windows don't
overlap by default: anything that pages lives in the paging system, and chat
is the record of what didn't. The bar for `critical` is
deliberately high: an unhandled 5xx out of the HTTP error handler is the main
thing that still pages. Anything a human can look at tomorrow is `warning`,
and anything that's just worth recording is `info`.

Omitting the severity takes `pager.defaultSeverity` (itself `critical`), so
pass one explicitly unless you really mean "page someone".

### Choosing one

- Did the server fail to do its job in a way nobody expected? → `critical`
- Is a background job, rate, or dependency degraded? → `warning`
- Is this a user doing something notable (tripping an abuse heuristic,
  overspending)? → `info`
- Did one of *our own* limits reject a caller — a rate limit, a concurrency
  cap, a quota? → don't alarm at all. The limit doing its job is not an
  event; the 429 is the whole signal, and alarming on it only produces noise
  proportional to traffic. An *upstream provider* rate-limiting us is the
  opposite case and still alarms (`upstream_rate_limited`, `info`) — that one
  is not something we chose. The exception is a free model: nothing is billed,
  nothing is actionable, and the throttling is the price of the model, so the
  AI chat driver marks those `noAlarm` and only paid models still record.

`noAlarm` is the code-level mute: an `HttpError` carrying it skips the
terminal gate entirely, no matter its status or code. It is for failures the
call site *already knows* are expected and traffic-proportional — reach for it
there, not as a way to quiet an alarm you haven't diagnosed
(`severityOverrides` below is the knob for that).

An extension whose signals are all one tier can default its own local
`raiseAlarm` helper to that tier instead of repeating it at every call site —
see [extensions/cronMonitor](../../../extensions/cronMonitor/index.js).

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
Reach for it anywhere else only when the id is that specific — otherwise a
per-request alarm can flood the pager.

## Configuration

Everything lives under `pager` in config (see
[config.template.jsonc](../config.template.jsonc) for the annotated version).
Both transports are off unless enabled, so a self-hosted node just logs
alarms to the console.

```jsonc
"pager": {
    "defaultSeverity": "critical",
    "severityOverrides": { "cronMonitor:*": "info" },
    "pagerduty": { "enabled": true, "routingKey": "…", "minSeverity": "warning" },
    "slack": {
        "enabled": true,
        "webhookUrl": "…",
        "channel": "#alerts",
        "minSeverity": "info",
        "maxSeverity": "info",
        "repeatThrottleMs": 900000,
    },
}
```

Slack's `maxSeverity` defaults to `info` whenever PagerDuty is configured, and
to `critical` when it isn't — a node with only a webhook still sees
everything. Raise it to have chat mirror the paging tiers as well.

### Retiering without a deploy

`severityOverrides` is the escape hatch for an alarm that turns out to be
noisier or more serious than its call site assumed. Keys are alarm ids or a
prefix ending in `*`; the exact id beats a pattern, and the longest matching
prefix wins among patterns. Values are a severity, or `mute` to drop the
alarm before any transport sees it.

It is applied *after* the call site's severity and any known-error rule, so
config always has the last word.

### Repeat throttling

The chat transport won't repost the same alarm id within
`repeatThrottleMs` (default 15 minutes). The first occurrence always posts,
and the next one that gets through reports how many piled up in between —
so a hot loop reads as one message with a count, not a wall of them.
