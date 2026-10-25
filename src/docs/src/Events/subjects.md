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
notif:<audience>
notif:<appId>:<audience>
```

## Files

- **Path**: absolute (`/alice/Documents`), home-relative (`~/Documents`), or relative (`inbox` or `./inbox`). A relative path resolves the same way [`puter.fs`](/FS/) paths do: under your app's `AppData` folder in an app, under home otherwise. A directory covers everything under it, at any depth.
- **Uid**: the `uid` of a file or directory, to follow one node wherever it moves. A relative name shaped like a uid is read as one; write `./<name>` to mean the path.
- **Op**: one of `add`, `write`, `move`, `remove`, `meta`. Leave it off to get all of them. Nothing emits `meta` yet.

```js
await puter.events.onLocal('fs:~/Documents', handler);                  // everything under Documents
await puter.events.onLocal('fs:inbox', handler);                        // inbox in your app's folder
await puter.events.onLocal('fs:~/Documents/notes.txt:write', handler);  // one file, writes only
await puter.events.onLocal('fs:~/Pictures/*.png', handler);             // wildcard within one segment
await puter.events.onLocal('fs:~/Projects/**/build.log', handler);      // across directories
```

`*` matches within one path segment, `**` crosses directories, and `?` matches one character. A subject may use one `*` per segment and one `**` in total; more is rejected with `invalid_subject_pattern`.

### Watching a path before it exists

A subject can name a path that isn't there. The subscription anchors on the nearest existing directory and matches the rest of the path, so it behaves as if the path already existed: you get the event when it appears and, for a folder, every change inside it afterwards. A pattern still matches only the paths it names.

```js
// Nothing at this path yet. The handler runs when it's created.
await puter.events.onLocal('fs:~/Documents/inbox/trigger.json:add', ({ event }) => {
    process(event.path);
});
```

If the node a subscription is attached to is deleted, a subscription made with a uid, or with a path that existed when you subscribed, ends with `reason: 'anchor_deleted'`. Subscribe again to watch the path once it's back. [`onLocal()`](/Events/onLocal/#subscriptions-the-server-ends) reports this through `onError`, and a persistent subscription reports it with an `app.events.ended` notification you can read with [`fetch()`](/Events/fetch/). One made with a pattern, or with a path that didn't exist yet, moves up to the nearest folder that still exists and that you can read, and keeps watching, so recreating the path resumes delivery. If there's no such folder (for example, the owner of a folder shared with you deleted it), or the pattern would grow past its limits, it ends the same way.

## Notifications

`notif:` watches part of the account's notification mailbox:

- `notif:account`: notifications about the account itself, such as files shared with it. Only a client acting as the account, not as an app, sees them. Apps and websites never do: subscribing from one is refused with `subject_does_not_exist`.
- `notif:app-user`: notifications belonging to the app you're running as.
- `notif:developer`: notifications about an app you own.

The two-segment form is expanded to your app's id for you. Notifications are stored, so you can also read missed ones with [`fetch()`](/Events/fetch/).

## Key-value data

A `kv:` subject watches your app's key-value store:

```js
await puter.events.onLocal('kv:cart', ({ event }) => refresh(event.key));   // exactly the key `cart`
await puter.events.onLocal('kv:cart*', handler);                            // every key starting with `cart`
```

> **Exact by default; add `*` to widen.** `kv:cart` matches only `cart`, and `kv:cart*` matches every key starting with `cart`. This is the opposite of [`puter.kv.list()`](/KV/list/), which always matches a prefix.

Only a trailing `*` is allowed. A `*` anywhere else, or a `?`, is rejected with `invalid_kv_pattern`.

The segment after `kv:` is read as an app id when there are more segments after it, so a key that contains `:` needs the full three-part form:

```js
await puter.events.onLocal('kv:orders:pending', handler);                  // app `orders`, key `pending`
await puter.events.onLocal(`kv:${puter.appID}:orders:pending`, handler);   // your app, key `orders:pending`
```

The returned `anchor` names the app whose store is watched; `subject` stays as you passed it.

### Getting the new value

A delivery names the key, not its value. Pass `includeValue: true` to receive the new value as `event.value` (`null` on a `del`, absent on an `expire`):

```js
await puter.events.onLocal('kv:cart', ({ event }) => render(event.value), { includeValue: true });
```

The value is left out, and you read the key yourself, when:

- it's over **16 KB** serialized, or
- more than **128** subscriptions match the change in that region (including ones that didn't ask for values), or the filter-check limit stops the count early.

### Data from other apps

Watching another app's key-value data takes the same consent as reading it: the app must allow data sharing, and the user must grant your app `app-data:<appId>:kv:read`. Both are checked when you subscribe and on every delivery. Where cross-app watching is off, the subject is refused with `events_cross_app_disabled`.

Entries the other app wrote with `disableSharing` are never delivered. Marking a key private produces no event, so a value you already have for it may be stale.

<a id="sharing-key-value-events-with-another-user"></a>

## Sharing key-value data with another user

`kv:` always means your own data. When another user shares part of theirs with you using [`puter.kv.share()`](/KV/share/), you watch it through the share's **handle**, which goes where an app id would go. For a walkthrough, see [Send Live Updates to Other Users](/recipes/send-live-updates-to-other-users/).

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

- **Every level can watch.** A share has `watch`, `read`, or `write` access, and all three can subscribe. With `watch`, the holder only gets events. With `read`, they can also read the keys with [`puter.kv.get()`](/KV/get/) and [`puter.kv.list()`](/KV/list/), passing the handle, to catch up after a [gap](#gaps) or to read a value an event left out. With `write`, they can also change and delete the keys. [Sharing with other users](/KV/#sharing-with-other-users) covers the levels.
- **The holder learns only the handle.** It doesn't say whose data it is or where it sits. The `subject` and `key` in their deliveries are relative to the handle. `kv:<handle>:messages:*` narrows to part of the shared region.
- **Values.** `includeValue` works through a handle, with the same limits.
- **Private entries stay private.** An entry written with `disableSharing` is never delivered through a handle: no event, key, or value.
- **Keys can't leave the handle.** A handle with no key after it, or a key using `..`, is refused with `invalid_kv_handle_key`.
- **Writes from every side arrive.** A change the owner makes, and a change any holder makes through a `write` share, reach the owner's subscriptions and every holder's. On a holder's own write through the handle, `self` is `true`, so `self && !viaWorker` skips your own changes. See [the event](#the-event).

When a share stops, deliveries through its handle stop, and every persistent subscription on it is suspended with `permission_revoked` and its backlog dropped. If another share to the same holder still covers its keys, live deliveries through the stopped handle can continue for up to 60 seconds. This happens when the owner revokes it with [`puter.kv.unshare()`](/KV/unshare/), when the holder removes their own access the same way, and when the app whose data it is gets deleted. Where `watch` shares are off on the deployment, handle subjects fail with `events_kv_handles_disabled`.

**Apps.** An app can share, list, and unshare its user's data with [`puter.kv.share()`](/KV/share/) and its sibling methods, but only inside its own namespace and with the user's consent. To ask for it, call [`puter.perms.request()`](/Perms/request/) with the `'kvShare'` resource, the prefix the shares will cover, and the highest level they'll have:

```js
await puter.perms.request('kvShare', { prefix: 'workspace:abc:', access: 'watch' });
```

The consent covers that prefix and every key under it, at that level and the levels below it. It must name a prefix. A prefix that covers the whole namespace is rejected with `invalid_argument`. An app that lists shares sees only its own namespace.

| Refused with | When |
| --- | --- |
| `events_kv_handle_not_delegated` | Sharing or revoking outside the consented prefix or level, or after the consent was withdrawn (the share stays in place). |
| `events_kv_handle_outside_namespace` | Sharing outside the app's own namespace. |
| `events_kv_handle_owner_only` | Listing or revoking from an access token the app issued, or revoking a share outside the app's namespace. |
| `forbidden` | Sharing from an access token the app issued. |

An app can also subscribe through a handle, but only when the shared region belongs to that same app. A different app, even for the same user, is refused as if the handle didn't exist.

## Access

Subscribing takes the same access as reading. A subject you can't read and a subject that doesn't exist both fail with `subject_does_not_exist`, so the error doesn't reveal which. Access is checked again on every delivery: when a share is revoked, deliveries stop immediately. The subscription itself stays open, even if the node is later deleted.

## The event

The handler is called with `{ event }`. A filesystem change carries:

| Field | Type | Description |
| --- | --- | --- |
| `id` | String | Unique id for the event. |
| `subject` | String | The node it happened to, as `fs:<uid>:<op>`. Not the subject you subscribed with. |
| `op` | String | `add` (a create, or a copy's destination), `write`, `move` (a move or a rename), or `remove`. |
| `uid` | String | The uid of the node that changed. |
| `path` | String | The path of the node that changed. |
| `from` | String | On a `move`, the path the node left. Only present when the subscription was watching that location. |
| `self` | Boolean | `true` when the account holding the subscription made the change. |
| `viaWorker` | Boolean | `true` when the change came from server-side code running as an account, such as a worker using `me.puter` or an [events handler](/Events/handlers/) running in the events worker. A worker using `user.puter` acts as the user who called it, so its changes are that user's own, with `viaWorker` set to `false`. A handler running in a client writes as that client, also with `viaWorker` set to `false`. Skip your own changes with `self && !viaWorker`, which still lets through the ones a worker made as your account. |
| `ts` | Number | When it happened, in milliseconds since the epoch. |
| `seq` | Number | Position within one dispatch, when a change goes to several subscriptions. |

A key-value change carries `key` instead of `uid` and `path`, and different ops:

| Field | Type | Description |
| --- | --- | --- |
| `id` | String | Unique id for the event. |
| `subject` | String | `kv:<appId>:<key>`, naming the key that changed. Through a share, `kv:<handle>:<key>`. |
| `op` | String | `set` for a write, `del` for a removal, `expire` when only the key's lifetime changed. |
| `key` | String | The key that changed. |
| `value` | Any | The new value (`null` on a `del`). Only with `includeValue`, and only within the [limits above](#getting-the-new-value). Never on an `expire`. |
| `self` | Boolean | As above. |
| `viaWorker` | Boolean | As above. |
| `ts` | Number | As above. |
| `seq` | Number | As above. |

A notification carries the fields listed on [`fetch()`](/Events/fetch/#return-value).

Events never say *who* made a change: on a shared folder, that would tell every subscriber who else has access.

[`puter.kv.flush()`](/KV/flush/) delivers nothing, since the keys a flush can list aren't reliably the keys it removed.

Writes to the same subject within 250 ms arrive as one event carrying the latest state, so a multipart upload or a save loop is one delivery rather than one per write.

### Gaps

Limits never make a subscription fail. Instead they send a **gap marker** in place of what was dropped: an event with `op: 'gap'`, a `reason`, and no `uid` or `path`. Treat it as "re-read what I'm watching", never as "nothing changed". A reconnect sends one too.

| `reason` | Cause |
| --- | --- |
| `matched_subscription_limit` | The event matched more subscriptions than one event may reach. |
| `filter_evaluation_limit` | The event had more subscription filters to check than one event may check. |
| `delivery_rate_limit` | This subscription went over its per-minute delivery rate. |
| `backlog_overflow` | A persistent subscription's undelivered backlog was full, so the oldest deliveries were dropped. |
| `handler_rejected` | A persistent subscription's handler refused the delivery (a `4xx`, or a thrown terminal error). |
| `suspended_backlog_expired` | A persistent subscription stayed [suspended](/Events/onPersistent/#suspended-subscriptions) past the time its backlog is kept. |
| `reconnect` | The connection dropped and came back. Changes made while it was down weren't delivered. Sent once, after the subscription is restored. |

```js
await puter.events.onLocal('fs:~/Documents', async ({ event }) => {
    if (event.op === 'gap') return refreshEverything();
    apply(event);
});
```

See [Rate Limits and Quotas](/rate-limits-and-quotas/#events) for the numbers behind each limit.
