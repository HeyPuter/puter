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
[`notify()`](/Notifications/notify/) for the fan. Each fan picks which changes
they want, and the scorekeeper's page never has to reach the fans. When the
person making a change should decide who hears about it, as in a chat, notify
through the share instead, as
[Notify Chat Members of New Messages](/recipes/notify-chat-members-of-new-messages/)
shows.

This recipe uses the `prefix`, `handle` and `label` from
[Send Live Updates to Other Users](/recipes/send-live-updates-to-other-users/).
Your site also needs to serve `/puter-sw.js`, as
[Reach a User When Your App Is Closed](/recipes/reach-a-user-when-your-app-is-closed/#serve-the-service-worker)
shows.

## Mark the End of the Game

The scorekeeper writes the score as before, and adds `final: true` when the game
ends:

```js
await puter.kv.set(`${prefix}score`, { home: 2, away: 1, final: true });
```

## Publish the Handler

Publish a handler that alerts on the final score, and on every goal for fans
who asked for that, with
[`puter.events.handlers.publish()`](/Events/handlers/). Only the account that
owns the app can publish, so run this once yourself, signed in to your site as
the owner. The browser console is enough:

```js
await puter.events.handlers.publish('alertScore', async ({ event, user, ctx }) => {
    if (event.op !== 'set') return;
    const score = 'value' in event ? event.value : await user.kv.get('score', { handle: ctx.handle });
    if (!score || (!score.final && ctx.alerts !== 'goals')) return;

    await user.notifications.notify({
        title: score.final ? `Final: ${ctx.label}` : ctx.label,
        text: `${score.home} - ${score.away}`,
        channel: 'scores',
        group: `game:${ctx.handle}`,
        target: `/games/${ctx.handle}`,
    });
});
```

Puter runs the handler later, in your app's [events worker](/Events/workers/),
so it can't use variables from around it. Everything it needs comes from
`event`, `user` (the fan), and `ctx`, the values each fan's subscription is
created with. [Run Code in the Background](/recipes/run-code-in-the-background/#publish-the-handler)
explains handlers in more detail.

An event leaves out the score when it reaches many fans, so the handler reads
it through the share then. The `group` makes a new alert for the game replace
the fan's earlier one instead of adding another.

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

While your app is open, an alert reaches this handler in the page, and the page
shows it only when its tab is hidden or its window isn't focused. While your
app is closed, the same handler runs in your service worker to decide what the
push shows.

## Follow a Game

The fan subscribes to the game's `score` key with
[`puter.events.onPersistent()`](/Events/onPersistent/). A persistent
subscription is saved to the fan's account and keeps running after they close
your app. The fan's choice of alerts goes in `context`, which the handler gets
as `ctx`:

```js
const subject = `kv:${handle}:score`;

async function findFollow () {
    const subs = await puter.events.list();
    return subs.find((sub) => sub.subject === subject && sub.handlerName === 'alertScore'
        && sub.suspendedReason !== 'permission_revoked');
}

async function followGame (alerts) {
    if (!await puter.perms.request('backgroundEvents')) return false;

    const context = { alerts, label, handle };
    const existing = await findFollow();
    if (existing) await puter.events.update(existing.subId, { context });
    else await puter.events.onPersistent({ subject, handlerName: 'alertScore', includeValue: true, context });
    return true;
}
```

Running a handler while the fan is away needs their permission, which
[`puter.perms.request()`](/Perms/request/) asks for with the `backgroundEvents`
resource. It doesn't prompt when the fan already allowed it. When the fan
already follows the game, [`puter.events.update()`](/Events/update/) changes
their choice of alerts on the existing subscription, so pressing a button twice
doesn't add a second one.

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
subscription with [`puter.events.unsubscribe()`](/Events/unsubscribe/):

```js
async function unfollowGame () {
    const existing = await findFollow();
    if (existing) await puter.events.unsubscribe(existing.subId);
}
```

When the scorekeeper stops sharing the game, the fan's subscription stops on its
own. It stays in [`puter.events.list()`](/Events/list/) with
`suspendedReason: 'permission_revoked'` until it's deleted 30 days later.

## Full Code

The handler, published once by the app's owner:

```js
await puter.events.handlers.publish('alertScore', async ({ event, user, ctx }) => {
    if (event.op !== 'set') return;
    const score = 'value' in event ? event.value : await user.kv.get('score', { handle: ctx.handle });
    if (!score || (!score.final && ctx.alerts !== 'goals')) return;

    await user.notifications.notify({
        title: score.final ? `Final: ${ctx.label}` : ctx.label,
        text: `${score.home} - ${score.away}`,
        channel: 'scores',
        group: `game:${ctx.handle}`,
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

const subject = `kv:${handle}:score`;

async function findFollow () {
    const subs = await puter.events.list();
    return subs.find((sub) => sub.subject === subject && sub.handlerName === 'alertScore'
        && sub.suspendedReason !== 'permission_revoked');
}

async function followGame (alerts) {
    if (!await puter.perms.request('backgroundEvents')) return false;

    const context = { alerts, label, handle };
    const existing = await findFollow();
    if (existing) await puter.events.update(existing.subId, { context });
    else await puter.events.onPersistent({ subject, handlerName: 'alertScore', includeValue: true, context });
    return true;
}

async function unfollowGame () {
    const existing = await findFollow();
    if (existing) await puter.events.unsubscribe(existing.subId);
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
