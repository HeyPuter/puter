---
title: puter.events.updateSchedule()
description: Move a schedule to a new time, change its context, or edit a notification stored to send later, while keeping its id.
platforms: [websites, apps, nodejs, workers]
---

<div class="info">The Events API is in beta. Event shapes, limits, and behavior may change between releases.</div>

Changes a schedule created with [`puter.events.onSchedule()`](/Events/onSchedule/), or a notification stored to send later with [`puter.notifications.notify()`](/Notifications/notify/#send-it-later). The schedule keeps its `scheduleId`, its kind and its handler, so ids you saved elsewhere stay valid.

An app can change only the schedules it created. An account session can change any of the user's schedules. A scoped access token can't change any. On a website with nobody signed in, the call asks the user to sign in first, as other Puter.js calls do.

## Syntax

```js
puter.events.updateSchedule(scheduleId, changes)
```

## Parameters

#### `scheduleId` (String) (required)

The `scheduleId` from [`onSchedule()`](/Events/onSchedule/), [`notify()`](/Notifications/notify/#send-it-later) or [`listSchedules()`](/Events/listSchedules/).

#### `changes` (Object) (required)

For a schedule from [`onSchedule()`](/Events/onSchedule/), pass new timing, a new `context`, or both:

- **Timing.** Any of `at`, `every`, `cron`, `tz`, `startAt`, `expiresAt` and `maxRuns` replaces the whole timing, so pass exactly one of `at`, `every` or `cron`, together with every other timing option you want to keep. They take the same values as in [`onSchedule()`](/Events/onSchedule/#parameters). A recurring schedule can switch between `every` and `cron`, and an `at` schedule stays a one-time schedule. Without timing options, the timing stays as it is.
- `context` (Object | null): Replaces the whole context. Pass `null` to clear it. Up to 4 KB serialized, as in [`onSchedule()`](/Events/onSchedule/#parameters).

For a stored notification, pass a new `sendAt`, new content, or both:

- `sendAt` (Number | String | Date): The new time to send it, as in [`notify()`](/Notifications/notify/#parameters). A time within 5 seconds, or in the past, sends it now, with the [retries](/Notifications/notify/#send-it-later) of any stored notification.
- `title`, `text`, `icon`, `target`, `data`, `group`, `channel`, `sensitive`, `priority`, `ttl`: Replace the stored values, with the same rules as [`notify()`](/Notifications/notify/#parameters). Fields you leave out keep their values. Pass `null` to clear an optional field. The `title` can't be cleared.

The handler and the recipient can't change. Passing `handler`, `handlerName`, `handlerScope`, `handlerHash`, `handlerSource` or `to` rejects with `invalid_request`. To run different code, remove the schedule and create a new one.

## Return value

A `Promise` that resolves to the updated schedule, in the shape [`getSchedule()`](/Events/getSchedule/#return-value) returns. Its `nextRunAt` is the next run under the new timing. It describes the context by its key names and a hash, and never includes a stored notification's content. A stored notification whose new `sendAt` is due now is sent during the call, so the schedule can come back already ended.

The promise rejects with `{ message, code }`:

| `code` | Meaning |
| --- | --- |
| `events_schedule_not_found` | No such schedule, it isn't this caller's, or it already ended. Also for an empty `scheduleId`. |
| `events_schedule_sending` | The stored notification has started to go out. If the attempt fails and it returns to `active`, it can be changed while it waits to retry. |
| `invalid_request` | `changes` isn't an object, it has a field that can't change, or the new timing would turn a one-time schedule into a recurring one or the other way round. |
| `events_schedule_invalid` | A timing option or `sendAt` is malformed, or too far ahead. |
| `events_schedule_never_fires` | The new timing would never run. |
| `events_schedule_too_frequent` | The new timing would run more often than the user's plan allows. |
| `events_schedule_limit` | The new timing goes over the number of schedules the user's plan allows. |
| `events_schedule_budget` | The new timing goes over the runs per hour the user's plan allows. |
| `events_schedule_busy` | Puter is checking too many cron expressions at once. Try again in a moment. |
| `events_context_invalid` | `context` can't be serialized as JSON. |
| `events_context_too_large` | The serialized `context` is over 4 KB. |
| `bad_request` | A notification field is over its limit or has the wrong type. The message names the field. |
| `notification_value_too_large`, `events_value_too_large` | The stored notification would be over 16 KB as JSON. |
| `too_many_requests` | Over the rate limit, which is shared with [`onSchedule()`](/Events/onSchedule/). See [Rate Limits and Quotas](/rate-limits-and-quotas/#schedules). |
| `auth_canceled` | Nobody was signed in, and the user closed the sign-in without finishing it. |
| `events_disabled` | Changing schedules isn't available on this server. |
| `events_failed` | Other changes to the schedule kept getting in the way, or the server sent a response the SDK couldn't read. |

## How the change applies

- Runs after the call use the new timing and context. A run that already started finishes with the old context, and its result doesn't affect the new timing.
- A suspended schedule stays suspended, and uses the new timing and context when it resumes.
- New timing is checked against the user's current plan, as a new schedule would be, except that the schedule being changed doesn't count against itself. See [Rate Limits and Quotas](/rate-limits-and-quotas/#schedules).
- If the call fails partway, for example with a network error, the change may still have happened, and the schedule can pause for a minute or more before Puter finishes it. Read the schedule with [`getSchedule()`](/Events/getSchedule/) to check.

## Examples

<strong class="example-title">Move a reminder to a later time</strong>

```html;events-update-reminder
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            // (1) Store a reminder for an hour from now
            const reminder = await puter.notifications.notify({
                title: 'Review your notes',
                sendAt: Date.now() + 60 * 60 * 1000,
            });
            if (typeof reminder !== 'object' || !reminder) return;    // due now, so it was sent at once
            puter.print(`goes out ${new Date(reminder.sendAt).toLocaleTimeString()}<br>`);

            // (2) Move it an hour later and change what it says, keeping its id
            const updated = await puter.events.updateSchedule(reminder.scheduleId, {
                sendAt: Date.now() + 2 * 60 * 60 * 1000,
                title: 'Review your meeting notes',
            });
            puter.print(`now goes out ${new Date(updated.nextRunAt).toLocaleTimeString()}<br>`);

            // (3) Cleanup
            await puter.notifications.cancel(reminder.scheduleId);
            puter.print('cancelled<br>');
        })();
    </script>
</body>
</html>
```

<strong class="example-title">Move a weekday schedule to another time</strong>

```html;events-update-cron
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            if (!await puter.perms.request('backgroundEvents')) {
                puter.print('background events were not allowed<br>');
                return;
            }

            // (1) Weekdays at 09:00 in this browser's time zone
            const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
            const schedule = await puter.events.onSchedule({
                cron: '0 9 * * 1-5',
                tz,
                handler: async ({ user }) => {
                    await user.notifications.notify({ title: 'Check your tasks' });
                },
            });
            puter.print(`next run: ${new Date(schedule.nextRunAt).toLocaleString()}<br>`);

            // (2) Move it to 10:00, keeping the same id and handler
            const updated = await puter.events.updateSchedule(schedule.scheduleId, {
                cron: '0 10 * * 1-5',
                tz,
            });
            puter.print(`next run: ${new Date(updated.nextRunAt).toLocaleString()}<br>`);

            // (3) Cleanup: end the schedule, then remove the handler it created
            await schedule.off();
            await puter.events.handlers.remove(schedule.handlerName, { scope: 'user' });
            puter.print('removed<br>');
        })();
    </script>
</body>
</html>
```
