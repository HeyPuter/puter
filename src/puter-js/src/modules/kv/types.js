// Shapes shared across the `puter.kv` operations. JSDoc-only; no runtime exports.

/** @typedef {string | number | boolean | object | unknown} KVValue */
/** @typedef {KVValue | KVValue[]} KVScalar */

/**
 * A key-value pair as returned by `list()` when `returnValues` is `true`.
 *
 * @template [T=unknown]
 * @typedef {Object} KVPair
 * @property {string} key The key name.
 * @property {T} value The value associated with the key. Can be of any type.
 */

/**
 * A single item in a batch `set()` operation.
 *
 * @template [T=KVScalar]
 * @typedef {Object} KVSetItem
 * @property {string} key The key to create or update. Maximum key size is `1 KB`.
 * @property {T} value The value to store. Maximum value size is `400 KB`.
 * @property {number | null} [expireAt] Timestamp, in seconds, at which the key should expire.
 * Omit or pass `null` for no expiry.
 */

/**
 * Object form of the arguments to `set()`.
 *
 * @template [T=KVScalar]
 * @typedef {Object} KVSetObject
 * @property {string} key The key to create or update. Maximum key size is `1 KB`.
 * @property {T} value The value to store. Maximum value size is `400 KB`.
 * @property {number | null} [expireAt] Timestamp, in seconds, at which the key should expire.
 * Omit or pass `null` for no expiry.
 * @property {KVOptConfig} [optConfig]
 */

/**
 * Wrapped batch form of `set()`, setting multiple items in a single request.
 *
 * @template [T=KVScalar]
 * @typedef {Object} KVSetBatch
 * @property {KVSetItem<T>[]} items The key-value items to set in a single request.
 * @property {KVOptConfig} [optConfig]
 */

/**
 * Maps a dot-separated path to a property within an object value (e.g.
 * `"user.score"`) to the amount to increment/decrement it by.
 *
 * @typedef {Record<string, number>} KVIncrementPath
 */

/**
 * Maps each dot-separated path (e.g. `"profile.name"`) to the new value for
 * that path.
 *
 * @typedef {Record<string, KVValue>} KVUpdatePath
 */

/**
 * Object form of the arguments to `update()`.
 *
 * @typedef {Object} KVUpdateObject
 * @property {string} key The key to update.
 * @property {KVUpdatePath} pathAndValueMap Maps dot-separated paths to their new values.
 * @property {number | null} [ttl] Time-to-live for the key, in seconds. Omit to keep the
 * key's current TTL; `null` removes it.
 * @property {KVOptConfig} [optConfig]
 */

/**
 * Maps each dot-separated path (e.g. `"profile.tags"`) to the value (or values)
 * to add at that path.
 *
 * @typedef {Record<string, KVValue | KVValue[]>} KVAddPath
 */

/**
 * Options object form of the arguments to `list()`.
 *
 * @typedef {Object} KVListOptions
 * @property {boolean} [reverse=false] Return keys in descending order. A cursor preserves its
 * direction when omitted; an explicitly conflicting direction is rejected.
 * @property {string} [pattern] Prefix-based key filter. A trailing `*` is a wildcard; both `abc` and
 * `abc*` match keys starting with `abc`. Defaults to `*`, matching all keys.
 * @property {boolean} [returnValues] When `true`, results contain `KVPair` objects with `key` and
 * `value`; when `false`, results contain only keys. Defaults to `false`.
 * @property {number} [limit] Maximum number of items to return in a single call.
 * @property {string} [cursor] Pagination cursor from a previous call.
 * @property {number} [offset] Skips the given number of items before the page starts. Maximum `5000`,
 * and cannot be combined with `cursor`. Prefer `cursor` — requests get slower and more expensive the
 * larger the offset.
 * @property {boolean} [includeTotal] When `true`, the result includes a `total` count of every item
 * matching the query across all pages. The count is metered and its cost grows with the store —
 * request it once (on the first page) and avoid it in hot paths; to know whether more pages exist,
 * check for `cursor` instead.
 * @property {boolean} [fetchUntilFull] A page can come back with fewer than `limit` items even when
 * more exist (for example when expired keys are excluded). When `true`, the page is filled up to
 * `limit` items when possible. Requires `limit`.
 * @property {KVOptConfig} [optConfig]
 */

/**
 * The options that switch `list()` from a flat array to a `KVListPage`. Any
 * one of them is enough — they are the same set the runtime treats as a
 * paginated request.
 *
 * @typedef {{ limit: number }
 *     | { cursor: string }
 *     | { offset: number }
 *     | { includeTotal: boolean }
 *     | { fetchUntilFull: boolean }} KVListPaginationOptions
 */

/**
 * The `stream: true` form of `list()`: returns an async iterator of
 * `KVListPage`s for `for await ... of` instead of a promise. Cannot be
 * combined with `offset`; pass `cursor` to resume from a position.
 *
 * @typedef {Object} KVListStreamOptions
 * @property {true} stream Stream page envelopes as they are fetched.
 */

/**
 * A page of paginated results from `list()` when `limit` or `cursor` is used.
 *
 * @template [T=unknown]
 * @typedef {Object} KVListPage
 * @property {T[]} items The keys (or `KVPair` objects when `returnValues` is `true`) for this page.
 * @property {string} [cursor] Pagination cursor for the next page. Present only when there are more
 * results to fetch; pass it to the next `list()` call.
 * @property {number} [total] Total count of items matching the query across all pages. Present only
 * when the page was requested with `includeTotal`.
 */

/**
 * Per-call configuration accepted by every `puter.kv` operation.
 *
 * @typedef {Object} KVOptConfig
 * @property {string} [appUuid] Address another app's namespace instead of this app's own. Requires
 * access to that app's data, which `puter.perms.request('appData', { app, scopes })` asks the user for.
 * @property {string} [handle] Address a region another user shared with you, by the `handle` from
 * `listShared()`. Keys and list patterns are then relative to the shared prefix. Needs `read` access
 * for `get` and `list`, and `write` for every other method; `flush` is refused. Rejected when
 * combined with `appUuid` or `disableSharing`.
 * @property {boolean} [onlyIfAbsent] `set()` only: write the key only when it has no live entry.
 * `set()` then resolves to `false` instead of overwriting. Two writes at nearly the same time can
 * both succeed. Rejected on the batch form.
 * @property {boolean} [disableSharing] Mark the entry private to this app: invisible and untouchable
 * to any other app the user later grants access to this namespace, and to users it is shared with.
 *
 * Honoured by both forms of `set()` — one key, or a batch, where it marks every entry in the batch.
 * `set` writes the whole entry, so writing the key again without the flag makes it shareable.
 * Rejected when combined with `appUuid` or `handle`, since only an entry's owner may mark it private.
 *
 * Use it for anything another app should never read, such as a cached OAuth token, since a user
 * granting access cannot see what a namespace holds.
 */

/**
 * What a share lets its holder do. Each level includes the ones before it: `watch` delivers change
 * events, `read` adds `get` and `list`, and `write` adds every method that changes or deletes keys.
 *
 * @typedef {'watch' | 'read' | 'write'} KVShareAccess
 */

/**
 * Who a share is for: a username, `{ username }`, or `{ uid }` with the user's uuid. A string that
 * contains `@` is refused with `invalid_recipient`.
 *
 * @typedef {string | { username: string } | { uid: string }} KVShareRecipient
 */

/**
 * Options form of `share()`.
 *
 * @typedef {Object} KVShareOptions
 * @property {string} prefix The key prefix to share, such as `'list:42:'`. Its segments use only
 * lowercase letters, digits, `_`, `.` and `-`. The trailing `:` is optional.
 * @property {KVShareRecipient} recipient Who to share it with.
 * @property {KVShareAccess} [access] Defaults to `'read'`.
 * @property {string | null} [label] Plain text the holder is shown, up to 128 characters. Omit it to
 * keep the current label when sharing again, or pass `null` to clear it.
 * @property {string} [appUuid] The app whose data to share. Outside an app it can name any app, and
 * defaults to the app-less store. An app always shares its own data.
 */

/**
 * A share as `share()` returns it to the owner.
 *
 * @typedef {Object} KVShare
 * @property {string} handle The share's id. The holder passes it as `optConfig.handle`.
 * @property {string} prefix The shared key prefix, always ending in `:`.
 * @property {KVShareAccess} access What the holder can do.
 * @property {string | null} appUid The app whose data is shared, or `null` for the app-less store.
 * @property {string} holder The holder's username.
 * @property {string | null} label The label the holder is shown.
 * @property {number} createdAt When the share was made, in Unix seconds.
 */

/**
 * Who stopped a share: its owner, its holder, or Puter (when the app whose data it was is deleted).
 *
 * @typedef {'owner' | 'holder' | 'system'} KVShareRevokedBy
 */

/**
 * A share in the owner's `listSharedByMe()` listing. Stopped shares stay in it.
 *
 * @typedef {Object} KVSharedByMe
 * @property {string} handle The share's id.
 * @property {string} prefix The shared key prefix, always ending in `:`.
 * @property {KVShareAccess} access What the holder can do.
 * @property {string | null} appUid The app whose data is shared, or `null` for the app-less store.
 * @property {string | null} holder The holder's username. A share is deleted with its holder's
 * account.
 * @property {string | null} label The label the holder is shown.
 * @property {number} createdAt When the share was made, in Unix seconds.
 * @property {number | null} revokedAt When the share stopped, in Unix seconds, or `null` while it's
 * live.
 * @property {KVShareRevokedBy | null} revokedBy Who stopped it. `null` while it's live, and on some
 * shares that stopped before who stopped them was recorded.
 */

/**
 * A share in the holder's `listShared()` listing. It never names the owner or the prefix.
 *
 * @typedef {Object} KVSharedWithMe
 * @property {string} handle Pass it as `optConfig.handle` to use the share.
 * @property {KVShareAccess} access What you can do.
 * @property {string | null} appUid The app whose data it is, or `null` for the app-less store.
 * @property {string | null} label Plain text the owner set. Render it as text, never as HTML.
 * @property {number} createdAt When the share was made, in Unix seconds.
 */

/**
 * Options for `listShared()` and `listSharedByMe()`.
 *
 * @typedef {Object} KVShareListOptions
 * @property {number} [limit] Shares per page. Defaults to `50`, at most `200`.
 * @property {string} [cursor] The `cursor` from the previous page.
 * @property {boolean} [includeTotal] Add `total`, the number of shares across every page.
 */

/**
 * What `unshare()` resolves to.
 *
 * @typedef {Object} KVUnshareResult
 * @property {string} handle The share that stopped.
 * @property {number} revokedAt When it stopped, in Unix seconds.
 */

export {};
