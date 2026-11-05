---
title: puter.kv.unshare()
description: Stop sharing key-value data with another user, or remove your own access to data shared with you.
platforms: [websites, apps, nodejs, workers]
---

<div class="info">KV sharing is in beta. Method shapes, limits, and behavior may change between releases.</div>

Stops a share made with [`puter.kv.share()`](/KV/share/). Either side can call it:

- **The owner** revokes the share. The holder loses access, and any narrower share you made with the same holder inside the same prefix stops too.
- **The holder** removes their own access. Any narrower share they hold from the same owner inside the same prefix stops too.

The handle stops working right away for every [`puter.kv`](/KV/) call. Persistent subscriptions on it are suspended with `permission_revoked`, and [`onLocal()`](/Events/onLocal/) subscriptions on it end with `permission_revoked`. If the holder still has a wider share that covers the same keys, calls through the stopped handle can keep working for up to 60 seconds. The keys stay in the owner's store.

A stopped share stays in the owner's [`puter.kv.listSharedByMe()`](/KV/listSharedByMe/) listing for 30 days, with `revokedAt` and `revokedBy` set. Sharing the same prefix with the same user again makes a new share with a new `handle`.

## Syntax

```js
puter.kv.unshare(handle)
```

## Parameters

#### `handle` (String) (required)

The share's `handle`, from [`puter.kv.share()`](/KV/share/), [`puter.kv.listSharedByMe()`](/KV/listSharedByMe/), or [`puter.kv.listShared()`](/KV/listShared/).

## Return value

A `Promise` that resolves to:

- `handle` (String): The share that stopped.
- `revokedAt` (Number): When it stopped, in Unix seconds.

Stopping a share that already stopped resolves the same way again.

## Who can unshare

- The owner and the holder can unshare in the app whose data it is, or outside any app. A handle that isn't yours, as owner or holder, is rejected with `subject_does_not_exist`, the same as one that doesn't exist.
- To revoke as the owner, an app also needs the user's consent for the prefix, the same consent [`puter.kv.share()`](/KV/share/) needs. To remove the user's own access as the holder, it needs no consent.

Unsharing works when sharing is turned off on the deployment, so you can always stop a share.

## Errors

The promise rejects with `{ message, code }`:

| Code | Meaning |
| -- | -- |
| `invalid_request` | No `handle` was given. |
| `subject_does_not_exist` | The handle doesn't exist, you're neither its owner nor its holder, or the holder called from an app other than the one whose data it shares. |
| `events_kv_handle_not_delegated` | An app revoked its user's share without the user's consent for that prefix. |
| `events_kv_handle_owner_only` | The owner called from an app other than the one whose data it shares, or from an access token with less access than the account. |
| `too_many_requests` | Over the rate limit, which sharing and unsharing count toward together. See [Rate Limits and Quotas](/rate-limits-and-quotas/#events). |

## Examples

<strong class="example-title">Revoke a share you made</strong>

```js
const share = await puter.kv.share('list:42:', 'alice', 'write');

const { revokedAt } = await puter.kv.unshare(share.handle);
puter.print(`Stopped at ${new Date(revokedAt * 1000).toISOString()}`);
```

<strong class="example-title">Remove your own access to a share</strong>

```js
const { items } = await puter.kv.listShared();
for (const share of items) {
    if (share.label === 'Old project') {
        await puter.kv.unshare(share.handle);
    }
}
```

## Related

- [`puter.kv.share()`](/KV/share/) - Share keys with another user
- [`puter.kv.listSharedByMe()`](/KV/listSharedByMe/) - List the shares you made
- [`puter.kv.listShared()`](/KV/listShared/) - List the shares made with you
