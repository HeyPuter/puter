---
title: Watch for Changes
description: "Learn how to update your app's screen with Puter.js when the user's data changes in another tab, on another device, or in another app."
tags: [events, kv, fs]
order: 65
---

<div class="info">The Events API is in beta. Event shapes, limits, and behavior may change between releases.</div>

The [Events API](/Events/) tells your app when the user's key-value data or
files change, so it can show the new data. It works with the data from
[Store Data](/recipes/store-data/) and [Store Files](/recipes/store-files/).

The handler runs for every change, including the ones your own code makes. So
you can write data anywhere in your code and update the screen in one place,
the handler. It also runs for changes made somewhere else:

- The user has your app open in another tab, or on another device.
- A worker or another app writes to the same keys or folder.
- The user adds files to the folder from the Puter desktop.
- Another person writes to a folder shared with the user.

To subscribe, use the [`puter.events.onLocal()`](/Events/onLocal/) method. The
subscription lasts until you end it or the user closes the tab, which is what a
page that only updates what it shows needs. To run code while your app is
closed, see [Run Code in the Background](/recipes/run-code-in-the-background/).
To keep one open file in sync, see
[Keep an Open File in Sync](/recipes/keep-an-open-file-in-sync/).

## Watch a Key

To re-render when a key changes, subscribe to `kv:<key>`. In the handler, read
the key again with [`puter.kv.get()`](/KV/get/) and show it:

```js
async function showSettings () {
    const settings = await puter.kv.get('settings') ?? { theme: 'light' };
    applySettings(settings);
}

const sub = await puter.events.onLocal('kv:settings', showSettings);
await showSettings();
```

Subscribe first, then do the first read. The
[`onLocal()`](/Events/onLocal/) promise resolves once the subscription is in
place, so a change made during the first read still reaches the handler.

A key that expires on its own sends no event. Neither does
[`puter.kv.flush()`](/KV/flush/).

On a website, the user has to be signed in. If nobody is,
[`onLocal()`](/Events/onLocal/) opens the Puter sign-in window, and rejects
with `auth_canceled` if the user closes it.

## Get the New Value With the Event

To skip the read in the handler, pass `includeValue: true`. Each event then
has the key's new value in `event.value`, or `null` when the key was deleted:

```js
const sub = await puter.events.onLocal('kv:settings', async ({ event }) => {
    const settings = 'value' in event ? event.value : await puter.kv.get('settings');
    applySettings(settings ?? { theme: 'light' });
}, { includeValue: true });
```

The value is sometimes left out, for example on a [gap](#handle-gaps), so keep
the fallback to [`puter.kv.get()`](/KV/get/). Every case is listed under
[Getting the new value](/Events/subjects/#getting-the-new-value). The
`includeValue` option works on `kv:` subjects only.

## Watch Several Keys

A `kv:` subject matches one exact key. To watch every key that starts with the
same text, end the subject with `*`:

```js
await puter.events.onLocal('kv:draft*', handler);                   // draft, drafts, draft-2, ...
await puter.events.onLocal(`kv:${puter.appID}:cart:*`, handler);   // cart:apple, cart:pear, ...
```

If the keys contain `:`, start the subject with your [app ID](/Utils/appID/),
as in the second line. Without it, `kv:cart:*` is read as the keys of an app
called `cart`, and the subscription is refused.

On a website, [`puter.appID`](/Utils/appID/) is only known after sign-in, so
sign the user in before you subscribe. The
[`puter.auth.signIn()`](/Auth/signIn/) method opens a popup, so call it from a
click. An app running on Puter is always signed in.

Use one subscription for the whole group, since a tab can hold only a limited
number of subscriptions. See
[Rate Limits and Quotas](/rate-limits-and-quotas/#events) for the numbers. The
event's `key` field tells you which key changed:

```js
const sub = await puter.events.onLocal(`kv:${puter.appID}:cart:*`, async ({ event }) => {
    if (event.op === 'gap') return showCart();
    const item = 'value' in event ? event.value : await puter.kv.get(event.key);
    showCartItem(event.key, item);
}, { includeValue: true });

await showCart();
```

Here `showCart()` loads the whole cart with
[`puter.kv.list('cart:*', true)`](/KV/list/). The `showCartItem()` function
updates one row, or removes it when `item` is empty.

## Watch a Folder

To refresh a file list, subscribe to `fs:<path>`. In the handler, read the
folder again with [`puter.fs.readdir()`](/FS/readdir/). A folder subscription
covers everything inside it, at any depth:

```js
async function showFiles () {
    renderFileList(await puter.fs.readdir('uploads'));
}

let queued;
const sub = await puter.events.onLocal('fs:uploads', () => {
    queued ??= setTimeout(() => {
        queued = undefined;
        showFiles();
    }, 500);
});
await showFiles();
```

A relative path in a subject works the same way as in [`puter.fs`](/FS/), so
`fs:uploads` is the `uploads` folder inside your app's folder.

Each file gets its own event, so uploading 50 files sends 50 events. The
handler above turns them into one read every half second.

The folder doesn't have to exist yet. The subscription starts delivering events
when the folder is created. Until then [`readdir()`](/FS/readdir/) fails. To
show an empty list instead, create the folder first with
[`puter.fs.mkdir('uploads', { createMissingParents: true })`](/FS/mkdir/).

To watch a folder outside your app's own, such as the user's Documents, ask the
user for access first. [Ask for Access](/recipes/ask-for-access/) shows how.

## Narrow What You Watch

When the view shows only part of a folder, say so in the subject. A `*` matches
within one folder level. A `**` matches across levels. A suffix limits the
subscription to one kind of change:

```js
await puter.events.onLocal('fs:uploads/*.json', handler);       // JSON files directly in uploads
await puter.events.onLocal('fs:uploads/*.json:add', handler);   // only new ones
await puter.events.onLocal('fs:uploads/**/*.png', handler);     // PNGs at any depth
```

The suffix is one of `add`, `write`, `move` or `remove`, and works on `fs:`
subjects only. Events the subject filters out are never sent.

## Handle Gaps

Sometimes an event can't be delivered. The handler then gets a gap marker in
its place, with `op: 'gap'` and no key or path. It only tells you that
something changed, so read everything the view shows again:

```js
const sub = await puter.events.onLocal('fs:inbox/*.json:add', ({ event }) => {
    if (event.op === 'gap') return showInbox();
    addInboxRow(event.path);
});
```

The handlers in [Watch a Key](#watch-a-key) and [Watch a Folder](#watch-a-folder)
read everything again on every event, so they need no extra code for gaps.

Several quick writes to the same key or file can arrive as one event with the
latest state, so one event can stand for more than one change.

## Stop Watching

To stop, call [`off()`](/Events/off/) on the subscription when the view that
uses it goes away, for example when the user closes a panel or opens a
different folder. Closing the tab ends every subscription on its own.

```js
let sub;

async function openFolder (dir) {
    await sub?.off();
    sub = await puter.events.onLocal(`fs:${dir}`, () => showFolder(dir));
    await showFolder(dir);
}
```

Subscribe once when a view opens, and call [`off()`](/Events/off/) when it
closes. Subscribing on every render can hit the
[subscribe rate limit](/rate-limits-and-quotas/#events).

## When the Connection Drops

All the subscriptions in one tab share one connection. The connection can drop,
for example when a laptop goes to sleep or the network changes. The SDK then
reconnects and subscribes again by itself.

Changes made while the connection was down are not sent later. Instead, each
subscription's handler gets one [gap](#handle-gaps) with `reason: 'reconnect'`,
so handlers that read everything again on a gap catch up with no extra code.

The SDK can fail to restore a subscription, for example after the user signs
out. The subscription then ends and `onError` is called. The same happens, with
the code `subscription_ended`, when the file or folder you subscribed to is
deleted, if it existed when you subscribed. Nothing arrives after that, so tell
the user the view has stopped updating:

```js
const sub = await puter.events.onLocal('kv:settings', showSettings, {
    onError: (error) => showBanner(`Live updates stopped (${error.code})`),
});
```

Without `onError` the error is only logged to the console, and your app stops
updating without any sign.
