---
title: Change Data at a Set Time
description: "Learn how to change a user's data at a time you pick with Puter.js, and cancel or move the change later, so it happens on time even while your app is closed."
tags: [events, notifications, kv]
order: 69
---

<div class="info">The Events API is in beta. Event shapes, limits, and behavior may change between releases.</div>

<div class="info">Schedules are available on puter.com. A self-hosted Puter server answers <code>events_disabled</code>.</div>

Some changes are due at a set time instead of right away. For example, a
snoozed task comes back to the list, a poll closes, or a shared link stops
working. On other platforms you'd store the time in a database and run a job
that checks it every minute.

In Puter, you create a one-time schedule that runs a function at that time with
[`puter.events.onSchedule()`](/Events/onSchedule/) and `at`. Puter runs it in an
[events worker](/Events/workers/), a serverless function, even while your app is
closed.

When all that's due is a notification,
[Remind Users Later](/recipes/remind-users-later/) sends one at a set time
with no handler or permission. To delete a key at a set time, give it an
expiry time, as [Store Temporary Data](/recipes/store-temporary-data/) shows.

The examples add snoozing to a task list app. The user hides a task until a
time they pick. At that time the task comes back to the list, and the user
gets a notification about it.

## Publish the Handler

The function a schedule runs is called a handler. This recipe publishes it once
under a name with [`puter.events.handlers.publish()`](/Events/handlers/), so one
copy serves every user and you can update it for all of them. Publishing is a
developer step, like a deploy, and it only works for the account that owns the
app. Run it from a deploy script or your browser console. To skip the deploy,
[pass the handler inline](#pass-the-handler-inline) instead.

```js
const app = await puter.apps.get('task-list');    // your app's name

async function unsnooze ({ ctx, user }) {
    const key = `task:${ctx.taskId}`;
    const task = await user.kv.get(key);
    if (!task) return;    // deleted while it was snoozed

    await user.notifications.notify({
        title: 'Back on your list',
        text: task.title,
        target: `/tasks/${ctx.taskId}`,
    });
    await user.kv.update(key, { snoozedUntil: null });
}

await puter.events.handlers.publish('unsnooze', unsnooze, { appUid: app.uid });
```

The handler gets `ctx`, the `context` the schedule was created with, and
`user`, a `puter` object signed in as the user the schedule belongs to. It
reads the task from the user's [key-value store](/KV/), sends a notification
with [`user.notifications.notify()`](/Notifications/notify/), and marks the
task as no longer snoozed with [`user.kv.update()`](/KV/update/).
[Run Code on a Schedule](/recipes/run-code-on-a-schedule/#publish-the-handler)
explains what else a handler can use.

### Pass the Handler Inline

For a one-time schedule, the handler can go straight into `onSchedule()`. Leave
out `handlerName`, and Puter stores the code in the signed-in user's own
[user scope](/Events/handlers/#user-scope) of your app:

```js
await puter.events.onSchedule({
    at: Date.now() + 60 * 60 * 1000,
    handler: async ({ ctx, user }) => {
        const key = `task:${ctx.taskId}`;
        const task = await user.kv.get(key);
        if (!task) return;

        await user.notifications.notify({ title: 'Back on your list', text: task.title });
        await user.kv.update(key, { snoozedUntil: null });
    },
    context: { taskId: 'task-42' },
});
```

Puter removes the code from the user's scope about a day after the schedule
ends. To remove it sooner, see
[Clean Up Background Work](/recipes/clean-up-background-work/#remove-a-user-scope).

## Ask for Permission

A schedule runs code while the user isn't there, so it needs the user's
`events:background` permission. Ask from your app with
[`puter.perms.request()`](/Perms/request/):

```js
const allowed = await puter.perms.request('backgroundEvents');
```

It resolves to `true` or `false`, and shows no prompt when the permission is
already granted. Without it, [`onSchedule()`](/Events/onSchedule/) fails with
`events_background_consent_required`. Schedules also need a Puter account,
so for a guest account [`onSchedule()`](/Events/onSchedule/) fails with
`events_durable_requires_account`.

If the user revokes the permission later, every schedule your app holds for
them ends, and their snoozed tasks stay snoozed. When the app opens, it can
bring back any task whose `snoozedUntil` has passed.

## Snooze a Task

To snooze a task, create a schedule in your app with
[`puter.events.onSchedule()`](/Events/onSchedule/). The `at` option is the time
it runs, once:

```js
async function snooze (taskId, until) {
    const schedule = await puter.events.onSchedule({
        at: until,
        handlerName: 'unsnooze',
        context: { taskId },
    });
    await puter.kv.update(`task:${taskId}`, {
        snoozedUntil: schedule.startAt,
        snoozeId: schedule.scheduleId,
    });
}

if (allowed) await snooze('42', new Date(Date.now() + 3 * 60 * 60 * 1000));    // three hours from now
```

The `at` option takes a `Date`, an ISO-8601 string with a time zone, or
milliseconds since the epoch, from 1 second to 366 days ahead. Puter rounds it
up to the next whole second, and `schedule.startAt` is the time the schedule
runs, in milliseconds since the epoch. A run usually starts within a minute of
it.

The handler gets `context` as `ctx`. The `context` is read once, when the
schedule is created, and can be at most 4 KB. So it
holds only the task's id, and the handler reads the task when it runs. A task
renamed while it's snoozed comes back with its new name.

The task keeps the schedule's id in `snoozeId`. The next sections use it to
skip repeated runs and to cancel or move the snooze.

A user can have a limited number of one-time schedules waiting for your app.
Past it, [`onSchedule()`](/Events/onSchedule/) rejects with
`events_schedule_limit`. See
[Rate Limits and Quotas](/rate-limits-and-quotas/#schedules).

## Skip a Run Already Done

Each run happens at least once. A run that times out, or fails with a network
error, is retried, and a retry can repeat work the first attempt already did.
Every attempt at a run has the same `event.id`, `<scheduleId>:<scheduledFor>`.
A one-time schedule has a single run, so `event.scheduleId` identifies the run
as well. The handler skips a run whose schedule isn't the task's current
`snoozeId`, and clears `snoozeId` when it brings the task back:

```js
async function unsnooze ({ event, ctx, user }) {
    const key = `task:${ctx.taskId}`;
    const task = await user.kv.get(key);
    if (!task || task.snoozeId !== event.scheduleId) return;

    await user.notifications.notify({
        title: 'Back on your list',
        text: task.title,
        target: `/tasks/${ctx.taskId}`,
        group: `task:${ctx.taskId}`,
    });
    await user.kv.update(key, { snoozedUntil: null, snoozeId: null });
}
```

A few details:

- A retry of a run that finished finds `snoozeId` cleared, and does nothing.
- The handler sends the notification before it changes the task. If the run
  fails between the two, the retry sends the notification again. A later
  notification with the same `group` replaces the earlier one, so the user
  sees it once.
- Two attempts that overlap, such as a run still going past its 30 seconds
  when its retry starts, can both pass the check. Both write the same values,
  and the `group` covers the notification.
- The same check skips a run for a snooze the user has since cancelled, as
  the next section shows.

Publish the handler again after the change. A deploy script runs in a new
process each time, so its SDK hasn't seen what's published. Call
[`handlers.list()`](/Events/handlers/) before publishing changed code, or
[`publish()`](/Events/handlers/) rejects with `events_handler_conflict`:

```js
await puter.events.handlers.list({ appUid: app.uid });
await puter.events.handlers.publish('unsnooze', unsnooze, { appUid: app.uid });
```

## Bring a Task Back Early

When the user brings a task back before its time, clear the snooze and end
the schedule with [`puter.events.removeSchedule()`](/Events/removeSchedule/):

```js
async function endSchedule (scheduleId) {
    try {
        await puter.events.removeSchedule(scheduleId);
    } catch (error) {
        // It already ran, or was already removed
        if (error.code !== 'events_schedule_not_found') throw error;
    }
}

async function unsnoozeNow (taskId) {
    const key = `task:${taskId}`;
    const task = await puter.kv.get(key);
    if (!task?.snoozeId) return;

    await puter.kv.update(key, { snoozedUntil: null, snoozeId: null });
    await endSchedule(task.snoozeId);
}
```

A one-time schedule ends once its run is done. Removing a schedule that has
ended, or one that was already removed, rejects with
`events_schedule_not_found`, so `endSchedule()` treats that error as done.

The code clears the task before it removes the schedule. Removing a schedule
doesn't stop a run that already started, and that run finds `snoozeId`
cleared and does nothing. A removal that fails, for example with a network
error, leaves a schedule that runs once and changes nothing. Removing it still
matters, since a schedule counts toward the user's limit until it runs or is
removed.

## Change the Snooze Time

To move a snooze, change its schedule's time with
[`puter.events.updateSchedule()`](/Events/updateSchedule/). The schedule keeps
its id, so the task's `snoozeId` stays valid. This version of `snooze()` moves
a snooze that's still waiting, and creates a new schedule otherwise:

```js
async function snooze (taskId, until) {
    const key = `task:${taskId}`;
    const previous = await puter.kv.get(key);

    let schedule = null;
    if (previous?.snoozeId) {
        try {
            schedule = await puter.events.updateSchedule(previous.snoozeId, { at: until });
        } catch (error) {
            // It already ran, or was removed
            if (error.code !== 'events_schedule_not_found') throw error;
        }
    }
    schedule ??= await puter.events.onSchedule({
        at: until,
        handlerName: 'unsnooze',
        context: { taskId },
    });

    await puter.kv.update(key, {
        snoozedUntil: schedule.startAt,
        snoozeId: schedule.scheduleId,
    });
}
```

A schedule that already ran, or was removed, rejects with
`events_schedule_not_found`, so `snooze()` creates a new one. A run that
already started when you move it still finishes. It finds the task's
`snoozeId` and brings the task back, and the moved run later finds `snoozeId`
cleared and does nothing.

## Repeat a Few Times, Then Stop

Some changes repeat a set number of times. For example, a task such as "Take
your medicine" comes back every day for 5 days. Give
[`onSchedule()`](/Events/onSchedule/) an `every` interval and `maxRuns`, and
the schedule ends on its own after its last run.

Each run of a repeating schedule has its own `event.id`, so the handler keeps
the id of the last run it handled and skips a retry of that run. Publish it as
the app's developer, like `unsnooze`, or pass it inline as `handler`:

```js
async function reopenTask ({ event, ctx, user }) {
    const key = `task:${ctx.taskId}`;
    const task = await user.kv.get(key);
    if (!task || task.repeatId !== event.scheduleId || task.lastRunId === event.id) return;

    await user.notifications.notify({
        title: 'Back on your list',
        text: task.title,
        target: `/tasks/${ctx.taskId}`,
        group: `task:${ctx.taskId}`,
    });
    await user.kv.update(key, { done: false, lastRunId: event.id });
}

await puter.events.handlers.publish('reopenTask', reopenTask, { appUid: app.uid });
```

In the app, create the schedule and keep its id with the task, as `snooze()`
does:

```js
async function repeatTask (taskId, every, times) {
    const schedule = await puter.events.onSchedule({
        every,
        maxRuns: times,
        handlerName: 'reopenTask',
        context: { taskId },
    });
    await puter.kv.update(`task:${taskId}`, { repeatId: schedule.scheduleId });
}

async function stopRepeating (taskId) {
    const key = `task:${taskId}`;
    const task = await puter.kv.get(key);
    if (!task?.repeatId) return;

    await puter.kv.update(key, { repeatId: null });
    await endSchedule(task.repeatId);
}

if (allowed) await repeatTask('43', '1d', 5);    // once a day, 5 times
```

The first run is one interval after the call, so this reopens the task
tomorrow at this time and on the 4 days after that. To pick the first run,
pass `startAt`. The `maxRuns` option counts the times the schedule was due,
so a run skipped while the schedule was suspended still counts. To stop at a
time instead, pass `expiresAt`, the last time the schedule may run. With both,
whichever comes first ends the schedule.

An `every` interval is a fixed length of time, so a daily run moves by an hour
in local time when the clocks change. To run at the same local time each day,
use `cron` and `tz`, as
[Run Code on a Schedule](/recipes/run-code-on-a-schedule/#create-the-schedule-once-per-user)
does. The `maxRuns` option works with `cron` too.

A user can hold fewer repeating schedules than one-time ones for your app.
Past the limit, [`onSchedule()`](/Events/onSchedule/) rejects with
`events_schedule_limit`. See
[Rate Limits and Quotas](/rate-limits-and-quotas/#schedules).

## Full Code

The recipe has two programs. The publish script runs as the app's developer,
from a deploy script or your browser console:

```js
const app = await puter.apps.get('task-list');    // your app's name

async function unsnooze ({ event, ctx, user }) {
    const key = `task:${ctx.taskId}`;
    const task = await user.kv.get(key);
    if (!task || task.snoozeId !== event.scheduleId) return;

    await user.notifications.notify({
        title: 'Back on your list',
        text: task.title,
        target: `/tasks/${ctx.taskId}`,
        group: `task:${ctx.taskId}`,
    });
    await user.kv.update(key, { snoozedUntil: null, snoozeId: null });
}

async function reopenTask ({ event, ctx, user }) {
    const key = `task:${ctx.taskId}`;
    const task = await user.kv.get(key);
    if (!task || task.repeatId !== event.scheduleId || task.lastRunId === event.id) return;

    await user.notifications.notify({
        title: 'Back on your list',
        text: task.title,
        target: `/tasks/${ctx.taskId}`,
        group: `task:${ctx.taskId}`,
    });
    await user.kv.update(key, { done: false, lastRunId: event.id });
}

await puter.events.handlers.list({ appUid: app.uid });
await puter.events.handlers.publish('unsnooze', unsnooze, { appUid: app.uid });
await puter.events.handlers.publish('reopenTask', reopenTask, { appUid: app.uid });
```

The app code runs in your app, signed in as the user:

```js
async function endSchedule (scheduleId) {
    try {
        await puter.events.removeSchedule(scheduleId);
    } catch (error) {
        // It already ran, or was already removed
        if (error.code !== 'events_schedule_not_found') throw error;
    }
}

async function snooze (taskId, until) {
    const key = `task:${taskId}`;
    const previous = await puter.kv.get(key);

    let schedule = null;
    if (previous?.snoozeId) {
        try {
            schedule = await puter.events.updateSchedule(previous.snoozeId, { at: until });
        } catch (error) {
            // It already ran, or was removed
            if (error.code !== 'events_schedule_not_found') throw error;
        }
    }
    schedule ??= await puter.events.onSchedule({
        at: until,
        handlerName: 'unsnooze',
        context: { taskId },
    });

    await puter.kv.update(key, {
        snoozedUntil: schedule.startAt,
        snoozeId: schedule.scheduleId,
    });
}

async function unsnoozeNow (taskId) {
    const key = `task:${taskId}`;
    const task = await puter.kv.get(key);
    if (!task?.snoozeId) return;

    await puter.kv.update(key, { snoozedUntil: null, snoozeId: null });
    await endSchedule(task.snoozeId);
}

async function repeatTask (taskId, every, times) {
    const schedule = await puter.events.onSchedule({
        every,
        maxRuns: times,
        handlerName: 'reopenTask',
        context: { taskId },
    });
    await puter.kv.update(`task:${taskId}`, { repeatId: schedule.scheduleId });
}

async function stopRepeating (taskId) {
    const key = `task:${taskId}`;
    const task = await puter.kv.get(key);
    if (!task?.repeatId) return;

    await puter.kv.update(key, { repeatId: null });
    await endSchedule(task.repeatId);
}

const allowed = await puter.perms.request('backgroundEvents');
if (allowed) {
    await snooze('42', new Date(Date.now() + 3 * 60 * 60 * 1000));    // three hours from now
    await repeatTask('43', '1d', 5);    // once a day, 5 times
}
```
