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
 * @property {number} [expireAt] Timestamp, in seconds, at which the key should expire.
 */

/**
 * Object form of the arguments to `set()`.
 *
 * @template [T=KVScalar]
 * @typedef {Object} KVSetObject
 * @property {string} key The key to create or update. Maximum key size is `1 KB`.
 * @property {T} value The value to store. Maximum value size is `400 KB`.
 * @property {number} [expireAt] Timestamp, in seconds, at which the key should expire.
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
 * @property {number} [ttl] Time-to-live for the key, in seconds.
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
 * @property {string} [appUuid] Address another app's namespace instead of this app's own. Requires an
 * `app-data:<appUuid>:kv:<op>` permission, which `puter.perms.requestAppData()` asks the user for.
 * @property {boolean} [disableSharing] Mark the entry private to this app: invisible and untouchable
 * to any other app the user later grants access to this namespace.
 *
 * Honoured by both forms of `set()` — one key, or a batch, where it marks every entry in the batch.
 * `set` writes the whole entry, so writing the key again without the flag makes it shareable.
 * Rejected when combined with `appUuid`, since only an entry's owner may mark it private.
 *
 * Use it for anything another app should never read, such as a cached OAuth token, since a user
 * granting access cannot see what a namespace holds.
 */

export {};
