---
title: puter.events.updateSchedule()
description: Change a schedule's timing or context, or edit a stored notification.
platforms: [websites, apps, nodejs, workers]
---

<div class="info">The Events API is in beta. Event shapes, limits, and behavior may change between releases.</div>

Changes a schedule created with [`puter.events.onSchedule()`](/Events/onSchedule/) or a notification stored with [`puter.notifications.notify()`](/Notifications/notify/#send-it-later). The schedule keeps its id, kind, handler and owner. A suspended schedule stays suspended and uses the replacement definition when it resumes.

An app can change only its own schedules. An account session can change any of the user's schedules. A scoped access token can't change any. On a website with nobody signed in, the call asks the user to sign in first.

## Syntax

```js
puter.events.updateSchedule(scheduleId, changes)
```

## Parameters

#### `scheduleId` (String) (required)

The id returned by [`onSchedule()`](/Events/onSchedule/), [`notify()`](/Notifications/notify/#send-it-later) or [`listSchedules()`](/Events/listSchedules/).

#### `changes` (Object) (required)

For a handler schedule, pass timing fields, `context`, or both:

- Any of `at`, `every`, `cron`, `tz`, `startAt`, `expiresAt` or `maxRuns` replaces the whole timing definition. Supply exactly one of `at`, `every` or `cron`, with the other timing options you want to keep. The defaults and validation are the same as [`onSchedule()`](/Events/onSchedule/#parameters). A recurring schedule can switch between an interval and cron. A one-time schedule stays one-time.
- Without timing fields, the timing stays as it is.
- When supplied, `context` replaces the whole context. Pass `null` to clear it. The serialized value has the same 4 KB limit as [`onSchedule()`](/Events/onSchedule/#parameters).

For a stored notification, pass `sendAt`, notification content, or both. The content fields are `title`, `text`, `icon`, `target`, `data`, `group`, `channel`, `sensitive`, `priority` and `ttl`, with the same validation as [`notify()`](/Notifications/notify/#parameters). Supplied fields replace their stored values. Omitted fields stay as they are. Pass `null` to clear an optional field, restoring its default if it has one. The title must remain a nonempty string.

A `sendAt` in the past or within 5 seconds triggers a send attempt immediately. A temporary failure keeps the notification scheduled for a retry, using the [stored notification retry rules](/Notifications/notify/#send-it-later). The recipient stays the same.

The fields `handler`, `handlerName`, `handlerScope`, `handlerHash`, `handlerSource` and `to` are fixed and reject with `invalid_request` when supplied.

## Return value

A `Promise` resolving to the updated schedule in the same shape as [`getSchedule()`](/Events/getSchedule/#return-value), without `off()`. It reports context keys and a hash, never the context values or notification content. An immediate notification send can return an ended schedule.

Future attempts use the replacement definition. A handler invocation already sent can finish with the old context. Its result can't advance or end the replacement schedule.

Timing changes are checked against the user's current plan, including its minimum interval, schedule counts and recurring fire budget. The count and budget checks exclude the schedule being changed. Updates share the creation [rate limit](/rate-limits-and-quotas/#schedules).

The promise rejects with `{ message, code }`:

| `code` | Meaning |
| --- | --- |
| `events_schedule_not_found` | The id is empty, unknown, outside the caller's scope, or already ended. |
| `events_schedule_sending` | A stored notification has started sending. It can be changed if a failed attempt returns it to `active`. |
| `invalid_request` | The changes value isn't an object, a field can't change, or the timing changes the schedule's kind. |
| `events_schedule_invalid` | The timing is malformed or outside the allowed time range. |
| `events_schedule_never_fires` | The replacement timing has no allowed run. |
| `events_schedule_too_frequent` | The replacement timing is below the current plan's minimum interval. |
| `events_schedule_limit` | The replacement timing exceeds the current plan's schedule count. |
| `events_schedule_budget` | The replacement timing exceeds the current plan's recurring fire budget. |
| `events_schedule_busy` | Too many cron expressions are being checked. Try again in a moment. |
| `events_context_invalid` | The context can't be serialized as JSON. |
| `events_context_too_large` | The serialized context exceeds 4 KB. |
| `bad_request` | A notification content field is invalid or the context can't be serialized by the server. |
| `notification_value_too_large` | The notification value exceeds 16 KB. |
| `events_value_too_large` | The stored notification payload exceeds 16 KB. |
| `too_many_requests` | Over the shared creation and update rate limit. |
| `auth_canceled` | The user closed sign-in without finishing it. |
| `events_disabled` | Schedules or schedule updates aren't available on this server. |
| `events_failed` | The response couldn't be read, or repeated concurrent changes prevented the update. |

An interrupted update can pause attempts until recovery. Recovery is eligible after 60 seconds and runs during reconciliation. After a network failure, read the schedule with [`getSchedule()`](/Events/getSchedule/) to check whether the update happened.

## Examples

<strong class="example-title">Move a reminder</strong>

```html;events-update-reminder
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            const reminder = await puter.notifications.notify({
                title: 'Review your notes',
                sendAt: Date.now() + 60 * 60 * 1000,
            });
            if (!reminder || typeof reminder !== 'object') return;
            const updated = await puter.events.updateSchedule(reminder.scheduleId, {
                sendAt: Date.now() + 2 * 60 * 60 * 1000,
                title: 'Review your meeting notes',
            });
            puter.print(new Date(updated.startAt).toLocaleString());
        })();
    </script>
</body>
</html>
```

<strong class="example-title">Change a recurring schedule's cron</strong>

```html;events-update-cron
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            await puter.perms.request('backgroundEvents');
            const schedule = await puter.events.onSchedule({
                cron: '0 9 * * 1-5',
                tz: 'UTC',
                handler: async ({ user }) => {
                    await user.notifications.notify({ title: 'Check your tasks' });
                },
            });
            const updated = await puter.events.updateSchedule(schedule.scheduleId, {
                cron: '0 10 * * 1-5',
                tz: 'UTC',
            });
            puter.print(`${updated.scheduleId}: ${updated.cron}`);
        })();
    </script>
</body>
</html>
```
