---
title: Keep Running in the Background
description: "Learn how to ask for background permission with Puter.js, so your app keeps reacting to changes after the user closes it."
tags: [perms, events, auth]
order: 17
---

<div class="info">The Events API is in beta. Event shapes, limits, and behavior may change between releases.</div>

A subscription made with [`puter.events.onLocal()`](/Events/onLocal/) ends when
the page does. That's fine while the user is looking at your app, but some
features need to keep going after they close the tab — tagging a file the moment
it's saved, or sending something on when a folder changes.

Puter can keep watching for you, but running your code while the user isn't
there needs their permission first. This recipe sets that up.

## Ask for background permission

Background delivery has its own per-app permission, `events:background`. Ask for
it with [`puter.perms.request()`](/Perms/request/), the same way you'd ask for a
folder or the user's email:

```js
await puter.perms.request(['events:background']);
```

Check first with [`puter.perms.check()`](/Perms/check/) so you only prompt the
user when you actually need to:

```js
if (!await puter.perms.check('events:background')) {
    await puter.perms.request(['events:background']);
}
```

Without it, subscribing in the background fails with
`events_background_consent_required`.

## Publish the code that runs

A background subscription doesn't run a function from your page — your page is
gone. It runs a **handler** you published ahead of time, under a name:

```js
await puter.events.handlers.publish('tagUpload', async ({ event, ctx }) => {
    await user.fs.write(`${ctx.logDir}/${event.uid}.json`, JSON.stringify({
        path: event.path,
        at: event.ts,
    }));
});
```

Two things are different from an ordinary callback:

**It can't use variables from around it.** The handler is turned into text and
run somewhere else later, so nothing surrounding it comes along. Everything it
uses has to be a parameter, something it declares itself, a standard global, or
reached through `ctx`. Pass values in with `context` when you subscribe. The SDK
checks this before sending and rejects with `events_handler_free_variable`,
naming the identifier it couldn't resolve.

**`puter` isn't available.** Use the `user` binding instead, which has the same
access your app has for that user in a tab.

## Subscribe

Now bind a subscription to the handler by name with
[`puter.events.onPersistent()`](/Events/onPersistent/):

```js
await puter.events.onPersistent({
    subject: 'fs:~/Documents/uploads',
    handlerName: 'tagUpload',
    context: { logDir: '~/AppData/uploads-log' },
});
```

The subject grammar is the same one
[`onLocal()`](/Events/onLocal/#subjects) uses. `context` is the frozen `ctx` the
handler receives — up to 4 KB once serialized, so pass ids and paths rather than
data.

This subscription is stored on the account. It keeps matching while your app is
closed, and it survives the user signing out and back in.

## Handle the permission being taken away

The user can withdraw `events:background` wherever they manage your app's
access. When they do, every background subscription your app holds for them is
suspended with `permission_revoked`.

Granting it again does **not** resume them. You have to subscribe again.

A suspended subscription is still *listed*, so "do I already have one?" isn't
enough to go on — check that the one you find is still running:

```js
async function ensureWatching() {
    if (!await puter.perms.check('events:background')) return false;

    const subs = await puter.events.list();
    const mine = subs.find(s => s.handlerName === 'tagUpload');

    if (mine && !mine.suspendedAt) return true;
    if (mine) await mine.off();          // suspended, and it won't come back

    await puter.events.onPersistent({
        subject: 'fs:~/Documents/uploads',
        handlerName: 'tagUpload',
        context: { logDir: '~/AppData/uploads-log' },
    });
    return true;
}
```

Call this when your app starts. It costs one listing when nothing has changed,
and it recovers from a revoke-and-grant without the user doing anything else.

`suspendedReason` tells you why, if you want to say something different for each:
`permission_revoked` is this case, `handler_not_found` means the handler was
removed, and `failures` means it errored too many times.

## Notes

- A subscription that only needs deliveries while your app is open needs no
  consent at all. Pass `targets: ['socket']`, or just use
  [`onLocal()`](/Events/onLocal/).
- Publishing the same handler source again does nothing. Publishing different
  source updates it, and `publish()` tells you which happened in `outcome`.
- Background handlers run as a worker session for your app, which the user sees
  in their sessions list. Revoking that session, uninstalling the app or
  deleting it all stop background deliveries.
- To ask for `events:background` alongside other permissions in one prompt, see
  [Ask for Access to Multiple Resources](/recipes/ask-for-access-to-multiple-resources/).
