---
title: Catch Up on Notifications
description: "Learn how to show Puter notifications in your app with Puter.js events, including the ones that arrived while your app was closed."
tags: [events]
order: 66
---

<div class="info">The Events API is in beta. Event shapes, limits, and behavior may change between releases.</div>

Puter posts notifications to a user's account when something needs their
attention, for example when a persistent subscription your app made for them
ends, or, for the app's owner, when its worker finishes deploying. With the
[Events API](/Events/) your app can show these as they arrive, and catch up on
the ones that came in while it was closed. Puter creates notifications itself.
An app can't post its own.

This recipe builds on [Watch for Changes](/recipes/events-watch-for-changes/),
which covers what every subscription shares: gaps, stopping, reconnects and
cost. The examples call `showNotification(event)`, your own function that shows
one notification, such as a toast or a row in a panel.

## Show New Notifications

To show notifications as they arrive, subscribe to `notif:app-user` with
[`puter.events.onLocal()`](/Events/onLocal/):

```js
const sub = await puter.events.onLocal('notif:app-user', ({ event }) => {
    if (event.op === 'gap') return;
    showNotification(event);
});
```

A gap carries no notification, so this handler skips it.
[Catch Up, Then Keep Listening](#catch-up-then-keep-listening) handles gaps
properly. The fields to use are:

- `id`: the notification's id. A notification has the same `id` whether it
  arrives live or from `fetch()`, so use it to tell notifications apart.
- `type`: what kind of notification it is, such as `app.events.ended`.
- `notification.title`: the text to show. The other fields in `notification`
  depend on the type.
- `ts`: when it was created, in milliseconds since the epoch.

Don't use `seq` or `ts` to tell notifications apart. `seq` is only a position
within one page or one delivery, two notifications can share a `ts`, and the
same notification's `ts` can differ between its live and fetched copies.

## Which Notifications Your App Sees

A `notif:` subject names one part of the user's notifications:

- `notif:app-user` is about the user's use of your app. Today that is Puter
  telling them that a [persistent subscription](/Events/onPersistent/) your app
  made for them has ended or stopped delivering (`app.events.ended`).
- `notif:developer` is about your app itself, for the account that owns it:
  your app's worker deploys (`app.worker.deployed`, `app.worker.deployFailed`)
  and suspended event handlers (`app.events.suspended`). For any other user,
  `onLocal()` rejects with `subject_does_not_exist` and `fetch()` returns an
  empty page.
- `notif:account` holds account notifications, such as a file shared with the
  user. Apps and websites never see these, and no permission changes that.
  `onLocal()` rejects with `subject_does_not_exist` and `fetch()` returns an
  empty page.

Reading your app's own notifications needs no permission. Puter fills in your
[app ID](/Utils/appID/), so the subject never needs one, and another app's
notifications are never visible to yours.

## Read What You Missed

To read the notifications that arrived while your app was closed, call
[`puter.events.fetch()`](/Events/fetch/). It returns a page of notifications,
oldest first, in the same shape as live ones. Pass each page's `cursor` back as
`after` until a page comes back without one:

```js
let after;
do {
    const page = await puter.events.fetch({ subject: 'notif:app-user', after });
    page.items.forEach(showNotification);
    after = page.cursor;
} while (after);
```

A page holds 50 notifications by default. Pass `limit` for up to 200, and a
larger `limit` is treated as 200. Without `after`, `fetch()` starts from the
oldest notification Puter still keeps. Puter deletes old notifications after a
while, so a user who was away longer than that starts from what is left.

`fetch()` only reads. It doesn't mark anything as read, and it also returns
notifications the user already dismissed, so your app has to remember what it
has shown. The next section does that.

Only `notif:` subjects can be fetched. A `kv:` or `fs:` subject rejects with
`fetch_unsupported_subject`, because nothing stores those changes. Read the
data itself again instead, as in
[Watch for Changes](/recipes/events-watch-for-changes/).

## Catch Up, Then Keep Listening

To show each notification once, across visits, combine the two. Subscribe, then
fetch from where the last visit stopped, and save the cursor with
[`puter.kv`](/KV/) so the next visit starts there:

```js
const subject = 'notif:app-user';
const saved = await puter.kv.get('notifications') ?? {};
let after = saved.after;
const seen = new Set(saved.seen);

function showOnce (event) {
    if (seen.has(event.id)) return;
    seen.add(event.id);
    showNotification(event);
}

async function save () {
    await puter.kv.set('notifications', { after, seen: [...seen].slice(-200) });
}

async function catchUp () {
    let page;
    do {
        page = await puter.events.fetch({ subject, after });
        page.items.forEach(showOnce);
        after = page.cursor ?? after;
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
reaches the handler. If you fetch first, one created between the fetch and the
subscription stays hidden until the next visit. Subscribing first means a
notification can arrive both live and from `fetch()`, and `showOnce()` drops the
second copy by `id`.

The last page has no cursor, so `after` stays on the cursor before it, and the
next visit reads that page again. That is why the ids are saved along with the
cursor. Only the newest ones can come back, so the last 200 are enough.

A [gap](/recipes/events-watch-for-changes/#handle-gaps) means notifications
were not delivered, and one also arrives after a reconnect. Calling
`catchUp()` on a gap reads what was missed, and `showOnce()` skips the rest.

On a first visit there is no saved cursor, so `catchUp()` shows every
notification Puter still keeps.

## Notes

- `fetch()` asks the user to sign in on a website where nobody is, the same
  way `onLocal()` does, and rejects with `auth_canceled` if they close it.
  [Watch for Changes](/recipes/events-watch-for-changes/#watch-a-key) shows
  how to start from a sign-in button.
- Leave `after` undefined when there is no cursor. `fetch()` rejects `null`
  with `invalid_request`.
- `fetch()` allows 120 calls a minute per user and app, and rejects with
  `too_many_requests` past that. Call it on start and on a gap, never on a
  timer. The subscription already tells you when something new arrives. See
  [Rate Limits and Quotas](/rate-limits-and-quotas/#events).
- `fetch()` rejects with `invalid_subject_audience` for an audience other than
  `app-user`, `developer` or `account`, and with `events_disabled` on a server
  where events are off. A server with notification events turned off rejects
  the `onLocal()` subscription with `invalid_subject`, while `fetch()` still
  works.
- A notification subscription counts toward the same subscribe limit and costs
  the same per delivery as any other. [Watch for Changes](/recipes/events-watch-for-changes/#stop-watching)
  covers `off()`, and its [Notes](/recipes/events-watch-for-changes/#notes)
  cover cost.
