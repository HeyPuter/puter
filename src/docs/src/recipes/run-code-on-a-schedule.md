---
title: Run Code on a Schedule
description: "Learn how to run your own code on a schedule with Puter.js, like a cron job, so your app can send each user a morning summary in their own time zone, even while the app is closed."
tags: [events, notifications, kv]
order: 68
---

<div class="info">The Events API is in beta. Event shapes, limits, and behavior may change between releases.</div>

Some work happens on a clock instead of in response to something the user
did. For example, sending a summary every weekday morning, clearing out old
data every night, or checking a feed every hour. On other platforms you'd use
a cron job or a scheduled cloud function.

In Puter, you write a function, publish it once, and give each user a
schedule that runs it. Puter runs it in your app's
[events worker](/Events/workers/), a serverless function that belongs to your
app, at the times the schedule says. You don't need to run a server.

[Run Code in the Background](/recipes/run-code-in-the-background/) runs a
function when a user's files change. This recipe runs one at set times
instead, with [`puter.events.onSchedule()`](/Events/onSchedule/). The examples
build a task list app that sends each user a notification at 8:00 every
weekday morning, in their own time zone, with how many tasks they have open.

## Publish the Handler

The function a schedule runs is called a handler. Publish it with
[`puter.events.handlers.publish()`](/Events/handlers/). This is a developer
step, like a deploy, and it only works for the account that owns the app. Run
it from a deploy script or your browser console:

```js
const app = await puter.apps.get('task-list');    // your app's name

async function sendSummary ({ user }) {
    const tasks = (await user.kv.get('tasks')) ?? [];
    const open = tasks.filter((task) => !task.done);
    if (open.length === 0) return;

    await user.notifications.notify({
        title: 'Good morning',
        text: `You have ${open.length} open tasks today.`,
        target: '/tasks',
        group: 'morning-summary',
    });
}

await puter.events.handlers.publish('sendSummary', sendSummary, { appUid: app.uid });
```

The handler gets one object as its argument. This one uses `user`, a `puter`
object signed in as the user the schedule belongs to. It can do whatever your
app can do for that user, like `user.kv` and `user.notifications`. It's valid
for 15 minutes, so use it only during the run.

Puter stores the handler's code and runs it later in the events worker, so
the handler can only use its parameters, its own variables, and standard
globals like `fetch`, `JSON` and `Math`. It uses `user` instead of `puter`.
The [`publish()`](/Events/handlers/) method checks this, and fails with
`events_handler_free_variable` if the handler uses a name it doesn't define.

The notification reaches every open page of your app, and goes out as a push
when none is open and the user turned pushes on.
[Reach a User When Your App Is Closed](/recipes/push-when-closed/) shows how
to set pushes up. The `group` makes each morning's summary replace the one
before it.

## Ask for Permission

A schedule runs code while the user isn't there, so it needs the user's
permission. Ask from your app with [`puter.perms.request()`](/Perms/request/):

```js
const allowed = await puter.perms.request('backgroundEvents');
```

It resolves to `true` or `false`. If the permission is already granted, the
user doesn't see a prompt. Without it,
[`onSchedule()`](/Events/onSchedule/) fails with
`events_background_consent_required`.

If the user takes the permission back later, every schedule your app holds for
them ends. Granting it again doesn't bring them back, so your app has to
create them again. Schedules also need a Puter account. For a guest account,
[`onSchedule()`](/Events/onSchedule/) fails with
`events_durable_requires_account`.

## Create the Schedule Once per User

The schedule says when to run the handler. Here it's a `cron` expression with
the user's time zone:

```js
const options = {
    cron: '0 8 * * 1-5',
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    handlerName: 'sendSummary',
};
```

The five fields of `0 8 * * 1-5` are the minute, the hour, the day of the
month, the month and the day of the week, so it means 8:00 on Monday to
Friday. The `tz` option is the browser's time zone, such as
`'America/New_York'`. The schedule follows that zone's daylight saving time,
so the summary arrives at 8:00 local time all year.
[`onSchedule()`](/Events/onSchedule/#cron-expressions) lists the cron syntax
it accepts.

Every [`onSchedule()`](/Events/onSchedule/) call creates a new schedule, even
with the same options. If you call it each time the app opens, the user gets
one more summary each morning for every time they opened it. Check
[`puter.events.listSchedules()`](/Events/listSchedules/) first:

```js
async function findSchedule () {
    let cursor = null;
    do {
        const page = await puter.events.listSchedules({ cursor });
        const found = page.items.find((schedule) =>
            schedule.handlerName === options.handlerName && schedule.state !== 'ended');
        if (found) return found;
        cursor = page.cursor ?? null;
    } while (cursor);
    return null;
}

async function startMorningSummary () {
    if (await findSchedule()) return;
    await puter.events.onSchedule(options);
}
```

Call `startMorningSummary()` when the app opens, after the user has given
permission. A few details:

- The [`listSchedules()`](/Events/listSchedules/) method returns one page at a
  time, and only your app's schedules for this user. The loop follows
  `cursor` until there are no more pages.
- Ended schedules stay in the list for 7 days, so the code skips ones with
  `state: 'ended'`. That includes a schedule that ended because the user took
  the permission back, so the app creates a new one once it's granted again.
- A suspended schedule has `state: 'suspended'`. It resumes on its own, for
  example when the user adds credit, so the code keeps it.

If two tabs open at the same moment, both might create a schedule. If
[`listSchedules()`](/Events/listSchedules/) finds more than one, keep one and
remove the rest with
[`puter.events.removeSchedule()`](/Events/removeSchedule/).

## Send Each Summary Only Once

Puter runs each slot of a schedule at least once. A run that times out, or
fails with a network error, is retried, and a retry can repeat work the first
attempt already did. Every attempt at the same slot has the same `event.id`,
so the handler saves it after sending and skips IDs it has already sent. The
marker key expires after a week, so these keys don't pile up in the user's
key-value store:

```js
async function sendSummary ({ event, user }) {
    const sentKey = `summary-sent:${event.id}`;
    if (await user.kv.get(sentKey)) return;

    const tasks = (await user.kv.get('tasks')) ?? [];
    const open = tasks.filter((task) => !task.done);
    if (open.length > 0) {
        await user.notifications.notify({
            title: 'Good morning',
            text: `You have ${open.length} open tasks today.`,
            target: '/tasks',
            group: 'morning-summary',
        });
    }

    await user.kv.set(sentKey, true, Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60);
}
```

Publish the handler again after the change. The schedules already created use
the new code from their next run.

## Handle Mornings That Were Missed

A schedule can fall behind. For example, if the handler failed 5 times in a
row, Puter pauses the schedule until you publish a fix. When it resumes, it
doesn't send every summary it missed. It runs the next one, and `event.missed`
says how many runs were skipped. The summary can say so:

```js
async function sendSummary ({ event, user }) {
    const sentKey = `summary-sent:${event.id}`;
    if (await user.kv.get(sentKey)) return;

    const tasks = (await user.kv.get('tasks')) ?? [];
    const open = tasks.filter((task) => !task.done);
    const skipped = event.missed > 0 ? ` ${event.missed} earlier summaries were skipped.` : '';
    if (open.length > 0) {
        await user.notifications.notify({
            title: 'Good morning',
            text: `You have ${open.length} open tasks today.${skipped}`,
            target: '/tasks',
            group: 'morning-summary',
        });
    }

    await user.kv.set(sentKey, true, Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60);
}
```

The run's `event.scheduledFor` is the time it was due, in milliseconds since
the epoch. A run usually starts within a minute of it.

## Let the User Change the Time

A schedule can't be edited. To move the summary to another time or time zone,
remove the schedule and create a new one:

```js
async function changeSummaryTime (hour, timeZone) {
    const existing = await findSchedule();
    if (existing) await puter.events.removeSchedule(existing.scheduleId);

    options.cron = `0 ${hour} * * 1-5`;
    options.tz = timeZone;
    await puter.events.onSchedule(options);
}
```

To turn the summary off, call
[`puter.events.removeSchedule()`](/Events/removeSchedule/) with the
`scheduleId` from `findSchedule()`.

## Check on Schedules

A suspended schedule still exists, and
[`listSchedules()`](/Events/listSchedules/) shows why it's paused in
`suspendedReason`:

| `suspendedReason` | What happened | What to do |
| --- | --- | --- |
| `handler_not_found` | The handler was removed. | Publish it again. The schedule resumes. |
| `failures` | Five runs in a row failed. | Fix the handler and publish it again. The schedule resumes. |
| `no_credit` | The user ran out of credit. | Nothing. It resumes when they add credit. |

Each run is billed to the user under the [User-Pays Model](/user-pays-model/),
as one event delivery plus the handler's worker usage. See
[Rate Limits and Quotas](/rate-limits-and-quotas/#schedules) for how many
schedules a user can have, and how often they can run.

## Full Code

The recipe has two programs. The publish script runs as the app's developer,
from a deploy script or your browser console:

```js
const app = await puter.apps.get('task-list');    // your app's name

async function sendSummary ({ event, user }) {
    const sentKey = `summary-sent:${event.id}`;
    if (await user.kv.get(sentKey)) return;

    const tasks = (await user.kv.get('tasks')) ?? [];
    const open = tasks.filter((task) => !task.done);
    const skipped = event.missed > 0 ? ` ${event.missed} earlier summaries were skipped.` : '';
    if (open.length > 0) {
        await user.notifications.notify({
            title: 'Good morning',
            text: `You have ${open.length} open tasks today.${skipped}`,
            target: '/tasks',
            group: 'morning-summary',
        });
    }

    await user.kv.set(sentKey, true, Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60);
}

await puter.events.handlers.list({ appUid: app.uid });
await puter.events.handlers.publish('sendSummary', sendSummary, { appUid: app.uid });
```

The [`handlers.list()`](/Events/handlers/) call before publishing lets a deploy
script publish changed code. Without it, publishing a changed handler fails
with `events_handler_conflict`.

The app code runs in your app, signed in as the user:

```js
const options = {
    cron: '0 8 * * 1-5',
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    handlerName: 'sendSummary',
};

async function findSchedule () {
    let cursor = null;
    do {
        const page = await puter.events.listSchedules({ cursor });
        const found = page.items.find((schedule) =>
            schedule.handlerName === options.handlerName && schedule.state !== 'ended');
        if (found) return found;
        cursor = page.cursor ?? null;
    } while (cursor);
    return null;
}

async function startMorningSummary () {
    if (await findSchedule()) return;
    await puter.events.onSchedule(options);
}

async function changeSummaryTime (hour, timeZone) {
    const existing = await findSchedule();
    if (existing) await puter.events.removeSchedule(existing.scheduleId);

    options.cron = `0 ${hour} * * 1-5`;
    options.tz = timeZone;
    await puter.events.onSchedule(options);
}

const allowed = await puter.perms.request('backgroundEvents');
if (allowed) await startMorningSummary();
```
