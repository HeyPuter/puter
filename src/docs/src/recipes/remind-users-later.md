---
title: Remind Users Later
description: "Learn how to send a user a reminder at a time they pick with Puter.js, and move or cancel it later, even while your app is closed."
tags: [notifications, events, kv]
order: 69
---

<div class="info">Sending later with <code>sendAt</code> is available on puter.com. A self-hosted Puter server answers <code>events_disabled</code>.</div>

A "remind me later" button, a reminder before a meeting, or a note that a
trial is about to end all need a notification that goes out at a set time,
often when nobody has your app open. On other platforms you'd store the
reminder in a database and run a job that checks it every minute.

With Puter.js, you pass the time to
[`puter.notifications.notify()`](/Notifications/notify/) as `sendAt`. Puter
stores the notification and sends it at that time. Your app doesn't need to
be open, and you don't need a server or a handler.

The examples build reminders for a task list app. The user picks a task and a
time, and gets a notification about it then.

## Send a Notification Later

Call [`notify()`](/Notifications/notify/) with `sendAt`:

```js
const reminder = await puter.notifications.notify({
    title: 'Reminder: Call the dentist',
    target: '/tasks/42',
    sendAt: Date.now() + 2 * 60 * 60 * 1000,    // two hours from now
});
```

The `sendAt` option takes a `Date`, an ISO-8601 string with a time zone such
as `'2026-11-14T09:00:00-05:00'`, or milliseconds since the epoch. It can be
up to 366 days ahead.

The call resolves to `{ scheduleId, sendAt }`. A `sendAt` within 5 seconds,
or already past, isn't stored. The notification goes out at once, and the call
resolves as it would without `sendAt`, with the notification's `uid` (a
string). Check which one you got before keeping a `scheduleId`.

Puter usually sends the stored notification within 15 seconds of `sendAt`, as
if your app called [`notify()`](/Notifications/notify/) then. It reaches every
open page of your app, and goes out as a push when no page is open and the
user turned pushes on.
[Reach a User When Your App Is Closed](/recipes/reach-a-user-when-your-app-is-closed/)
shows how to set pushes up, and `target` is the page the user lands on when
they tap it.

## Cancel a Reminder

When the user finishes the task first, the reminder shouldn't go out. Keep the
`scheduleId` with the task, in the app's
[key-value store](/KV/):

```js
async function remindLater (taskId, title, sendAt) {
    const reminder = await puter.notifications.notify({
        title: `Reminder: ${title}`,
        target: `/tasks/${taskId}`,
        sendAt,
    });
    // A time within 5 seconds, or past, is sent at once, so there's nothing to cancel.
    if (typeof reminder !== 'object' || !reminder) return;
    await puter.kv.set(`reminder:${taskId}`, reminder.scheduleId);
}
```

Then cancel it with
[`puter.notifications.cancel()`](/Notifications/cancel/) when the task is
done:

```js
async function cancelReminder (taskId) {
    const scheduleId = await puter.kv.get(`reminder:${taskId}`);
    if (!scheduleId) return;

    try {
        await puter.notifications.cancel(scheduleId);
    } catch (error) {
        // Already sent, or going out right now
        if (error.code !== 'events_schedule_not_found' && error.code !== 'events_schedule_sending') throw error;
    }
    await puter.kv.del(`reminder:${taskId}`);
}
```

A reminder that was already sent, or already cancelled, rejects with
`events_schedule_not_found`. One that's going out right now rejects with
`events_schedule_sending`. Either way it's too late to stop it, so the code
removes the stored id and moves on.

## Move a Reminder

When the user picks a new time, move the reminder with
[`puter.events.updateSchedule()`](/Events/updateSchedule/). It keeps its
`scheduleId`, so the id stored with the task stays valid:

```js
async function moveReminder (taskId, title, sendAt) {
    const scheduleId = await puter.kv.get(`reminder:${taskId}`);
    if (!scheduleId) return remindLater(taskId, title, sendAt);

    try {
        await puter.events.updateSchedule(scheduleId, { sendAt });
    } catch (error) {
        // Already sent, so store a new one
        if (error.code !== 'events_schedule_not_found') throw error;
        await remindLater(taskId, title, sendAt);
    }
}
```

A reminder that was already sent rejects with `events_schedule_not_found`, so
`moveReminder()` stores a new one. One that's going out right now rejects with
`events_schedule_sending`, and it's too late to move it. A new `sendAt` within
5 seconds, or in the past, sends it right away. The same call can change what
the reminder says, such as `{ sendAt, title }`. The fields it takes are on
[`updateSchedule()`](/Events/updateSchedule/).

## Show the Reminders That Are Waiting

To list the notifications your app has waiting for the user, along with any
[schedules](/Events/onSchedule/) it created, use
[`puter.events.listSchedules()`](/Events/listSchedules/). A stored
notification has `kind: 'deferred'`, and `nextRunAt` is when it goes out:

```js
async function listReminders () {
    const waiting = [];
    let cursor = null;
    do {
        const page = await puter.events.listSchedules({ cursor });
        for (const schedule of page.items) {
            if (schedule.kind === 'deferred' && schedule.state === 'active') {
                waiting.push({ scheduleId: schedule.scheduleId, sendAt: schedule.nextRunAt });
            }
        }
        cursor = page.cursor ?? null;
    } while (cursor);
    return waiting;
}
```

The list doesn't include the notification's title, so match each
`scheduleId` with the ids stored by `remindLater()` to show which task it's
for.

There's a limit on how many notifications your app can have waiting for one
user. Past it, [`notify()`](/Notifications/notify/) rejects with
`events_schedule_limit`.
See [Rate Limits and Quotas](/rate-limits-and-quotas/#schedules).

## Decide When the Reminder Is Due

A notification sent with `sendAt` is fixed when you store it. To decide at
the last moment, for example to skip the reminder when the task is already
done, run a handler at that time instead with
[`puter.events.onSchedule()`](/Events/onSchedule/) and `at`. The handler
checks the task and sends the notification itself.

Publish the handler once, as the app's developer, from a deploy script or
your browser console, or pass the same function as `handler` to `onSchedule()`
to store it in the user's own [user scope](/Events/handlers/#user-scope). [Run Code on a Schedule](/recipes/run-code-on-a-schedule/)
explains handlers and the `user` object they get:

```js
const app = await puter.apps.get('task-list');    // your app's name

async function remindIfOpen ({ event, ctx, user }) {
    const sentKey = `reminded:${event.id}`;
    if (await user.kv.get(sentKey)) return;

    const task = await user.kv.get(`task:${ctx.taskId}`);
    if (task && !task.done) {
        await user.notifications.notify({
            title: `Reminder: ${task.title}`,
            target: `/tasks/${ctx.taskId}`,
        });
    }

    await user.kv.set(sentKey, true, Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60);
}

await puter.events.handlers.publish('remindIfOpen', remindIfOpen, { appUid: app.uid });
```

Then, in the app, create a one-time schedule for the task:

```js
await puter.perms.request('backgroundEvents');

const schedule = await puter.events.onSchedule({
    at: Date.now() + 2 * 60 * 60 * 1000,
    handlerName: 'remindIfOpen',
    context: { taskId: '42' },
});
```

The handler gets `context` as `ctx`, so it knows which task to check. A run
can happen more than once, so the handler saves `event.id` after sending and
skips it the next time. Running a handler needs the user's
`events:background` permission, which a plain `sendAt` doesn't.

Cancel it the same way as a stored notification, with
[`puter.events.removeSchedule()`](/Events/removeSchedule/) and
`schedule.scheduleId`, and move it with
[`puter.events.updateSchedule()`](/Events/updateSchedule/) and a new `at`.
[Change Data at a Set Time](/recipes/change-data-at-a-set-time/) shows how to
cancel or move a one-time schedule, including one that has already run.

## Full Code

The app code for reminders sent with `sendAt`, signed in as the user:

```js
async function remindLater (taskId, title, sendAt) {
    const reminder = await puter.notifications.notify({
        title: `Reminder: ${title}`,
        target: `/tasks/${taskId}`,
        sendAt,
    });
    // A time within 5 seconds, or past, is sent at once, so there's nothing to cancel.
    if (typeof reminder !== 'object' || !reminder) return;
    await puter.kv.set(`reminder:${taskId}`, reminder.scheduleId);
}

async function cancelReminder (taskId) {
    const scheduleId = await puter.kv.get(`reminder:${taskId}`);
    if (!scheduleId) return;

    try {
        await puter.notifications.cancel(scheduleId);
    } catch (error) {
        // Already sent, or going out right now
        if (error.code !== 'events_schedule_not_found' && error.code !== 'events_schedule_sending') throw error;
    }
    await puter.kv.del(`reminder:${taskId}`);
}

async function moveReminder (taskId, title, sendAt) {
    const scheduleId = await puter.kv.get(`reminder:${taskId}`);
    if (!scheduleId) return remindLater(taskId, title, sendAt);

    try {
        await puter.events.updateSchedule(scheduleId, { sendAt });
    } catch (error) {
        // Already sent, so store a new one
        if (error.code !== 'events_schedule_not_found') throw error;
        await remindLater(taskId, title, sendAt);
    }
}

async function listReminders () {
    const waiting = [];
    let cursor = null;
    do {
        const page = await puter.events.listSchedules({ cursor });
        for (const schedule of page.items) {
            if (schedule.kind === 'deferred' && schedule.state === 'active') {
                waiting.push({ scheduleId: schedule.scheduleId, sendAt: schedule.nextRunAt });
            }
        }
        cursor = page.cursor ?? null;
    } while (cursor);
    return waiting;
}
```
