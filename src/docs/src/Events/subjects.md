---
title: Subjects and events
description: The subject strings Events subscriptions watch, and the events they deliver.
platforms: [websites, apps, nodejs, workers]
---

<div class="info">The Events API is in beta. Event shapes, limits, and behavior may change between releases.</div>

A subject is the string that says what a subscription watches. [`onLocal()`](/Events/onLocal/) and [`onPersistent()`](/Events/onPersistent/) take the same subjects and deliver the same events.

## Syntax

```
fs:<path or uid>[:<op>]
kv:<key>
kv:<appId>:<key>
kv:<handle>:<key>
notif:<audience>
notif:<appId>:<audience>
```

## Files

- **Path**: absolute (`/alice/Documents`), home-relative (`~/Documents`), or relative (`inbox` or `./inbox`). A relative path resolves the same way [`puter.fs`](/FS/) paths do, under your app's `AppData` folder in an app and under home otherwise. A folder covers everything under it, at any depth.
- **Uid**: the `uid` of a file or folder, to follow one node wherever it moves. A relative name shaped like a uid is read as one. Write `./<name>` to mean the path.
- **Op**: one of `add`, `write`, `move`, `remove`, `meta`. Leave it off to get all of them. No change emits `meta`.

```js
await puter.events.onLocal('fs:~/Documents', handler);                  // everything under Documents
await puter.events.onLocal('fs:inbox', handler);                        // inbox in your app's folder
await puter.events.onLocal('fs:~/Documents/notes.txt:write', handler);  // one file, writes only
await puter.events.onLocal('fs:~/Pictures/*.png', handler);             // wildcard within one segment
await puter.events.onLocal('fs:~/Projects/**/build.log', handler);      // across folders
```

In a pattern, `*` matches within one path segment, `**` crosses folders, and `?` matches one character. A subject can use one `*` per segment and one `**` in total. More is refused with `invalid_subject_pattern`.

### Watching a path before it exists

A subject can name a path that isn't there. The subscription anchors on the nearest existing folder and matches the rest of the path, so it behaves as if the path already existed. You get the event when the path appears and, for a folder, every change inside it afterwards. A pattern still matches only the paths it names.

```js
// Nothing at this path yet. The handler runs when it's created.
await puter.events.onLocal('fs:~/Documents/inbox/trigger.json:add', ({ event }) => {
    process(event.path);
});
```

When the node a subscription is attached to is deleted, what happens depends on how it was made:

- **A uid, or a path that existed when you subscribed.** The subscription gets the final `remove` and then ends with `reason: 'anchor_deleted'`. Subscribe again to watch the path once it's back. [`onLocal()`](/Events/onLocal/#subscriptions-the-server-ends) reports this through `onError`. A persistent subscription is deleted, and its holder gets an `app.events.ended` notification on `notif:app-user`, which you can read with [`fetch()`](/Events/fetch/).
- **A pattern, or a path that didn't exist yet.** The subscription moves up to the nearest folder that still exists and that you can read, and keeps watching, so recreating the path resumes delivery. If there's no such folder (for example, the owner of a folder shared with you deleted it), or the pattern would grow past its limits, it ends the same way.

## Key-value data

A `kv:` subject watches your app's key-value store:

```js
await puter.events.onLocal('kv:cart', ({ event }) => refresh(event.key));   // exactly the key `cart`
await puter.events.onLocal('kv:cart*', handler);                            // every key starting with `cart`
```

> **Exact by default, add `*` to widen.** `kv:cart` matches only `cart`, and `kv:cart*` matches every key starting with `cart`. [`puter.kv.list()`](/KV/list/) works the other way and always matches a prefix.

Only a trailing `*` is allowed. A `*` anywhere else, or a `?`, is refused with `invalid_kv_pattern`.

The segment after `kv:` is read as an app id when more segments follow it, so a key that contains `:` needs the full three-part form:

```js
await puter.events.onLocal('kv:orders:pending', handler);                  // app `orders`, key `pending`
await puter.events.onLocal(`kv:${puter.appID}:orders:pending`, handler);   // your app, key `orders:pending`
```

The returned `anchor` names the app whose store is watched, and `subject` stays as you passed it.

### Getting the new value

A delivery names the key, not its value. Pass `includeValue: true` to get the new value as `event.value`. It's `null` on a `del`, and an `expire` never carries one.

```js
await puter.events.onLocal('kv:cart', ({ event }) => render(event.value), { includeValue: true });
```

The value is left out, and you read the key yourself, when:

- it's over **16 KB** serialized,
- the change already went out with its value to **128** subscriptions in that region (see [how many subscriptions one event reaches](/rate-limits-and-quotas/#how-many-subscriptions-one-event-reaches) for the order they're served in), or
- the subscription is on a [share handle](#sharing-key-value-data-with-another-user) whose share is at `watch`.

### Data from other apps

Watching another app's key-value data takes the same consent as reading it. The app must allow data sharing, and the user must grant your app `app-data:<appId>:kv:read`. Both are checked when you subscribe and on every delivery. Where cross-app watching is off, the subject is refused with `events_cross_app_disabled`.

Entries the other app wrote with `disableSharing` are never delivered. Marking a key private produces no event, so a value you already have for it may be stale.

<a id="sharing-key-value-events-with-another-user"></a>

## Sharing key-value data with another user

<div class="info">KV sharing is in beta. Method shapes, limits, and behavior may change between releases.</div>

A `kv:<key>` subject always means your own data. When another user shares part of theirs with you using [`puter.kv.share()`](/KV/share/), you watch it through the share's **handle**, which goes where an app id would go. For a walkthrough, see [Send Live Updates to Other Users](/recipes/send-live-updates-to-other-users/).

```js
// The owner shares one workspace with another user.
await puter.kv.share(`workspace:${workspaceId}:`, 'bob', 'watch');
```

```js
// Bob finds the share and watches every key written in that workspace.
// `event.key` is relative to the handle: `messages:1`, not `workspace:<id>:messages:1`.
const { items } = await puter.kv.listShared();
const { handle } = items[0];
await puter.events.onLocal(`kv:${handle}:*`, ({ event }) => render(event.key));
```

- **Every level can watch.** A share has `watch`, `read`, or `write` access, and all three can subscribe. Through the handle, a `watch` holder can also list the keys without their values with [`puter.kv.list()`](/KV/list/). A `read` or `write` holder can also read the values with [`puter.kv.get()`](/KV/get/) and [`puter.kv.list()`](/KV/list/), to catch up after a [gap](#gaps) or to read a value an event left out. [`puter.kv.share()`](/KV/share/#parameters) lists what each level allows.
- **Keys are relative to the handle.** The holder learns only the handle, not whose data it is or where it sits. The `subject` and `key` in their deliveries are relative to the handle, and `kv:<handle>:messages:*` narrows to part of the shared data. A subject with no key after the handle, a key starting with `:`, or a key with a `..` segment is refused with `invalid_kv_handle_key`.
- **Values need `read`.** `includeValue` works through a `read` or `write` share, with the same limits as your own data. At `watch`, deliveries leave out the value even when the subscription asked for it. The level is checked on every delivery, so raising a share to `read` starts values on subscriptions already made, and lowering it to `watch` stops them, including for events a [`queue`](/Events/onPersistent/#choosing-a-mode) subscription is still holding.
- **Private entries stay private.** An entry written with `disableSharing` is never delivered through a handle.
- **Writes from every side arrive.** A change the owner makes, and a change any holder makes through a `write` share, reach the owner's subscriptions and every holder's. On a holder's own write through the handle, `self` is `true`, so `self && !viaWorker` skips your own changes. See [the event](#the-event).
- **Apps.** Inside an app, the holder can subscribe through a handle only from the app whose data was shared. Another app, even for the same user, gets `subject_does_not_exist`.

When a share stops, deliveries through its handle stop. Every persistent subscription on it is suspended with `permission_revoked` and its backlog is dropped. Every [`onLocal()`](/Events/onLocal/) subscription on it ends, and its `onError` gets `subscription_ended` with `permission_revoked`. A connection in another region can take up to 20 minutes to be told, and gets no deliveries through the handle in the meantime. If another share to the same holder still covers its keys, live deliveries through the stopped handle can continue for up to 60 seconds.

A share stops when the owner revokes it with [`puter.kv.unshare()`](/KV/unshare/), when the holder removes their own access the same way, when the app whose data it is gets deleted, when the owner removes that app along with its data, and when the holder deletes their account. While a share can't be checked, for example while the owner's account is suspended, deliveries through it pause instead. A `queue` subscription keeps its backlog and gets it once the share can be checked again.

Where share handles are turned off on the server, handle subjects fail with `events_kv_handles_disabled`.

## Notifications

A `notif:` subject watches part of the account's notification mailbox:

- `notif:app-user`: your app's notifications for the user, such as the ones it sends with [`notify()`](/Notifications/notify/).
- `notif:developer`: notifications about an app the user owns, such as a finished worker deploy.
- `notif:account`: notifications about the account itself, such as files shared with it. Only a client acting as the account sees them. Subscribing from an app or a website is refused with `subject_does_not_exist`.

The two-segment form is expanded to your app's id for you. Outside an app, `notif:app-user` and `notif:developer` cover every app. Notifications are stored, so you can also read missed ones with [`fetch()`](/Events/fetch/), which lists the notification types and their fields.

## Access

Subscribing takes the same access as reading. A subject you can't read and a subject that doesn't exist both fail with `subject_does_not_exist`, so the error doesn't reveal which. Access is checked again on every delivery, so a change you can no longer read isn't delivered.

When access is withdrawn, such as a file share revoked or your app uninstalled, a persistent subscription that relied on it is [suspended](/Events/onPersistent/#suspended-subscriptions) with `permission_revoked`, and its holder gets an `app.events.ended` notification. Access withdrawn on a parent folder of what it watches stops its deliveries without suspending it. A session subscription on files stays open and gets nothing until access is back. A session subscription through a key-value share handle [ends](#sharing-key-value-data-with-another-user).

## The event

The handler is called with `{ event }`. A file change carries:

| Field | Type | Description |
| --- | --- | --- |
| `id` | String | Unique id for the event. |
| `subject` | String | The node it happened to, as `fs:<uid>:<op>`. Not the subject you subscribed with. |
| `op` | String | `add` (a create, or a copy's destination), `write`, `move` (a move or a rename), or `remove`. |
| `uid` | String | The uid of the node that changed. |
| `path` | String | The path of the node that changed. In another user's files, it's a [masked path](/FS/listShared/), `/<owner>/<uid>/<name>/…`, where `<uid>` and `<name>` are those of the node the subscription is attached to. |
| `from` | String | On a `move`, the path the node left, masked the same way. Only present when the subscription was watching that location. |
| `self` | Boolean | `true` when the account holding the subscription made the change. Mail filed into the account's `~/.mail` folder is always `false`, including mail the account sent to itself. |
| `viaWorker` | Boolean | `true` when the change came from server-side code running as an account, such as a worker using `me.puter` or an [events handler](/Events/handlers/) running in the events worker. A worker using `user.puter` acts as the user who called it, so its changes are that user's own, with `viaWorker` set to `false`. A handler running in a client writes as that client, also with `viaWorker` set to `false`. To skip your own changes, check `self && !viaWorker`, which still lets through the ones a worker made as your account. |
| `ts` | Number | When it happened, in milliseconds since the epoch. |
| `seq` | Number | Position within one dispatch, when a change goes to several subscriptions. |

A key-value change carries `key` instead of `uid` and `path`, and different ops:

| Field | Type | Description |
| --- | --- | --- |
| `id` | String | Unique id for the event. |
| `subject` | String | `kv:<appId>:<key>`, naming the key that changed. Through a share, `kv:<handle>:<key>`. |
| `op` | String | `set` for a write, `del` for a removal, `expire` when only the key's lifetime changed. |
| `key` | String | The key that changed. Through a share, relative to the handle. |
| `value` | Any | The new value, or `null` on a `del`. Only with `includeValue`, and only within the [limits above](#getting-the-new-value). Never on an `expire`. |
| `self` | Boolean | As above. |
| `viaWorker` | Boolean | As above. |
| `ts` | Number | As above. |
| `seq` | Number | As above. |

A notification carries the fields listed on [`fetch()`](/Events/fetch/#return-value).

Events never say who made a change. On a shared folder, that would tell every subscriber who else has access.

[`puter.kv.flush()`](/KV/flush/) delivers nothing, since the keys a flush can list aren't reliably the keys it removed.

Writes to the same subject within 250 ms arrive as one event carrying the latest state, so a multipart upload or a save loop is one delivery rather than one per write. All of an app's notifications share one subject, so notifications sent within 250 ms of each other arrive as the last of them. [`fetch()`](/Events/fetch/) still returns every one.

### Gaps

Limits never make a subscription fail. Instead, a **gap marker** takes the place of what was dropped. It's an event with `op: 'gap'`, a `reason`, and no `uid`, `path`, or `key`. Treat it as a signal to re-read what you're watching, never as "nothing changed".

| `reason` | Cause |
| --- | --- |
| `matched_subscription_limit` | The event matched more subscriptions than one event may reach. |
| `filter_evaluation_limit` | The event had more subscription filters to check than one event may check. |
| `delivery_rate_limit` | This subscription went over its per-minute delivery rate. |
| `backlog_overflow` | A persistent subscription's undelivered backlog was full, so the oldest deliveries were dropped. |
| `handler_rejected` | A `queue` subscription's handler threw an error that isn't retried. |
| `suspended_backlog_expired` | A persistent subscription stayed [suspended](/Events/onPersistent/#suspended-subscriptions) past the time its backlog is kept. |
| `reconnect` | A session subscription's connection dropped and came back. Changes made while it was down weren't delivered. Sent once, after the subscription is restored. |

```js
await puter.events.onLocal('fs:~/Documents', async ({ event }) => {
    if (event.op === 'gap') return refreshEverything();
    apply(event);
});
```

See [Rate Limits and Quotas](/rate-limits-and-quotas/#events) for the numbers behind each limit.
