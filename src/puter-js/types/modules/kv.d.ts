/* eslint-disable no-unused-vars */
export type KVValue = string | number | boolean | object | unknown;
export type KVScalar = KVValue | KVValue[];

/** A key-value pair as returned by `list()` when `returnValues` is `true`. */
export interface KVPair<T = unknown> {
    /** The key name. */
    key: string;
    /** The value associated with the key. Can be of any type. */
    value: T;
}

/** A single item in a batch `set()` operation. */
export interface KVSetItem<T = KVScalar> {
    /** The key to create or update. Maximum key size is `1 KB`. */
    key: string;
    /** The value to store. Maximum value size is `400 KB`. */
    value: T;
    /** Timestamp, in seconds, at which the key should expire. */
    expireAt?: number;
}

/** Object form of the arguments to `set()`. */
export interface KVSetObject<T = KVScalar> {
    /** The key to create or update. Maximum key size is `1 KB`. */
    key: string;
    /** The value to store. Maximum value size is `400 KB`. */
    value: T;
    /** Timestamp, in seconds, at which the key should expire. */
    expireAt?: number;
    optConfig?: KVOptConfig;
}

/** Wrapped batch form of `set()`, setting multiple items in a single request. */
export interface KVSetBatch<T = KVScalar> {
    /** The key-value items to set in a single request. */
    items: KVSetItem<T>[];
    optConfig?: KVOptConfig;
}

/**
 * Maps a dot-separated path to a property within an object value (e.g.
 * `"user.score"`) to the amount to increment/decrement it by.
 */
export interface KVIncrementPath {
    [path: string]: number;
}

/**
 * Maps each dot-separated path (e.g. `"profile.name"`) to the new value for
 * that path.
 */
export interface KVUpdatePath {
    [path: string]: KVValue;
}

/** Object form of the arguments to `update()`. */
export interface KVUpdateObject {
    /** The key to update. */
    key: string;
    /** Maps dot-separated paths to their new values. */
    pathAndValueMap: KVUpdatePath;
    /** Time-to-live for the key, in seconds. */
    ttl?: number;
    optConfig?: KVOptConfig;
}

/**
 * Maps each dot-separated path (e.g. `"profile.tags"`) to the value (or values)
 * to add at that path.
 */
export interface KVAddPath {
    [path: string]: KVValue | KVValue[];
}

/** Options object form of the arguments to `list()`. */
export interface KVListOptions {
    /**
     * Prefix-based key filter. A trailing `*` is a wildcard; both `abc` and
     * `abc*` match keys starting with `abc`. Defaults to `*`, matching all keys.
     */
    pattern?: string;
    /**
     * When `true`, results contain `KVPair` objects with `key` and `value`;
     * when `false`, results contain only keys. Defaults to `false`.
     */
    returnValues?: boolean;
    /** Maximum number of items to return in a single call. */
    limit?: number;
    /** Pagination cursor from a previous call. */
    cursor?: string;
    /**
     * Skips the given number of items before the page starts. Maximum `5000`,
     * and cannot be combined with `cursor`. Prefer `cursor` — requests get
     * slower and more expensive the larger the offset.
     */
    offset?: number;
    /**
     * When `true`, the result includes a `total` count of every item matching
     * the query across all pages. The count is metered and its cost grows
     * with the store — request it once (on the first page) and avoid it in
     * hot paths; to know whether more pages exist, check for `cursor`
     * instead.
     */
    includeTotal?: boolean;
    /**
     * A page can come back with fewer than `limit` items even when more exist
     * (for example when expired keys are excluded). When `true`, the page is
     * filled up to `limit` items when possible. Requires `limit`.
     */
    fetchUntilFull?: boolean;
    optConfig?: KVOptConfig;
}

export type KVListPaginationOptions =
    | { limit: number; cursor?: string }
    | { cursor: string; limit?: number };

/**
 * The `stream: true` form of `list()`: returns an async iterator of
 * `KVListPage`s for `for await ... of` instead of a promise. Cannot be
 * combined with `offset`; pass `cursor` to resume from a position.
 */
export interface KVListStreamOptions {
    /** Stream page envelopes as they are fetched. */
    stream: true;
}

/** A page of paginated results from `list()` when `limit` or `cursor` is used. */
export interface KVListPage<T = unknown> {
    /** The keys (or `KVPair` objects when `returnValues` is `true`) for this page. */
    items: T[];
    /**
     * Pagination cursor for the next page. Present only when there are more
     * results to fetch; pass it to the next `list()` call.
     */
    cursor?: string;
    /**
     * Total count of items matching the query across all pages. Present only
     * when the page was requested with `includeTotal`.
     */
    total?: number;
}

export interface KVOptConfig {
    appUuid?: string;
}

/**
 * The key-value store. Each app has its own private store within each user's
 * account; apps cannot access other apps' stores.
 */
export class KV {
    /** The maximum allowed key size, in bytes (`1 KB`). */
    readonly MAX_KEY_SIZE: number;
    /** The maximum allowed value size, in bytes (`400 KB`). */
    readonly MAX_VALUE_SIZE: number;

    /**
     * Creates a key-value pair, or updates the value if the key already exists.
     * Can also set multiple pairs at once via an array or batch object.
     * @param key - Key name. Maximum key size is `1 KB`.
     * @param value - Value to store. Maximum value size is `400 KB`.
     * @returns `true` once the pair has been created or updated.
     */
    set<T = KVScalar>(key: string, value: T, optConfig: KVOptConfig): Promise<boolean>;
    /** @param expireAt - Timestamp, in seconds, at which the key should expire. */
    set<T = KVScalar>(key: string, value: T, expireAt?: number, optConfig?: KVOptConfig): Promise<boolean>;
    set<T = KVScalar>(item: KVSetObject<T>): Promise<boolean>;
    set(items: KVSetItem[], optConfig?: KVOptConfig): Promise<boolean>;
    set(batch: KVSetBatch): Promise<boolean>;
    /** Returns the key's value, or `undefined` if the key does not exist. */
    get<T = unknown>(key: string, optConfig?: KVOptConfig): Promise<T | undefined>;
    /**
     * Removes a key. Does nothing if the key does not exist.
     * @returns `true` once the key has been removed.
     */
    del (key: string, optConfig?: KVOptConfig): Promise<boolean>;
    /**
     * Increments the value of a key, returning the new value. If the key does
     * not exist it is initialized to `0` first. Limited to 64-bit signed
     * integers; errors if the value is not a valid integer.
     * @param amount - Amount to increment by (defaults to `1`), or an object
     * mapping a path within an object value to the amount to increment it by.
     */
    incr (key: string, optConfig: KVOptConfig): Promise<number>;
    incr (key: string, amount?: number | KVIncrementPath, optConfig?: KVOptConfig): Promise<number>;
    /**
     * Decrements the value of a key, returning the new value. If the key does
     * not exist it is initialized to `0` first. Errors if the value is not a
     * valid integer.
     * @param amount - Amount to decrement by (defaults to `1`), or an object
     * mapping a path within an object value to the amount to decrement it by.
     */
    decr (key: string, optConfig: KVOptConfig): Promise<number>;
    decr (key: string, amount?: number | KVIncrementPath, optConfig?: KVOptConfig): Promise<number>;
    /**
     * Adds values to an existing key, returning the updated value.
     * @param value - The value to add (defaults to `1` when omitted), or an
     * object mapping dot-separated paths to the value(s) to add at each path.
     */
    add (key: string, optConfig: KVOptConfig): Promise<KVValue>;
    add (key: string, value?: KVValue | KVAddPath, optConfig?: KVOptConfig): Promise<KVValue>;
    /**
     * Removes values from a key by one or more dot-separated paths, returning
     * the updated value.
     * @param paths - One or more dot-separated paths to remove (e.g. `"profile.bio"`).
     */
    remove (key: string, ...paths: Array<string | KVOptConfig>): Promise<KVValue>;
    /**
     * Updates one or more paths within the value stored at a key without
     * overwriting the entire value, returning the updated value.
     * @param pathAndValueMap - Maps dot-separated paths to their new values.
     * @param ttl - Time-to-live for the key, in seconds.
     */
    update (key: string, pathAndValueMap: KVUpdatePath, optConfig: KVOptConfig): Promise<KVValue>;
    update (key: string, pathAndValueMap: KVUpdatePath, ttl?: number, optConfig?: KVOptConfig): Promise<KVValue>;
    update (item: KVUpdateObject): Promise<KVValue>;
    /**
     * Sets the time-to-live for a key, in seconds.
     * @param ttlSeconds - Number of seconds until the key is removed.
     * @returns `true` once the expiration has been set.
     */
    expire (key: string, ttlSeconds: number, optConfig?: KVOptConfig): Promise<boolean>;
    /**
     * Sets the expiration timestamp for a key.
     * @param timestampSeconds - Unix timestamp, in seconds, at which the key is removed.
     * @returns `true` once the expiry time has been set.
     */
    expireAt (key: string, timestampSeconds: number, optConfig?: KVOptConfig): Promise<boolean>;
    /**
     * Lists keys in the store for the current app, sorted lexicographically by
     * key. Returns just the keys, an array of `KVPair` objects when
     * `returnValues` is `true`, or a `KVListPage` when `limit`/`cursor` is used.
     * With `stream: true` it instead returns an async iterator of
     * `KVListPage`s for `for await ... of`. Full (non-paginated) listings are
     * fetched page by page under the hood, but still read the entire store —
     * every page is metered, so prefer `stream`/`limit` with a narrow
     * `pattern` on large stores.
     * @param pattern - Prefix-based key filter with an optional trailing `*`
     * wildcard. Defaults to `*`, matching all keys.
     */
    list (pattern?: string, returnValues?: false): Promise<string[]>;
    list<T = unknown>(pattern: string, returnValues: true): Promise<KVPair<T>[]>;
    list<T = unknown>(returnValues: true): Promise<KVPair<T>[]>;
    list (pattern: string, returnValues: boolean, optConfig: KVOptConfig): Promise<string[] | KVPair<unknown>[]>;
    list (pattern: string, optConfig: KVOptConfig): Promise<string[]>;
    list<T = unknown>(returnValues: true, optConfig: KVOptConfig): Promise<KVPair<T>[]>;
    list (options: KVListOptions & KVListStreamOptions & { returnValues?: false }): AsyncIterableIterator<KVListPage<string>>;
    list<T = unknown>(options: KVListOptions & KVListStreamOptions & { returnValues: true }): AsyncIterableIterator<KVListPage<KVPair<T>>>;
    list (options: KVListOptions & KVListPaginationOptions & { returnValues?: false }): Promise<KVListPage<string>>;
    list<T = unknown>(options: KVListOptions & KVListPaginationOptions & { returnValues: true }): Promise<KVListPage<KVPair<T>>>;
    list (options: KVListOptions & { returnValues?: false }): Promise<string[]>;
    list<T = unknown>(options: KVListOptions & { returnValues: true }): Promise<KVPair<T>[]>;
    /**
     * Removes all key-value pairs from the store for the current app.
     * @returns `true` once the store has been flushed.
     */
    flush (optConfig?: KVOptConfig): Promise<boolean>;
    clear (optConfig?: KVOptConfig): Promise<boolean>;
}
