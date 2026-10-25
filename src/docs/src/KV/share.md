---
title: puter.kv.share()
description: Share the keys under a prefix with another Puter user, so they can watch, read, or change them.
platforms: [websites, apps, nodejs, workers]
---

Shares the keys under a prefix with another Puter user. The other user becomes the share's holder, and you stay its owner. The keys stay in your store, and the holder reaches them through the share.

Each share has a `handle`. The holder finds it with [`puter.kv.listShared()`](/KV/listShared/) and passes it as `handle` to the other [`puter.kv`](/KV/) methods. [Sharing with other users](/KV/#sharing-with-other-users) shows how a holder uses a share.

## Syntax

```js
puter.kv.share(prefix, recipient)
puter.kv.share(prefix, recipient, access)
puter.kv.share(options)
```

## Parameters

#### `prefix` (String) (required)

The key prefix to share, such as `'list:42:'`. The share covers every key that starts with it. The trailing `:` is optional, and the returned `prefix` always ends with one.

A share stays on the prefix it was made for. Build the prefix from an id that never changes, such as `list:<uuid>:`, rather than from a name.

The segments between the `:` separators can use only lowercase letters (`a`-`z`), digits, `_`, `.`, and `-`, as in `list:42:` or `room_1.draft-a:`. A prefix can't be empty or have an empty segment such as `list::42:`. A prefix with other characters, such as `List:42:` or `café:`, or with an empty segment is rejected with `invalid_kv_share_prefix`.

The longest prefix depends on the app's uid and the access level. For an app uid of the usual form, `app-` and a uuid, the prefix without its trailing `:` can be at most 168 characters for `'watch'`, 163 for `'read'`, and 162 for `'write'`. In the store that belongs to no app, it can be at most 199, 194, and 193. A longer prefix is rejected with `invalid_kv_share_prefix`, and the error message gives the limit.

A new share is also rejected with `invalid_kv_share_prefix` when its prefix differs from one of your existing shares with the same user only in letter case.

#### `recipient` (String | Object) (required)

The user to share with, as a username, `{ username }`, or `{ uid }` with the user's uuid. A string that contains `@` is rejected with `invalid_recipient`.

#### `access` (String) (optional)

What the holder can do. Defaults to `'read'`. Each level includes the ones before it.

- `'watch'`: receive [events](/Events/subjects/#sharing-key-value-data-with-another-user) when keys under the prefix change.
- `'read'`: also read keys with [`puter.kv.get()`](/KV/get/) and [`puter.kv.list()`](/KV/list/).
- `'write'`: also change and delete keys with every other [`puter.kv`](/KV/) method, such as [`puter.kv.set()`](/KV/set/), [`puter.kv.incr()`](/KV/incr/) and [`puter.kv.del()`](/KV/del/). Write access includes delete, so a holder can change or remove any key under the prefix.

#### `options` (Object)

The options form takes these properties:

- `prefix` (String) (required): The key prefix, as above.
- `recipient` (String | Object) (required): Who to share with, as above.
- `access` (String): What the holder can do, as above. Defaults to `'read'`.
- `label` (String | null): Plain text the holder is shown with the share, such as `'Groceries from Dan'`. Whitespace at either end is trimmed, and the rest can be at most 128 characters and 512 bytes of UTF-8. Control characters, invisible formatting characters (such as zero-width spaces and text direction marks), line breaks, and more than 3 combining marks on one character are rejected with `kv_share_label_invalid`. An empty string means no label.
- `appUuid` (String): The app whose data to share. Outside an app, such as in a Node.js script using the user's auth token, it can name any app that exists. An app always shares its own data, and passing a different app's id fails with `events_kv_handle_outside_namespace`.

Without an app, [`puter.kv`](/KV/) uses a store that belongs to no app. Shares of that store have an `appUid` of `null`.

## Return value

A `Promise` that resolves to the share:

- `handle` (String): The share's id. The holder passes it as `handle`.
- `prefix` (String): The shared prefix, ending with `:`.
- `access` (String): `'watch'`, `'read'`, or `'write'`.
- `appUid` (String | null): The app whose data is shared, or `null` for the store that belongs to no app.
- `holder` (String): The holder's username.
- `label` (String | null): The label the holder is shown.
- `createdAt` (Number): When the share was made, in Unix seconds.

## Sharing the same prefix again

Sharing the same prefix of the same app's data with the same user again changes the existing share instead of making a second one. The share keeps its `handle` and `createdAt` and gets the new `access`. Use this to raise or lower a holder's access. The holder's subscriptions through the handle keep working.

Leave out `label` to keep the current label, pass a new one to replace it, or pass `null` to clear it.

## What the holder sees

The holder is never told who shared or what the prefix is. The keys they read and write are relative to the prefix. The label is the only thing about the share you choose to tell them.

When the share is of an app's data, the holder gets a `kv.share.received` [notification](/Events/subjects/#notifications) inside that app. It isn't sent when you change an existing share, and isn't sent for shares of the store that belongs to no app. The holder gets at most 5 of these an hour from the same owner. A share past that is still made, without a notification. The live notification needs notifications to be turned on for events on the deployment, so have the holder's app call [`puter.kv.listShared()`](/KV/listShared/) when it opens. See [Sharing with other users](/KV/#sharing-with-other-users).

## Who can share

- **Account.** Where the deployment requires a confirmed email address, an unconfirmed account is rejected with `account_is_not_verified`. Sharing doesn't need a phone number, a card, or a paid plan. A temporary account can't share and gets `events_kv_handle_requires_account`.
- **Apps.** An app can share only its own data, and only with the user's consent, which it asks for with [`puter.perms.request('kvShare', …)`](/Perms/request/). The consent names a prefix and a level. It covers that prefix and every key under it, at that level and the levels below it.
- **Recipient blocks.** A user who blocked you, or who doesn't accept shares from anyone, can't be shared with. The call fails with `recipient_not_accepting_shares`. A block added later doesn't remove an existing share. You can still lower its access, clear its label with `label: null`, or stop it, and raising its access or setting a new label fails with `recipient_not_accepting_shares`.

See [Rate Limits and Quotas](/rate-limits-and-quotas/#events) for how many shares an account can make per minute and hold at once.

## Errors

The promise rejects with `{ message, code }`:

| Code | Meaning |
| -- | -- |
| `invalid_recipient` | `recipient` contains `@`, or isn't a username, `{ username }`, or `{ uid }`. |
| `subject_does_not_exist` | No user has that username or uuid. |
| `bad_request` | You named yourself as the recipient, or `appUuid` isn't the id of an app that exists. |
| `invalid_kv_share_prefix` | `prefix` is empty, too long, has an empty segment, or has a character other than lowercase letters, digits, `_`, `.`, and `-` between its separators, or differs from one of your shares with the same user only in letter case. |
| `kv_share_access_invalid` | `access` isn't `'watch'`, `'read'`, or `'write'`. |
| `kv_share_label_invalid` | `label` isn't a string or `null`, is too long, or contains a character it can't have. |
| `recipient_not_accepting_shares` | The recipient blocked you, or doesn't accept shares. On an existing share, you raised its access or set a new label. |
| `account_is_not_verified` | Your email address isn't confirmed. |
| `events_kv_handle_requires_account` | A temporary account tried to share. |
| `events_kv_handle_limit_reached` | You already hold as many live shares as your plan allows. |
| `events_kv_handle_not_delegated` | An app shared without the user's consent for that prefix and level. |
| `events_kv_handle_outside_namespace` | An app named another app's data. |
| `events_kv_handle_owner_only` | The call came from an access token with less access than the account. |
| `forbidden` | An app shared through an access token it issued. |
| `kv_handles_disabled` | `read` and `write` shares are turned off on this deployment. |
| `events_kv_handles_disabled` | `watch` shares are turned off on this deployment. |
| `events_disabled` | Events, which `watch` shares need, are turned off on this deployment. |
| `too_many_requests` | Over the rate limit, or another change to the same share was still running. Try again. |

## Examples

<strong class="example-title">Share a list with another user</strong>

```js
const prefix = `list:${crypto.randomUUID()}:`;
await puter.kv.set(`${prefix}meta`, { title: 'Groceries' });

const share = await puter.kv.share(prefix, 'alice', 'write');
puter.print(`Shared with ${share.holder} as ${share.access}`);
```

<strong class="example-title">Add a label, and lower the access later</strong>

```js
const share = await puter.kv.share({
    prefix: 'trip:japan-2027:',
    recipient: 'alice',
    access: 'write',
    label: 'Japan 2027',
});

// Same prefix and user, so this changes the same share.
await puter.kv.share('trip:japan-2027:', 'alice', 'read');
```

## Related

- [`puter.kv.unshare()`](/KV/unshare/) - Stop a share
- [`puter.kv.listSharedByMe()`](/KV/listSharedByMe/) - List the shares you made
- [`puter.kv.listShared()`](/KV/listShared/) - List the shares made with you
