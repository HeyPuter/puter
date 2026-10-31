---
title: Alert Users When Shared Data Changes
description: "Learn how to alert people on their phone or computer when something they follow changes, like the final score of a game, even after they close your app."
tags: [notifications, events, kv]
order: 72
---

<div class="info">The Events API and KV sharing are in beta. Method shapes, limits, and behavior may change between releases.</div>

In [Send Live Updates to Other Users](/recipes/send-live-updates-to-other-users/),
a scorekeeper shares a game with fans, and each fan sees the score change while
their page is open. Most fans won't keep the page open for a whole game. They
want an alert when the game ends, or when a team scores.

This recipe adds that. Each fan's app subscribes to the game with a handler that
Puter runs for the fan, even while your app is closed. The handler decides
whether a change is worth an alert, and calls
[`notify()`](/Notifications/notify/) for the fan. The same pattern fits any
shared data with changes worth an alert, such as an order's status, a price, or
a task assigned to someone.

A handler fits here because each fan picks which changes are worth an alert,
and the scorekeeper's page never has to reach the fans. When the person making
a change decides who to alert, a share made with `notify: true` lets their page
notify the other side directly with `to: { handle }`, with no handler. See
[Notify Chat Members of New Messages](/recipes/notify-chat-members-of-new-messages/).

This recipe uses the `prefix`, `handle` and `label` from
[Send Live Updates to Other Users](/recipes/send-live-updates-to-other-users/).
Your site also needs to serve `/puter-sw.js`, as in
[Push notifications for your app](/Notifications/push/#1-serve-the-service-worker).

## Mark the End of the Game

The scorekeeper writes the score as before, and adds `final: true` when the game
ends:

```js
await puter.kv.set(`${prefix}score`, { home: 2, away: 1 });
await puter.kv.set(`${prefix}score`, { home: 2, away: 1, final: true });
```

## Publish the Handler

A handler is a function your app publishes once, under a name, with
[`puter.events.handlers.publish()`](/Events/handlers/). Puter runs it in your
app's [events worker](/Events/workers/), where `user` is the fan the
subscription belongs to. This one alerts on the final score, and on every goal
for fans who asked for that:

```js
await puter.events.handlers.publish('alertScore', async ({ event, user, ctx }) => {
    const score = event.value;
    if (event.op !== 'set' || event.key !== 'score' || !score) return;
    if (!score.final && ctx.alerts !== 'goals') return;

    await user.notifications.notify({
        title: score.final ? `Final: ${ctx.label}` : ctx.label,
        text: `${score.home} - ${score.away}`,
        channel: 'scores',
        target: `/games/${ctx.handle}`,
    });
});
```

Only the account that owns the app can publish, so run this once yourself,
signed in to your site as the owner. The browser console is enough. Publishing
the same source again does nothing.

The handler can't use variables from around it, because Puter runs it later,
somewhere else. Everything it needs comes from `event`, `user`, and `ctx`, the
values each subscription is created with.

## Say What an Alert Shows

On every page load, register a handler for the `scores` channel with
[`puter.notifications.onPush()`](/Notifications/onPush/):

```js
await puter.notifications.onPush('scores', (n) => ({
    title: n.title,
    body: n.text ?? '',
    url: n.target ?? '/',
}));
```

While your app is open, the alert reaches this handler in the page instead of
being pushed. The page shows it only when its tab is hidden or its window isn't
focused. While your app is closed, the same handler runs in your service worker
to decide what the push shows.

## Follow a Game

The fan subscribes to the game's `score` key with
[`puter.events.onPersistent()`](/Events/onPersistent/). A persistent
subscription is stored on the fan's account and keeps running after they close
your app. The fan's choice of alerts goes in `context`, which the handler gets
as `ctx`:

```js
async function followGame (alerts) {
    const subject = `kv:${handle}:score`;
    const subs = await puter.events.list();
    for (const sub of subs) {
        if (sub.subject === subject && sub.handlerName === 'alertScore') {
            await puter.events.unsubscribe(sub.subId);
        }
    }

    const options = {
        subject,
        handlerName: 'alertScore',
        includeValue: true,
        context: { alerts, label, handle },
    };
    try {
        await puter.events.onPersistent(options);
    } catch (error) {
        if (error.code !== 'events_background_consent_required') throw error;
        if (!await puter.perms.request('backgroundEvents')) return false;
        await puter.events.onPersistent(options);
    }
    return true;
}
```

The `context` is saved once, when the subscription is created. To change the
fan's choice, the function removes their old subscription with
[`puter.events.unsubscribe()`](/Events/unsubscribe/) and creates a new one.
Running a handler while the user is away needs the user's consent, which
[`puter.perms.request()`](/Perms/request/) asks for with the `backgroundEvents`
resource.

Give the fan two buttons. Browsers only show their permission prompt from a
click, so each one calls [`puter.notifications.enable()`](/Notifications/enable/)
first:

```js
for (const alerts of ['final', 'goals']) {
    document.getElementById(`alert-${alerts}`).addEventListener('click', async () => {
        const pushes = await puter.notifications.enable();
        const following = await followGame(alerts);
        console.log(pushes && following ? `Alerts on: ${alerts}` : 'Alerts are off');
    });
}
```

## Stop Following

When the game is over, or the fan presses an "Unfollow" button, remove the
subscription:

```js
const subs = await puter.events.list();
for (const sub of subs) {
    if (sub.subject === `kv:${handle}:score` && sub.handlerName === 'alertScore') {
        await puter.events.unsubscribe(sub.subId);
    }
}
```

When the scorekeeper stops sharing the game, the fan's subscription stops on
its own.

## Full Code

The handler, published once by the app's owner:

```js
await puter.events.handlers.publish('alertScore', async ({ event, user, ctx }) => {
    const score = event.value;
    if (event.op !== 'set' || event.key !== 'score' || !score) return;
    if (!score.final && ctx.alerts !== 'goals') return;

    await user.notifications.notify({
        title: score.final ? `Final: ${ctx.label}` : ctx.label,
        text: `${score.home} - ${score.away}`,
        channel: 'scores',
        target: `/games/${ctx.handle}`,
    });
});
```

The fan's page:

```js
await puter.notifications.onPush('scores', (n) => ({
    title: n.title,
    body: n.text ?? '',
    url: n.target ?? '/',
}));

async function followGame (alerts) {
    const subject = `kv:${handle}:score`;
    const subs = await puter.events.list();
    for (const sub of subs) {
        if (sub.subject === subject && sub.handlerName === 'alertScore') {
            await puter.events.unsubscribe(sub.subId);
        }
    }

    const options = {
        subject,
        handlerName: 'alertScore',
        includeValue: true,
        context: { alerts, label, handle },
    };
    try {
        await puter.events.onPersistent(options);
    } catch (error) {
        if (error.code !== 'events_background_consent_required') throw error;
        if (!await puter.perms.request('backgroundEvents')) return false;
        await puter.events.onPersistent(options);
    }
    return true;
}

for (const alerts of ['final', 'goals']) {
    document.getElementById(`alert-${alerts}`).addEventListener('click', async () => {
        const pushes = await puter.notifications.enable();
        const following = await followGame(alerts);
        console.log(pushes && following ? `Alerts on: ${alerts}` : 'Alerts are off');
    });
}
```

The worker, at `/puter-sw.js`:

```js
importScripts('https://js.puter.com/push-sw.js');
```
