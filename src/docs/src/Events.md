---
title: Events
description: Watch a user's files, key-value data and notifications, and react to changes as they happen.
platforms: [websites, apps, nodejs, workers]
---

<div class="info">The Events API is in beta. Event shapes, limits, and behavior may change between releases.</div>

The Events API tells your app when a user's data changes. Subscribe to a file, a folder, a path that doesn't exist yet, a key in your app's key-value store, key-value data another user shared with you, or the user's notifications, and your handler runs each time it changes. You don't poll and you don't run a server.

There are two kinds of subscription:

- **Session subscriptions** ([`onLocal()`](/Events/onLocal/)) belong to the open page and end when it closes. Use them to keep a UI in sync.
- **Persistent subscriptions** ([`onPersistent()`](/Events/onPersistent/)) are stored on the account and keep running while your app is closed. Each change runs a [handler](/Events/handlers/), either inline code you pass in the call or one your app published. Use them for background work, such as processing uploads as they arrive.

What you watch is written as a subject string:

| Subject | Watches |
| --- | --- |
| `fs:~/Documents` | Everything under a folder, or one file by path or uid |
| `fs:~/inbox/*.json:add` | Matching paths, one kind of change |
| `kv:cart` | One key in your app's key-value store (`kv:cart*` for every key starting with `cart`) |
| `kv:<handle>:*` | Keys another user [shared with you](/KV/share/) |
| `notif:app-user` | Your app's notifications for the user |

[Subjects and events](/Events/subjects/) has the full subject syntax and the shape of each event.

To run a handler on a timer instead of when data changes, create a schedule with [`onSchedule()`](/Events/onSchedule/). It runs your handler at an interval, on a cron expression in the user's time zone, or once at a set time, even while your app is closed. Pass the handler inline, and Puter stores it in the signed-in user's own [user scope](/Events/handlers/#user-scope) of your app:

```js
await puter.events.onSchedule({
    cron: '0 9 * * 1-5',
    tz: 'America/New_York',
    handler: async ({ ctx, user }) => {
        await user.notifications.notify({ title: `Good morning, ${ctx.name}` });
    },
    context: { name: 'Ana' },
});
```

To ship one handler to every user, the app's owner can publish it under a name and each schedule or subscription binds to it with `handlerName`.

With the [User-Pays Model](/user-pays-model/), deliveries and schedule runs are billed to the user holding the subscription or schedule, not to you. See [Rate Limits and Quotas](/rate-limits-and-quotas/#events) for limits and costs.

## Features

<div style="overflow:hidden; margin-bottom: 30px;">
    <div class="example-group active" data-section="watch"><span>Watch a Folder</span></div>
    <div class="example-group" data-section="kv"><span>Watch a Key</span></div>
    <div class="example-group" data-section="missing"><span>Wait for a File</span></div>
    <div class="example-group" data-section="persistent"><span>Run in the Background</span></div>
    <div class="example-group" data-section="list"><span>List Subscriptions</span></div>
    <div class="example-group" data-section="fetch"><span>Catch Up</span></div>
</div>

<div class="example-content" data-section="watch" style="display:block;">

#### Print every change under a folder

```html;events-watch-folder
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            // (1) Create a directory to watch
            const dir = puter.randName();
            await puter.fs.mkdir(dir);

            // (2) Subscribe to everything under it
            const sub = await puter.events.onLocal(`fs:${dir}`, ({ event }) => {
                if (event.op === 'gap') {
                    puter.print(`missed some changes (${event.reason})<br>`);
                    return;
                }
                puter.print(`${event.op}: ${event.path}<br>`);
            });

            // (3) Change something, and the handler runs
            await puter.fs.write(`${dir}/hello.txt`, 'Hello!');

            // (4) Stop listening (cleanup)
            setTimeout(() => sub.off(), 2000);
        })();
    </script>
</body>
</html>
```

</div>

<div class="example-content" data-section="kv">

#### Watch a key-value key and a key prefix

```html;events-watch-kv
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            // (1) Exactly one key, and separately every key under a prefix.
            const one = await puter.events.onLocal('kv:cart', ({ event }) =>
                puter.print(`${event.op}: ${event.key}<br>`));
            const many = await puter.events.onLocal(
                `kv:${puter.appID}:cart:*`,
                ({ event }) => puter.print(`under cart: ${event.key}<br>`));

            // (2) `cart` reaches the first, `cart:items` only the second.
            await puter.kv.set('cart', { total: 0 });
            await puter.kv.set('cart:items', ['apple']);

            // (3) Cleanup
            setTimeout(async () => {
                await one.off();
                await many.off();
                await puter.kv.del('cart');
                await puter.kv.del('cart:items');
            }, 2000);
        })();
    </script>
</body>
</html>
```

</div>

<div class="example-content" data-section="missing">

#### React to a file that does not exist yet

```html;events-watch-missing
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            // (1) A directory to work in. `inbox/` below it does not exist yet.
            const dir = puter.randName();
            await puter.fs.mkdir(dir);

            // (2) Subscribe anyway. The subscription anchors on `dir` and
            //     matches the rest of the path as it appears.
            const sub = await puter.events.onLocal(
                `fs:${dir}/inbox/trigger.json:add`,
                ({ event }) => puter.print(`appeared: ${event.path}<br>`),
                { onError: (error) => puter.print(`subscription ended: ${error.code}<br>`) },
            );
            puter.print(`anchored on ${sub.anchor.path}, matching ${sub.match}<br>`);

            // (3) Create it, several directories deep
            await puter.fs.write(`${dir}/inbox/trigger.json`, '{}', {
                createMissingParents: true,
            });

            setTimeout(() => sub.off(), 2000);
        })();
    </script>
</body>
</html>
```

</div>

<div class="example-content" data-section="persistent">

#### Keep watching with a handler after the page closes

The handler goes in with the subscription and runs in the events worker. It's stored in the signed-in user's own [user scope](/Events/handlers/#user-scope) of your app. The playground examples below run this form.

```js
await puter.perms.request('backgroundEvents');
const sub = await puter.events.onPersistent({
    subject: 'fs:inbox',
    handler: async ({ event, ctx }) => {
        await fetch(ctx.endpoint, { method: 'POST', body: event.path });
    },
    context: { endpoint: 'https://example.com/ingest' },
});

// It outlives the page. End it, and remove its handler, when it's no longer needed.
await puter.events.unsubscribe(sub.subId);
await puter.events.handlers.remove(sub.handlerName, { scope: 'user' });
```

To share one handler between all your users, the app's owner publishes it once under a name and each subscription binds to it with `handlerName`. See [`puter.events.handlers`](/Events/handlers/).

</div>

<div class="example-content" data-section="list">

#### List the persistent subscriptions this account holds

```html;events-list
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            const dir = puter.randName();
            await puter.fs.mkdir(dir);
            const sub = await puter.events.onPersistent({
                subject: `fs:${dir}`,
                context: { label: 'inbox' },
            });

            for (const row of await puter.events.list()) {
                puter.print(`${row.subject}: ${row.queue ? 'queue' : 'every listener'}`);
                puter.print(` (context: ${row.contextKeys?.join(', ') ?? 'none'})<br>`);
            }

            await puter.events.unsubscribe(sub.subId);
        })();
    </script>
</body>
</html>
```

</div>

<div class="example-content" data-section="fetch">

#### Read the notifications missed while the app was closed

```html;events-fetch
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            let cursor;
            let seen = 0;
            do {
                const page = await puter.events.fetch({
                    subject: 'notif:app-user',
                    cursor,
                });
                for (const event of page.items) {
                    puter.print(`${event.type}: ${event.notification.title ?? ''}<br>`);
                    seen++;
                }
                cursor = page.cursor;
            } while (cursor);

            if (!seen) puter.print('nothing missed<br>');
        })();
    </script>
</body>
</html>
```

</div>

## Functions

These Events features are supported out of the box when using Puter.js:

- **[`puter.events.onLocal()`](/Events/onLocal/)** - Subscribe for as long as this client is connected
- **[`subscription.off()`](/Events/off/)** - End a session subscription
- **[`puter.events.onPersistent()`](/Events/onPersistent/)** - Subscribe with a subscription that keeps running when your app is closed
- **[`puter.events.list()`](/Events/list/)** - List the persistent subscriptions you hold
- **[`puter.events.update()`](/Events/update/)** - Change a persistent subscription's context without ending it
- **[`puter.events.unsubscribe()`](/Events/unsubscribe/)** - End a persistent subscription
- **[`puter.events.onSchedule()`](/Events/onSchedule/)** - Run a handler at an interval, on a cron expression, or once at a set time
- **[`puter.events.listSchedules()`](/Events/listSchedules/)** - List the schedules you hold
- **[`puter.events.getSchedule()`](/Events/getSchedule/)** - Read one schedule
- **[`puter.events.updateSchedule()`](/Events/updateSchedule/)** - Move a schedule or change its context, or edit a stored notification
- **[`puter.events.removeSchedule()`](/Events/removeSchedule/)** - End a schedule
- **[`puter.events.fetch()`](/Events/fetch/)** - Read the notifications you missed while nothing was listening
- **[`puter.events.handlers`](/Events/handlers/)** - Publish, list and remove the named handlers persistent subscriptions and schedules run, for the app or for one user
- **[`puter.events.workers`](/Events/workers/)** - List and destroy an app's events worker, or a user's own
- **[Subjects and events](/Events/subjects/)** - The subject syntax and the shape of every event

## Examples

You can see various Puter.js Events features in action from the following examples:

- Session subscriptions
  - [Watch a Folder](/playground/events-watch-folder/)
  - [Watch a Path Before It Exists](/playground/events-watch-missing/)
  - [Watch Key-Value Changes](/playground/events-watch-kv/)
  - [Stop Watching](/playground/events-off/)
- Persistent subscriptions
  - [List Persistent Subscriptions](/playground/events-list/)
  - [Find Suspended Subscriptions](/playground/events-list-suspended/)
  - [Change a Subscription's Context](/playground/events-update/)
  - [End a Persistent Subscription](/playground/events-unsubscribe/)
  - [Run an Inline Handler on a Folder](/playground/events-persistent-inline/)
  - [Queue Events for an Inline Handler](/playground/events-persistent-queue-inline/)
- Schedules
  - [List Schedules](/playground/events-list-schedules/)
  - [Read a Schedule](/playground/events-get-schedule/)
  - [Move a Reminder](/playground/events-update-reminder/)
  - [Move a Schedule to Another Time](/playground/events-update-cron/)
  - [Remove a Schedule](/playground/events-remove-schedule/)
  - [Run Code Once at a Set Time](/playground/events-schedule-inline/)
  - [Run Code on Weekday Mornings](/playground/events-schedule-cron-tz/)
  - [Run Code Every 15 Minutes](/playground/events-schedule-every/)
  - [Share a Handler Across Schedules](/playground/events-handlers-user-scope/)
- Catching up
  - [Catch Up on Notifications](/playground/events-fetch/)
  - [Catch Up, Then Keep Listening](/playground/events-fetch-then-listen/)

## Recipes

- [Watch for Changes](/recipes/watch-for-changes/)
- [Keep an Open File in Sync](/recipes/keep-an-open-file-in-sync/)
- [Run Code in the Background](/recipes/run-code-in-the-background/)
- [Send Live Updates to Other Users](/recipes/send-live-updates-to-other-users/)
- [Catch Up on Notifications](/recipes/catch-up-on-notifications/)
