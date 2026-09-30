---
title: Watch for Changes
description: "Learn how to keep your app's UI in sync with Puter.js events, so it updates when the user's data changes in another tab or on another device."
tags: [events, kv, fs]
order: 65
---

<div class="info">The Events API is in beta. Event shapes, limits, and behavior may change between releases.</div>

The [Events API](/Events/) tells your app when the user's data changes. Use it
to keep what is on screen up to date while the page is open: apply settings the
user saved in another tab, update a cart they edited on their phone, or refresh
a file list when files land in a folder. It works with the key-value data and
files from [Store Data](/recipes/store-data/) and
[Store Files](/recipes/store-files/).

You subscribe with [`puter.events.onLocal()`](/Events/onLocal/). The
subscription lasts until you end it or the page closes.

## Watch a Key

To re-render when a key changes, subscribe to `kv:<key>`. The handler runs when
the key changes, whether the change came from this tab, another tab, or another
device. Read the key again with [`puter.kv.get()`](/KV/get/) and show it:

```js
async function showSettings () {
    const settings = await puter.kv.get('settings') ?? { theme: 'light' };
    applySettings(settings);
}

const sub = await puter.events.onLocal('kv:settings', showSettings);
await showSettings();
```

Subscribe first, then do the first read. `onLocal()` resolves once the
subscription is in place, so a change made while that read is running still
reaches the handler. If you read first, a change made before the subscription
is ready stays off screen until the key changes again.

A handler that reads the key again on every event stays correct in every case
on this page, including deletes, merged writes, [gaps](#handle-gaps) and
reconnects.

On a website, `onLocal()` asks the user to sign in if nobody is, the same way
[`puter.kv.get()`](/KV/get/) does, and rejects with `auth_canceled` if they
close the sign-in. Subjects built from `puter.appID`, like several below, need
the user signed in first, because `puter.appID` is only known after sign-in.
[`puter.auth.signIn()`](/Auth/signIn/) opens a popup, so call it from a click:

```js
if (puter.auth.isSignedIn()) {
    await startWatching();
} else {
    signInButton.addEventListener('click', async () => {
        await puter.auth.signIn();
        await startWatching();
    });
}
```

Here `startWatching()` runs the subscriptions from the sections below. An app
running on Puter is always signed in, so it can call it directly.

## Get the New Value With the Event

To skip the read in the handler, pass `includeValue: true`. Each event then
carries the key's new value as `event.value`, or `null` when the key was
deleted:

```js
const sub = await puter.events.onLocal('kv:settings', async ({ event }) => {
    const settings = 'value' in event ? event.value : await puter.kv.get('settings');
    applySettings(settings ?? { theme: 'light' });
}, { includeValue: true });
```

The value is sometimes left out even when you ask for it, so keep the fallback
to [`puter.kv.get()`](/KV/get/). It is left out when:

- the value is over 16 KB as JSON,
- more than 128 subscriptions match the same change, or there are too many subscriptions to check for it,
- only the key's lifetime changed (`op: 'expire'`), or
- the event is a [gap](#handle-gaps).

`includeValue` works on `kv:` subjects only.

## Watch Several Keys

A `kv:` subject matches one exact key. This is the opposite of
[`puter.kv.list()`](/KV/list/), which always matches a prefix. To watch every
key that starts with the same text, end the subject with `*`:

```js
await puter.events.onLocal('kv:draft*', handler);                   // draft, drafts, draft-2, ...
await puter.events.onLocal(`kv:${puter.appID}:cart:*`, handler);   // cart:apple, cart:pear, ...
```

When the keys contain `:`, put your [app ID](/Utils/appID/) right after `kv:`.
The part after `kv:` is read as an app ID whenever more `:` segments follow it,
so `kv:cart:*` names an app called `cart` and is refused.

Use one subscription for the whole group rather than one per key. A page can
hold 50 subscriptions at a time, and `event.key` already tells you which key
changed:

```js
const sub = await puter.events.onLocal(`kv:${puter.appID}:cart:*`, async ({ event }) => {
    if (event.op === 'gap') return showCart();
    const item = 'value' in event ? event.value : await puter.kv.get(event.key);
    showCartItem(event.key, item);
}, { includeValue: true });

await showCart();
```

Here `showCart()` loads the whole cart with `puter.kv.list('cart:*', true)`,
and `showCartItem()` updates one row, or removes it when `item` is empty.

## Watch a Folder

To refresh a file list, subscribe to `fs:<path>` and read the folder again with
[`puter.fs.readdir()`](/FS/readdir/). A folder subscription covers everything
inside it, at any depth:

```js
const dir = `~/AppData/${puter.appID}/uploads`;

async function showFiles () {
    renderFileList(await puter.fs.readdir(dir));
}

let queued;
const sub = await puter.events.onLocal(`fs:${dir}`, () => {
    queued ??= setTimeout(() => {
        queued = undefined;
        showFiles();
    }, 500);
});
await showFiles();
```

Quick writes to one file arrive as one event, but each file gets its own, so
uploading 50 files sends 50 events. The handler above turns them into one read
every half second. That keeps a bulk upload well inside the `readdir` limit of
60 calls per 10 seconds on the free plan.

The path in an `fs:` subject has to start with `/` or `~`. Other `puter.fs`
methods resolve a relative path such as `'uploads'` inside your app's folder,
`~/AppData/<app ID>/`, but a subject does not, so write the full path.

The folder doesn't have to exist yet. A subject naming a missing folder covers
the folder and everything added to it later, the same as one naming a folder
that exists. `readdir()` fails until the folder is there, so create it first
with `puter.fs.mkdir(dir, { createMissingParents: true })` if you'd rather show
an empty list.

## Narrow What You Watch

When the view shows only part of a folder, say so in the subject. `*` matches
within one folder level, `**` matches across levels, and a suffix limits the
subscription to one kind of change:

```js
await puter.events.onLocal(`fs:${dir}/*.json`, handler);       // JSON files directly in dir
await puter.events.onLocal(`fs:${dir}/*.json:add`, handler);   // only new ones
await puter.events.onLocal(`fs:${dir}/**/*.png`, handler);     // PNGs at any depth
```

Events the subject filters out are never sent. They cost nothing and do not
count toward the subscription's delivery rate. The suffix is one of `add`,
`write`, `move` or `remove`, and it works on `fs:` subjects only.

## Handle Gaps

When a limit stops an event from reaching you, the handler gets a gap marker in
its place. It has `op: 'gap'` and no key or path, so all it tells you is that
something changed. Read everything the view shows again:

```js
const inbox = `~/AppData/${puter.appID}/inbox`;

const sub = await puter.events.onLocal(`fs:${inbox}/*.json:add`, ({ event }) => {
    if (event.op === 'gap') return showInbox();
    addInboxRow(event.path);
});
```

A subscription gets a gap when events for it arrive faster than 600 a minute, or
when one change has more subscriptions to check or deliver to than it is
allowed, or once after the connection drops and comes back (see
[When the Connection Drops](#when-the-connection-drops)).
[Rate Limits and Quotas](/rate-limits-and-quotas/#events) has the numbers. A
handler that reads everything again on every event, like the ones in
[Watch a Key](#watch-a-key) and [Watch a Folder](#watch-a-folder), needs no
extra code.

Several quick writes to the same key or file can also arrive as one event that
carries the latest state. Treat an event as "this changed", never as a count of
changes.

## Stop Watching

To stop, call [`off()`](/Events/off/) on the subscription when the view that
uses it goes away, such as when the user closes a panel or opens a different
folder. Closing the page ends every subscription on its own.

```js
let sub;

async function openFolder (dir) {
    await sub?.off();
    sub = await puter.events.onLocal(`fs:${dir}`, () => showFolder(dir));
    await showFolder(dir);
}
```

Subscribe once when a view opens, not on every render. Every `onLocal()`
counts toward 60 subscribes a minute for the user, shared by all apps
(re-subscribing after a reconnect counts too), and `onLocal()` rejects with
`too_many_requests` past that. `off()` has its own, separate limit of 600 a
minute.

## When the Connection Drops

All of a page's subscriptions share one connection. When it drops, for example
when a laptop goes to sleep or the network changes, the SDK reconnects and
subscribes again by itself. Changes made while it was down are not sent
afterwards. Instead, once a subscription is back, its handler gets one
[gap](#handle-gaps) with `reason: 'reconnect'`. The handlers above already read
everything again on a gap, so they catch up with no extra code.

If the SDK cannot restore a subscription, for example because the user signed
out (`reauth_required`), the subscription ends and `onError` is called. Nothing
arrives after that, so tell the user the view has stopped updating:

```js
const sub = await puter.events.onLocal('kv:settings', showSettings, {
    onError: (error) => showBanner(`Live updates stopped (${error.code})`),
});
```

Without `onError` the error is only logged to the console, and the page stops
updating without any sign.

## Notes

- `event.self` is `true` when the signed-in user made the change, from any tab
  or device. It does not mean this page made it, so don't use it to skip a
  refresh. Changes to your app's own key-value data always have `self: true`.
- Each delivered event costs the user 10 microcents ($0.10 per million) under
  the [User-Pays Model](/user-pays-model/). Subscriptions with nothing
  happening, events your subject filters out, writes merged into one event, and
  gap markers are free. When the user runs out of credit, events stop arriving.
  See [Rate Limits and Quotas](/rate-limits-and-quotas/#events).
- [`puter.kv.flush()`](/KV/flush/) sends no event, and neither does a key that
  expires on its own.
- [`puter.events.fetch()`](/Events/fetch/) cannot catch up on key-value or file
  changes. It only reads notifications, as in [Catch Up on
  Notifications](/recipes/events-catch-up-on-notifications/).
- Watching a folder outside your app's own, such as the user's Documents, needs
  the user's permission first. [Ask for Access](/recipes/perms-ask-for-access/)
  covers it.
- Work that has to happen while the page is closed, such as processing files
  as they arrive, needs a [persistent subscription](/Events/onPersistent/)
  instead.
