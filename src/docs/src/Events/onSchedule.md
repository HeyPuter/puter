---
title: puter.events.onSchedule()
description: Run your app's handler at an interval, on a cron expression in a time zone, or once at a set time, even while your app is closed.
platforms: [websites, apps, nodejs, workers]
---

<div class="info">The Events API is in beta. Event shapes, limits, and behavior may change between releases.</div>

Runs a handler your app published with [`puter.events.handlers.publish()`](/Events/handlers/) on a timer. A schedule can run at an interval, on a cron expression in a time zone, or once at a set time. It's stored on the user's account and runs in your app's [events worker](/Events/workers/), whether or not your app is open. It never runs in the client that created it.

To run a handler when the user's data changes instead, use [`puter.events.onPersistent()`](/Events/onPersistent/).

Only an app can create a schedule, meaning an app running on Puter or a website using Puter.js. The schedule belongs to the user the app runs for, and to that app. On a website with nobody signed in, it asks the user to sign in first, as other Puter.js calls do. An app running on Puter is always signed in.

## Syntax
```js
puter.events.onSchedule(options)
```

## Parameters

#### `options` (Object) (required)

Give exactly one of `every`, `cron` or `at`.

- `every` (Number | String): Run at this interval, in milliseconds or as a duration such as `'30m'`, `'6h'` or `'1d'`. The units are `s`, `m`, `h`, `d` and `w`. The interval must be a whole number of seconds, at least your plan's [minimum interval](#how-often-a-schedule-can-run), and at most 366 days.
- `cron` (String): Run on a [cron expression](#cron-expressions), such as `'0 9 * * 1-5'` for 09:00 on weekdays.
- `tz` (String): The IANA time zone the `cron` expression runs in, such as `'America/New_York'`. Defaults to `'UTC'`. Only allowed with `cron`. See [Time zones and daylight saving time](#time-zones-and-daylight-saving-time).
- `at` (Number | String | Date): Run once, at this [time](#times). It must be at least 1 second and at most 366 days ahead. A schedule with `at` takes no `startAt`, `expiresAt` or `maxRuns`.
- `startAt` (Number | String | Date): For `every`, the first run. Without it, the first run is one interval after this call. A `startAt` in the past sets where the intervals line up, and the first run is the next one after this call. For example, `every: '1d'` with `startAt: '2026-01-01'` runs at midnight UTC every day. For `cron`, the earliest time the schedule may run. At most 366 days ahead.
- `expiresAt` (Number | String | Date): The last time the schedule may run. A run due at exactly this time still runs.
- `maxRuns` (Number): How many runs the schedule makes before it ends, from 1 to 100,000. With `expiresAt` too, the one that comes first ends the schedule.
- `handlerName` (String) (required): The published handler each run calls.
- `handler` (Function | String | Object): The handler source you wrote this schedule against, as a function, a source string, or `{ file: '~/AppData/…/handler.js' }`. Only its **hash** is sent. The schedule is created only if it matches what's published under `handlerName`. It never runs in this client.
- `handlerHash` (String): The SHA-256 hex digest of the handler source, in place of `handler`.
- `context` (Object): Values the handler needs, passed to every run as a frozen `ctx`. **Up to 4 KB serialized.** It's read once, at this call, and can't be changed later. To change it, remove the schedule and create a new one.

### Times

The `at`, `startAt` and `expiresAt` options each take one of these:

- An ISO-8601 string with a zone, such as `'2026-11-01T18:30:00Z'` or `'2026-11-01T18:30+02:00'`. Seconds and up to 3 fraction digits are optional.
- A date alone, such as `'2026-11-01'`, which is read as midnight UTC.
- A `Date`.
- A whole number of milliseconds since the epoch.

Times are rounded up to the next whole second. A string with a time and no zone, such as `'2026-11-01T18:30'`, is refused with `events_schedule_invalid`, because it could be read in any zone.

These are **milliseconds**, unlike `expiresAt` on [`onPersistent()`](/Events/onPersistent/), which takes seconds. Every time a schedule reports, including `event.scheduledFor`, is in milliseconds too.

## Cron expressions

A `cron` expression has the 5 standard fields, separated by spaces:

| Field | Values |
| --- | --- |
| Minute | `0`-`59` |
| Hour | `0`-`23` |
| Day of the month | `1`-`31` |
| Month | `1`-`12`, or `JAN`-`DEC` |
| Day of the week | `0`-`7`, where `0` and `7` are Sunday, or `SUN`-`SAT` |

Each field takes a number, `*` for every value, a list such as `1,15`, a range such as `MON-FRI`, or a step such as `*/15` or `0-30/10`. Names can be in any case.

The expression can also be one of these nicknames:

| Nickname | Runs |
| --- | --- |
| `@yearly`, `@annually` | `0 0 1 1 *`, midnight on January 1 |
| `@monthly` | `0 0 1 * *`, midnight on the first of the month |
| `@weekly` | `0 0 * * 0`, midnight on Sunday |
| `@daily`, `@midnight` | `0 0 * * *`, every midnight |
| `@hourly` | `0 * * * *`, the start of every hour |

Some cron syntax isn't supported, and is refused with `events_schedule_invalid`:

- A seconds or year field, so 6 or 7 fields.
- `?`, `L`, `W` and `#`, and a day of the week starting with `+`.
- `@reboot`.
- An expression over 128 characters.

When neither the day of the month nor the day of the week is `*`, a day matches if **either** one matches, as in standard cron. So `0 9 13 * 5` runs at 09:00 on the 13th of each month and at 09:00 every Friday. A day that a month doesn't have is skipped, so `0 0 31 * *` runs only in months with 31 days.

The expression has to run within 366 days of the call. `0 0 31 2 *` never runs, and is refused with `events_schedule_never_fires`. So is `0 0 29 2 *` while the next February 29 is more than 366 days away.

### Time zones and daylight saving time

A `cron` expression runs in `tz`. For example, `0 9 * * 1-5` with `tz: 'America/New_York'` runs at 09:00 New York time all year, which is 13:00 UTC in the summer and 14:00 UTC in the winter.

The `tz` option takes an IANA name. A UTC offset such as `'+02:00'` is refused with `events_schedule_invalid`, since an offset has no daylight saving rules. The schedule reports the zone under its canonical name, so `'US/Eastern'` comes back as `'America/New_York'`.

When the clocks change:

- An expression with one minute and one hour, such as `30 2 * * *`, runs once that day. When its time is skipped because the clocks go forward, it runs at the first minute after the gap (03:00 in New York). When its time happens twice because the clocks go back, it runs once.
- An expression with a list, range, step or `*` in the hour field, such as `0,30 1 * * *` or `0 * * * *`, skips the runs that fall in the gap when the clocks go forward. When the clocks go back, it runs at each repeated time twice. Each of those runs has its own `scheduledFor` and `event.id`.

## How often a schedule can run

A schedule can't run more often than your plan's **minimum interval**, which is 1 minute on a paid plan and 15 minutes on a free one. For `every`, the interval is what's checked. For `cron`, it's the smallest gap between two runs, checked over the next 10,000 runs or 400 days, whichever ends first. For example, `0-4 9 * * *` runs at 09:00, 09:01, 09:02, 09:03 and 09:04 each day. Those runs are 1 minute apart, so a free plan can't use it. A schedule under the minimum is refused with `events_schedule_too_frequent`.

The plan also limits how many schedules the user can hold for your app and in total, and how many runs per hour all of them can add up to. Over those limits, the call fails with `events_schedule_limit` or `events_schedule_budget`. With `maxRuns` on a `cron` schedule, the last run has to fall inside those same 10,000 runs or 400 days, or the call fails with `events_schedule_invalid`. See [Rate Limits and Quotas](/rate-limits-and-quotas/#schedules) for the numbers.

## When a schedule runs

Each run is due at a time, its **slot**, which the handler gets as `event.scheduledFor`. A run usually starts within 60 seconds of its slot.

So that schedules due at the same moment don't all start at once, Puter starts each schedule's runs a fixed delay after their slots. The delay comes from the schedule's id, and is a whole number of seconds up to 30 seconds or a tenth of the schedule's smallest gap, whichever is smaller. For an `at` schedule it's up to 10 seconds. So a schedule that runs every minute has a delay of at most 5 seconds.

A run can start later than 60 seconds after its slot when it's being retried, when your app's schedules for this user go over 200 runs a minute, while your events worker is being deployed, or while the user's account is suspended. The handler can compare `event.firedAt` with `event.scheduledFor` to see how late a run is.

Puter starts one attempt at a time for each schedule, and the next slot waits until the current run finishes or is given up. A handler that's still running when its 30 seconds are up can overlap its own retry, which has the same `event.id`.

When a schedule falls behind, for example while a run was being retried, it doesn't make up every slot it missed. It runs the latest slot that's due, once, and `event.missed` counts the slots it skipped. A schedule that resumes after a suspension waits for its next slot, and that run's `missed` counts the slots it skipped while it was suspended.

## Delivery guarantees

Runs are **at-least-once**. A retry, or a handler that outlives its timeout, can run one slot twice. Every attempt at one slot has the same `event.id`, `<scheduleId>:<scheduledFor>`, so record it once the work is done and skip IDs you've already handled:

```js
await puter.events.handlers.publish('sendDigest', async ({ event, ctx, user }) => {
    const doneKey = `digest:${event.id}`;
    if (await user.kv.get(doneKey)) return;

    await fetch(ctx.webhookUrl, { method: 'POST', body: `Digest for ${event.scheduledFor}` });

    await user.kv.set(doneKey, true, Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60);
}, { appUid });
```

## The event

The handler is called with `event`, `ctx`, `user` and `fetch`, the same bindings a [persistent subscription's](/Events/onPersistent/#where-the-handler-runs) handler gets in the events worker. The `ctx` binding is the frozen `context`. There's no `ack`.

A run's `event` carries:

| Field | Type | Description |
| --- | --- | --- |
| `subject` | String | `schedule:<scheduleId>`. |
| `op` | String | Always `'tick'`. |
| `id` | String | `<scheduleId>:<scheduledFor>`. The same on every attempt at one run, so use it to skip work you've already done. |
| `scheduleId` | String | The schedule this run belongs to. |
| `scheduledFor` | Number | The slot this run is for, in milliseconds since the epoch. |
| `firedAt` | Number | When this attempt was sent to the handler, in milliseconds since the epoch. |
| `missed` | Number | Slots skipped since the last run, for example while the schedule was suspended. Only this run happens for them. |
| `missedCapped` | Boolean | Present, and `true`, when `missed` stopped counting at 1,000. |
| `attempt` | Number | Attempts at this run, this one included. `1` on the first try. |

The `user` binding is valid for 15 minutes, so use it only during the run. Writes made through `user` count toward the same [handler chain](/Events/onPersistent/#handlers-that-trigger-handlers) limit as a subscription's, starting from the depth of the call that created the schedule.

## What happens when a handler fails

| The handler | Result |
| --- | --- |
| Resolves | Done. The schedule moves on to its next slot. |
| Throws | The run is dropped and the schedule moves on to its next slot. It counts as a failure. |
| Throws a temporary error: a network error, a timeout, a rate limit (`429`), a `5xx`, or any error with `retry: true` | Retried after 2 seconds, then 4, 8 and so on, up to 5 minutes apart, with the same `event.id`. It counts as a failure. |
| Runs past 30 seconds | Retried on the same schedule. It counts as a failure. |

A run that fails because of Puter doesn't count as a failure. It's retried on the same schedule, and waits longer if Puter's answer asked for a longer wait, up to 5 minutes. To drop the run in that case anyway, throw an error with `terminal: true`. The rules are the same as for a [`queue` subscription](/Events/onPersistent/#what-happens-when-a-handler-fails).

**Five failures in a row suspend the schedule** with `failures`. The developer is notified, and publishing the handler again resumes it.

## Background runs need consent

A schedule runs your handler while the user isn't there, so it needs the per-app permission **`events:background`**, as [`onPersistent()`](/Events/onPersistent/#background-delivery-needs-consent) does. Without it, the call fails with `events_background_consent_required`. To ask for it, call [`puter.perms.request()`](/Perms/request/) with the `'backgroundEvents'` resource:

```js
await puter.perms.request('backgroundEvents');
```

When the user revokes it, every schedule your app holds for them ends with `permission_revoked`. Granting it again doesn't bring them back, so create them again.

## Suspended and ended schedules

A schedule can stop running without being removed. It's then *suspended*, and [`listSchedules()`](/Events/listSchedules/) shows `state: 'suspended'` and a `suspendedReason`:

| `suspendedReason` | Cause | Resumes when |
| --- | --- | --- |
| `handler_not_found` | Its handler was removed, or the app's [events worker](/Events/workers/) was destroyed. | A handler is published under that name again. |
| `failures` | Its handler failed 5 times in a row. | The handler is published again. |
| `no_credit` | The user ran out of credit. | The balance is topped up (checked every few minutes). |

A suspended schedule isn't billed. One that stays suspended for 30 days ends.

An ended schedule never runs again. It has `state: 'ended'` and an `endReason`, and stays in [`listSchedules()`](/Events/listSchedules/) for 7 days:

| `endReason` | Cause |
| --- | --- |
| `removed` | It was removed with [`removeSchedule()`](/Events/removeSchedule/) or `off()`. |
| `ended` | Its last run is done (an `at` schedule, `expiresAt` or `maxRuns`), or it stayed suspended for 30 days. |
| `permission_revoked` | The user revoked `events:background` for your app. |
| `uninstalled` | The user uninstalled your app. |
| `app_deleted` | The app was deleted. |
| `holder_gone`, `app_gone` | The user's account or the app no longer exists. |
| `orphaned` | A create or remove that failed partway left it incomplete, and Puter cleaned it up. |
| `delivered`, `dropped` | A notification sent later with [`notify()`](/Notifications/notify/#send-it-later) was sent, or couldn't be. |

When schedules end with `permission_revoked`, the user's app gets an `app.events.ended` notification about them, which you can read with [`puter.events.fetch()`](/Events/fetch/).

## Return value

A `Promise` that resolves to the schedule. All times are in milliseconds since the epoch.

- `scheduleId` (String): Its id, which [`getSchedule()`](/Events/getSchedule/) and [`removeSchedule()`](/Events/removeSchedule/) take.
- `kind` (String): `'recurring'` for `every` and `cron`, `'once'` for `at`, and `'deferred'` for a notification sent later with [`notify()`](/Notifications/notify/#send-it-later).
- `appUid` (String): The app that created it.
- `handlerName` (String | null): The handler each run calls, or `null` once the schedule has ended.
- `contextKeys` (Array | null), `contextHash` (String | null): The key names and a hash of the stored context, never its values. `contextKeys` is `null` when there's no context, and once the schedule has ended.
- `every` (Number | null): The interval, in milliseconds, of an `every` schedule.
- `cron` (String | null): The expression of a `cron` schedule.
- `tz` (String): The time zone of a `cron` schedule, and `'UTC'` for the others.
- `startAt` (Number): The first time it may run. For `at`, its only run.
- `endsAt` (Number | null): The last time it may run, from `expiresAt` or `maxRuns`. For `at`, its only run.
- `state` (String): `'active'`, `'suspended'`, `'sending'`, or `'ended'`. A delayed notification is `'sending'` once it has started to go out.
- `suspendedReason` (String | null): Why it's [suspended](#suspended-and-ended-schedules).
- `endReason` (String | null), `endedAt` (Number | null): Why and when it [ended](#suspended-and-ended-schedules).
- `nextRunAt` (Number | null): The next slot of the schedule, worked out from its definition and the clock. A late or retried run for an earlier slot can still happen first. After the last slot is due, it stays at that slot until the run for it is done. `null` while the schedule is suspended or sending, and once it has ended.
- `createdAt` (Number): When it was created.
- `off()` (Function): Removes the schedule. Same as [`puter.events.removeSchedule(scheduleId)`](/Events/removeSchedule/). Only on the object `onSchedule()` returns.

The promise rejects with `{ message, code }`:

| `code` | Meaning |
| --- | --- |
| `invalid_request` | `options` isn't an object. |
| `events_handler_required` | There's no `handlerName`. |
| `events_handler_name_required` | `handler` was given without `handlerName`. |
| `events_handler_free_variable` | The handler uses an outside variable. The message names it. |
| `events_handler_invalid` | `handler` isn't a function, a source string, or `{ file }`. |
| `events_handler_hash_unavailable` | This environment has no `crypto.subtle`, so `handler` can't be hashed. Pass `handlerName` alone. |
| `events_context_invalid` | `context` isn't JSON-serializable. |
| `events_context_too_large` | The serialized `context` is over 4 KB. |
| `auth_canceled` | Nobody was signed in, and the user closed the sign-in without finishing it. |
| `events_schedule_app_required` | The call wasn't made by an app, for example from Node.js with an account token. |
| `events_durable_requires_account` | The call came from a scoped access token, such as the one in a [`getReadURL()`](/FS/getReadURL/) URL, or from a temporary (guest) account. |
| `too_many_requests` | Over the create rate limit, which is shared with subscribing. |
| `events_background_consent_required` | The user hasn't granted your app `events:background`. |
| `events_schedule_invalid` | An option is malformed. For example, more than one of `every`, `cron` and `at`, an `every` that isn't a whole number of seconds, a time with no zone, an `at` less than 1 second or more than 366 days ahead, an unsupported cron expression, an unknown `tz`, or `tz` without `cron`. The message says which. |
| `events_schedule_never_fires` | The schedule would never run. Its first run or its `startAt` is more than 366 days away, or it ends before its first run. |
| `events_schedule_too_frequent` | It would run more often than your plan's [minimum interval](#how-often-a-schedule-can-run). |
| `bad_request` | `handlerName` is empty or over 128 characters, or `handlerHash` isn't a SHA-256 hex digest. |
| `events_handler_not_found` | Nothing is published under `handlerName`. The schedule isn't created. |
| `events_handler_hash_mismatch` | The published handler isn't the source you passed as `handler`. |
| `events_schedule_limit` | The user holds as many schedules as their plan allows, for your app or in total. |
| `events_schedule_budget` | The schedule would make your app's schedules, or all of the user's schedules, run more times an hour than their plan allows. |
| `events_schedule_busy` | Puter is checking too many cron expressions at once. Try again in a moment. |
| `events_disabled` | Schedules aren't enabled on this server. |
| `events_failed` | The server sent a response the SDK couldn't read. |

## Examples

The handler is published once, by the app's developer, from a deploy script or the browser console. The schedule is created from the app, for each user.

<strong class="example-title">Run a handler on weekday mornings in the user's time zone</strong>

```js
// Deploy script, run as the app's developer
const app = await puter.apps.get('daily-digest');

await puter.events.handlers.publish('sendDigest', async ({ event, ctx, user }) => {
    const doneKey = `digest:${event.id}`;
    if (await user.kv.get(doneKey)) return;

    const notes = await user.kv.list('note:*', true);
    await user.notifications.notify({
        title: `Good morning, ${ctx.name}`,
        text: `You have ${notes.length} notes.`,
    });

    await user.kv.set(doneKey, true, Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60);
}, { appUid: app.uid });
```

```js
// In the app, signed in as the user
await puter.perms.request('backgroundEvents');

const schedule = await puter.events.onSchedule({
    cron: '0 8 * * 1-5',
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    handlerName: 'sendDigest',
    context: { name: 'Ana' },
});
console.log(`next digest at ${new Date(schedule.nextRunAt).toString()}`);
```

<strong class="example-title">Run once, an hour from now</strong>

```js
const reminder = await puter.events.onSchedule({
    at: Date.now() + 60 * 60 * 1000,
    handlerName: 'remind',
    context: { todoId: 'todo-42' },
});

// Changed your mind
await reminder.off();
```

<strong class="example-title">Run every 6 hours, on the hour, 28 times</strong>

```js
await puter.events.onSchedule({
    every: '6h',
    startAt: '2026-01-01T00:00:00Z',
    maxRuns: 28,
    handlerName: 'syncFeeds',
});
```
