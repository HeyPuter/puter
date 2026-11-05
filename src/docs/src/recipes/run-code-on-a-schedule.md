---
title: Run Code on a Schedule
description: "Learn how to run your own code on a schedule with Puter.js, like a cron job, so your app can send each user a morning summary in their own time zone, even while the app is closed."
tags: [events, notifications, kv]
order: 68
---

<div class="info">The Events API is in beta. Event shapes, limits, and behavior may change between releases.</div>

<div class="info">Schedules are available on puter.com. A self-hosted Puter server answers <code>events_disabled</code>.</div>

Some work happens on a clock instead of in response to something the user
did. For example, sending a summary every weekday morning, clearing out old
data every night, or checking a feed every hour. On other platforms you'd use
a cron job or a scheduled cloud function.

In Puter, you write a function and give each user a schedule that runs it.
Puter runs it in an [events worker](/Events/workers/), a serverless function,
at the times the schedule says. You don't need to run a server.

[Run Code in the Background](/recipes/run-code-in-the-background/) runs a
function when a user's files change. This recipe runs one at set times
instead, with [`puter.events.onSchedule()`](/Events/onSchedule/). The examples
build a task list app that sends each user a notification at 8:00 every
weekday morning, in their own time zone, with how many tasks they have open.

## Publish the Handler

The function a schedule runs is called a handler. You can
[pass it inline](#pass-the-handler-inline) to `onSchedule()`, or publish it once
under a name with [`puter.events.handlers.publish()`](/Events/handlers/) and
have every user's schedule bind to that name. Publishing is a developer step,
like a deploy, and it only works for the account that owns the app, so run it
from a deploy script or your browser console. Use it when you want one copy of
the code that you can update for every user at once. This section and the ones
after it use a published handler:

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
[Reach a User When Your App Is Closed](/recipes/reach-a-user-when-your-app-is-closed/) shows how
to set pushes up. The `group` makes each morning's summary replace the one
before it.

## Pass the Handler Inline

Without a deploy step, pass the function as `handler` and leave out
`handlerName`. Puter stores the code in the signed-in user's own
[user scope](/Events/handlers/#user-scope) of your app, and runs it for that
user's schedule only:

```js
await puter.events.onSchedule({
    cron: '0 8 * * 1-5',
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    handler: async ({ user }) => {
        const tasks = (await user.kv.get('tasks')) ?? [];
        const open = tasks.filter((task) => !task.done);
        if (open.length === 0) return;

        await user.notifications.notify({
            title: 'Good morning',
            text: `You have ${open.length} open tasks today.`,
            group: 'morning-summary',
        });
    },
});
```

A schedule keeps running the code it was created with. To change the code,
remove the schedule and create a new one, or publish a named handler into the user scope
with `scope: 'user'` and bind schedules to it with `handlerScope: 'user'`. The
handler counts toward the user's [limits](/rate-limits-and-quotas/#handlers) and
bills to the user like their own workers, and creating the schedule needs credit
on a hosted Puter server.
[Clean Up Background Work](/recipes/clean-up-background-work/#remove-a-user-scope)
covers removing what a user's scope holds.

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

If the user revokes the permission later, every schedule your app holds for
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
so the summary arrives at 8:00 local time all year. The
[`onSchedule()`](/Events/onSchedule/#cron-expressions) page lists the cron
syntax it accepts.

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
  `state: 'ended'`. That includes a schedule that ended because the user
  revoked the permission, so the app creates a new one once it's granted again.
- A suspended schedule has `state: 'suspended'`. It resumes on its own, for
  example when the user adds credit, so the code keeps it.

If two tabs open at the same moment, both might create a schedule. If
[`listSchedules()`](/Events/listSchedules/) finds more than one, keep one and
remove the rest with
[`puter.events.removeSchedule()`](/Events/removeSchedule/).

## Skip Summaries Already Sent

Each run happens at least once. A run that times out, or fails with a network
error, is retried, and a retry can repeat work the first attempt already did.
Every attempt at the same run has the same `event.id`, so the handler saves
it after sending and skips ids it has already sent. The marker key expires
after a week, so old markers are removed from the user's key-value store on
their own:

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

This skips a retry of a run that already finished. It doesn't rule out every
repeat. Two attempts that overlap, such as a run still going past its 30
seconds when its retry starts, can both pass the check, and a run that stops
after sending but before saving the key sends again when it's retried. Here a
repeat carries the same `group`, so it replaces the summary that's showing
instead of adding a second one. For work that must happen exactly once, such as
a payment, make the call itself safe to repeat, for example by passing
`event.id` as the idempotency key of the service you call.

Publish the handler again after the change. The schedules already created use
the new code from their next run.

A deploy script runs in a new process each time, so its SDK hasn't seen what's
published. Call [`handlers.list()`](/Events/handlers/) before publishing changed
code, or [`publish()`](/Events/handlers/) rejects with
`events_handler_conflict`:

```js
await puter.events.handlers.list({ appUid: app.uid });
await puter.events.handlers.publish('sendSummary', sendSummary, { appUid: app.uid });
```

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

To move the summary to another time or time zone, change the schedule with
[`puter.events.updateSchedule()`](/Events/updateSchedule/). It keeps its id and
handler. New timing replaces the old timing as a whole, so pass `cron` and `tz`
together:

```js
async function changeSummaryTime (hour, timeZone) {
    options.cron = `0 ${hour} * * 1-5`;
    options.tz = timeZone;

    const existing = await findSchedule();
    if (existing) {
        await puter.events.updateSchedule(existing.scheduleId, { cron: options.cron, tz: options.tz });
    } else {
        await puter.events.onSchedule(options);
    }
}
```

Without a schedule, as after the user turned the summary off, it creates one.
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
    options.cron = `0 ${hour} * * 1-5`;
    options.tz = timeZone;

    const existing = await findSchedule();
    if (existing) {
        await puter.events.updateSchedule(existing.scheduleId, { cron: options.cron, tz: options.tz });
    } else {
        await puter.events.onSchedule(options);
    }
}

const allowed = await puter.perms.request('backgroundEvents');
if (allowed) await startMorningSummary();
```
