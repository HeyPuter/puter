---
title: Catch Up on Notifications
description: "Learn how to show Puter notifications in your app with Puter.js, including the ones that arrived while your app was closed."
tags: [events]
order: 66
---

<div class="info">The Events API is in beta. Event shapes, limits, and behavior may change between releases.</div>

Puter posts notifications to a user's account when something needs their
attention, for example when a persistent subscription your app made for them
ends, or, for the app's owner, when its worker finishes deploying. With the
[Events API](/Events/) your app can show these as they arrive, and catch up on
the ones that came in while it was closed. These are notifications Puter creates.

Your app can also send the user its own notifications with
[`puter.notifications.notify()`](/Notifications/notify/). They arrive on
`notif:app-user` with the type `app.message`. To read only those, use
[`puter.notifications.onNotification()`](/Notifications/onNotification/),
which catches up on its own.

This recipe builds on [Watch for Changes](/recipes/watch-for-changes/), which
covers what every subscription shares: sign-in, gaps, stopping and reconnects.
The examples call
`showNotification(event)`, your own function that shows one notification, such
as a toast or a row in a panel.

## Show New Notifications

To show notifications as they arrive, subscribe to `notif:app-user` with
[`puter.events.onLocal()`](/Events/onLocal/). It only updates the open page, and
the catch-up below covers anything missed while the page was closed:

```js
const sub = await puter.events.onLocal('notif:app-user', ({ event }) => {
    if (event.op === 'gap') return;
    showNotification(event);
});
```

A gap carries no notification, so this handler skips it.
[Catch Up, Then Keep Listening](#catch-up-then-keep-listening) handles gaps
properly. The fields to use are:

- `id`, the notification's id. A notification has the same `id` whether it
  arrives live or from [`fetch()`](/Events/fetch/), so use it to tell
  notifications apart.
- `type`, what kind of notification it is, such as `app.events.ended`.
- `notification.title`, the text to show. The other fields in `notification`
  depend on the type.
- `ts`, when it was created, in milliseconds since the epoch.

Tell notifications apart by `id` only. The `seq` field is only a position within
one page or one delivery, two notifications can share a `ts`, and the same
notification's `ts` can differ between its live and fetched copies.

## Which Notifications Your App Sees

A `notif:` subject names one part of the user's notifications:

- `notif:app-user` is about the user's use of your app, such as a
  [persistent subscription](/Events/onPersistent/) your app made for them
  that has ended or stopped delivering (`app.events.ended`). The notifications
  your app sends with [`notify()`](/Notifications/notify/) (`app.message`) are
  here too.
- `notif:developer` is about your app itself, for the account that owns it,
  such as your app's worker deploys (`app.worker.deployed`,
  `app.worker.deployFailed`) and suspended event handlers
  (`app.events.suspended`). For any other user,
  [`onLocal()`](/Events/onLocal/) rejects with `subject_does_not_exist` and
  [`fetch()`](/Events/fetch/) returns an empty page.

Apps and websites never see `notif:account`, which holds account notifications
such as a file shared with the user. Reading your app's own notifications needs
no permission. Puter fills in your [app ID](/Utils/appID/), so the subject
never needs one, and another app's notifications are never visible to yours.
All the subjects are listed under
[Notifications](/Events/subjects/#notifications).

## Read What You Missed

To read the notifications that arrived while your app was closed, call
[`puter.events.fetch()`](/Events/fetch/). It returns a page of notifications,
oldest first, in the same shape as live ones. Pass each page's `cursor` back as
`cursor` until a page comes back without one:

```js
let cursor;
do {
    const page = await puter.events.fetch({ subject: 'notif:app-user', cursor });
    page.items.forEach(showNotification);
    cursor = page.cursor;
} while (cursor);
```

Without a `cursor`, [`fetch()`](/Events/fetch/) starts from the oldest notification Puter
still keeps. Puter deletes old notifications after a while, so a user who was
away longer than that starts from what is left.

The [`fetch()`](/Events/fetch/) method only reads. It doesn't mark anything as
read, and it also returns notifications the user already dismissed, so your app
has to remember what it has shown. The next section does that.

Call [`fetch()`](/Events/fetch/) on start and on a gap. The subscription tells
you when something new arrives, so there's no need to call it on a timer.

Only `notif:` subjects can be fetched. To catch up on key-value or file
changes, read the data itself again, as in
[Watch for Changes](/recipes/watch-for-changes/).

## Catch Up, Then Keep Listening

To show each notification once, across visits, combine the two. Subscribe, then
fetch from where the last visit stopped, and save the cursor with
[`puter.kv`](/KV/) so the next visit starts there:

```js
const subject = 'notif:app-user';
const saved = await puter.kv.get('notifications') ?? {};
let cursor = saved.cursor;
const seen = new Set(saved.seen);

function showOnce (event) {
    if (seen.has(event.id)) return;
    seen.add(event.id);
    showNotification(event);
}

async function save () {
    await puter.kv.set('notifications', { cursor, seen: [...seen].slice(-200) });
}

async function catchUp () {
    let page;
    do {
        page = await puter.events.fetch({ subject, cursor });
        page.items.forEach(showOnce);
        cursor = page.cursor ?? cursor;
    } while (page.cursor);
    await save();
}

await puter.events.onLocal(subject, async ({ event }) => {
    if (event.op === 'gap') return catchUp();
    showOnce(event);
    await save();
});
await catchUp();
```

Subscribe first, then fetch. A notification created while `catchUp()` runs then
reaches the handler. Because of that, a notification can arrive both live and
from [`fetch()`](/Events/fetch/), and `showOnce()` drops the second copy by
`id`.

The last page has no cursor, so the saved cursor stays on the page before it, and the
next visit reads that page again. That is why the ids are saved along with the
cursor. Only the newest ones can come back, so the last 200 are enough. On a
first visit there is no saved cursor, so `cursor` is `undefined` and
`catchUp()` shows every notification Puter still keeps.

A [gap](/recipes/watch-for-changes/#handle-gaps) means notifications were not
delivered, and one also arrives after a reconnect. Calling `catchUp()` on a gap
reads what was missed, and `showOnce()` skips the rest.
