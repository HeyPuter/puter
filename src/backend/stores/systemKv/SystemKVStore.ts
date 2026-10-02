/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { metrics } from '@opentelemetry/api';
import type { KvMutation } from '../../clients/event/types';
import type { Actor } from '../../core/actor';
import {
    isSystemActor,
    SYSTEM_ACTOR,
    SYSTEM_ACTOR_UUID,
} from '../../core/actor';
import { HttpError } from '../../core/http';
import {
    decodeCursor,
    encodeCursor,
    normalizeLimit,
    normalizeOffset,
} from '../../util/pagination';
import { runWithConcurrencyLimit } from '../../util/concurrency';
import { PuterStore } from '../types';
import {
    cacheTtlSecondsFor,
    decodeCachedRead,
    encodeCachedHit,
    encodeCachedMiss,
    isExpiredTtl,
    KV_CACHE_BLOCK_MARKER,
    kvCacheKey,
    resolveKvCacheSettings,
    ttlNumber,
    type KvCachedItem,
    type KvCacheSettings,
} from './readCache';
import {
    PUTER_KV_STORE_TABLE_DEFINITION,
    PUTER_KV_STORE_TABLE_NAME,
} from './tableDefinition';

const meter = metrics.getMeter('puter-backend');

/**
 * What the read cache did with each key it was asked about, by `result`:
 *
 * - `hit` — answered from a cached value
 * - `miss` — answered from a cached absence, which saves the same read a `hit`
 *   does and belongs on the same side of the ratio
 * - `expired` — a cached value whose own deadline had passed, so it answered
 *   nothing and the key was read through
 * - `blocked` — a recent write left a marker, so the read deliberately went
 *   through and did not populate
 * - `absent` — nothing was cached; the read went through and populated
 * - `error` — the cache could not be reached and the read degraded to uncached
 *
 * The rate worth watching is `(hit + miss) / total`. Deliberately not split by
 * namespace: namespaces are per-app, so that would be unbounded cardinality.
 */
const cacheLookupCounter = meter.createCounter('kv.cache.lookup', {
    description: 'KV read-cache lookups by outcome',
});

type CacheOutcomes = Record<
    'hit' | 'miss' | 'expired' | 'blocked' | 'absent',
    number
>;

const countedOutcomes = (): CacheOutcomes => ({
    hit: 0,
    miss: 0,
    expired: 0,
    blocked: 0,
    absent: 0,
});

/** One `add` per outcome that actually occurred, rather than one per key. */
const recordCacheOutcomes = (outcomes: CacheOutcomes): void => {
    for (const [result, count] of Object.entries(outcomes)) {
        if (count > 0) cacheLookupCounter.add(count, { result });
    }
};

// -- Types ------------------------------------------------------------

/** DynamoDB consumed-capacity units split by operation kind. */
export interface KVUsage {
    read: number;
    write: number;
    /**
     * Units for reads the cache answered, which consumed no capacity upstream:
     * the number the equivalent uncached read did consume, so a caller pricing
     * these has the same quantity to price against a different rate. Kept out
     * of `read` precisely so it can be priced differently.
     */
    cachedRead: number;
}

/**
 * Standard return envelope: `res` is the operation result, `usage` is the
 * DynamoDB consumed capacity so callers can meter if they choose to.
 */
export interface KVResult<T> {
    res: T;
    usage: KVUsage;
}

export interface KVOpts {
    /** Optional actor — defaults to the system actor. */
    actor?: Actor;
    /** Optional app uuid override for non-app-scoped actors. */
    appUuid?: string;
    /**
     * Namespace override that wins over the actor's own app — how an app
     * addresses a _different_ app's namespace. Set only by the KV driver, and
     * only after its cross-app permission check has passed.
     */
    namespaceAppUuid?: string;
}

export interface RecursiveRecord<T> {
    [k: string]: T | RecursiveRecord<T>;
}

// -- Helpers ----------------------------------------------------------

/** Namespace app component for an actor acting without an app. */
export const KV_GLOBAL_APP_KEY = 'os-global';
const SYSTEM_NAMESPACE = `v1:${SYSTEM_ACTOR_UUID}:${KV_GLOBAL_APP_KEY}`;
const MAX_KEY_BYTES = 1024;

/**
 * Whether a write was refused because the condition it carried no longer held.
 * The compare-and-set answer, not a failure: the caller re-reads and decides.
 */
const isConditionRefused = (err: unknown): boolean =>
    (err as { name?: string })?.name === 'ConditionalCheckFailedException';
const MAX_VALUE_BYTES = 399 * 1024;
// A number anywhere inside a value is bounded too, to the IEEE-754 safe
// integer range — past that it cannot round-trip, so it is clamped to the
// bound as the write is encoded. Enforced there rather than here because
// finding one means walking every value of every write: the whole payload's
// cost again, on the hot path, for something almost nothing sends.
/**
 * DynamoDB's own per-request item cap for BatchGetItem; also the chunk size
 * here.
 */
export const KV_BATCH_GET_LIMIT = 100;
/**
 * BatchGetItems one read keeps in flight. A call's keys share a partition, so
 * this narrows the burst; it does not hold it under the partition's RCU/s.
 */
export const KV_BATCH_GET_CONCURRENCY = 4;
const PATH_CLEANER_REGEX = /[^A-Za-z0-9_]/g;
// Offset emulation re-scans everything before the requested position, so it
// is bounded; cursors are the recommended way to page.
const MAX_LIST_OFFSET = 5000;
const MAX_FILL_PAGES = 10;
// Cache keys carried by one invalidation broadcast. A peer applies them in a
// single pass either way; the cap only keeps an individual message a sane size.
const KV_CACHE_BROADCAST_CHUNK = 500;

/**
 * Marks an entry private to the app that wrote it. Beside `value`/`ttl`, so
 * caller data can neither collide with it nor set it.
 */
export const KV_PRIVATE_ATTR = 'noShare';

/** `[key]` when the item carries the private flag, else nothing. */
const privateKeys = (
    key: string,
    item?: Record<string, unknown>,
): string[] | undefined => (item?.[KV_PRIVATE_ATTR] ? [key] : undefined);

/**
 * Live: `ttl` isn't a number, is `0`, or is future. Used for reads and listing,
 * where `isExpiredTtl` settles a legacy numeric-string/boolean `ttl` a
 * condition can't coerce. `remove` writes under it too; other writes use
 * `writableRowFilter`.
 */
const liveRowFilter = (now: number) => ({
    expression:
        'attribute_not_exists(#ttl) OR NOT attribute_type(#ttl, :ttlNum) OR #ttl = :ttlNone OR #ttl > :nowTs',
    names: { '#ttl': 'ttl' },
    values: { ':ttlNum': 'N', ':ttlNone': 0, ':nowTs': now },
});

/**
 * Writable: no `ttl`, a null or `0` one, or a future number. A `ttl` stored as
 * text or a boolean refuses, so `#writeLiveOrMissing` can read it the way reads
 * do.
 */
const writableRowFilter = (now: number) => ({
    expression:
        'attribute_not_exists(#ttl) OR attribute_type(#ttl, :ttlNull) OR #ttl = :ttlNone OR #ttl > :nowTs',
    names: { '#ttl': 'ttl' },
    values: { ':ttlNull': 'NULL', ':ttlNone': 0, ':nowTs': now },
});

/** A row whose `ttl` has passed and has not been swept yet. */
const expiredRowFilter = (now: number) => {
    const live = liveRowFilter(now);
    return { ...live, expression: `NOT (${live.expression})` };
};

/**
 * A timestamp at or before now is stored as `floor(now)` rather than as-is, so
 * it still sweeps (never `0`, which reads as no expiry).
 */
const storedExpiry = (timestamp: number): number => {
    const now = Date.now() / 1000;
    return timestamp <= now ? Math.floor(now) : timestamp;
};

/**
 * Coerces `expireAt` to a number or `null` (no expiry); rejects anything else,
 * since a raw HTTP body isn't bound by the SDK's types.
 */
const coerceExpiry = (value: unknown, label: string): number | null => {
    if (
        value === null ||
        value === undefined ||
        value === 0 ||
        value === '' ||
        value === false
    ) {
        return null;
    }
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
        const n = Number(value);
        if (Number.isFinite(n)) return n;
    }
    throw new HttpError(400, `kv: ${label} must be a number`, {
        legacyCode: 'bad_request',
    });
};

/**
 * An `update` ttl in seconds: `null` clears it; omitted, `''` or `false` keep
 * it (`undefined`).
 */
const coerceTtlSeconds = (value: unknown): number | null | undefined => {
    if (value === null) return null;
    if (value === undefined || value === '' || value === false)
        return undefined;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
        const n = Number(value);
        if (Number.isFinite(n)) return n;
    }
    throw new HttpError(400, 'kv: ttl must be a number', {
        code: 'ttl_invalid',
    });
};

/** A write refused because the stored value isn't the type the op needs. */
const isTypeMismatch = (err: unknown): boolean =>
    (err as Error)?.name === 'ValidationException' &&
    /incorrect (data|operand) type/i.test((err as Error).message);

/** A write refused because a path runs through something that can't hold it. */
const isInvalidDocumentPath = (err: unknown): boolean =>
    (err as Error)?.name === 'ValidationException' &&
    /document path provided in the update expression is invalid/i.test(
        (err as Error).message,
    );

/** A write refused because the item it would leave is over the size cap. */
const isItemTooLarge = (err: unknown): boolean =>
    (err as Error)?.name === 'ValidationException' &&
    /item size (to update )?has exceeded/i.test((err as Error).message);

/** A write refused for nesting the stored value past 32 levels. */
const isNestingTooDeep = (err: unknown): boolean =>
    (err as Error)?.name === 'ValidationException' &&
    /nesting levels have exceeded/i.test((err as Error).message);

/**
 * Attempts `#writeLiveOrMissing` retries a write refused for landing on a stale
 * expired row.
 */
const MAX_LIVE_WRITE_ATTEMPTS = 3;

/**
 * Expired entries, plus private ones for a cross-app caller. Filtered in the
 * query rather than afterwards so `includeTotal`'s COUNT excludes them too — a
 * total counting rows the caller can't see would leak what the flag hides.
 */
const listFilter = (now: number, crossApp: boolean) => {
    const live = liveRowFilter(now);
    if (!crossApp) return live;
    return {
        expression: `(${live.expression}) AND attribute_not_exists(#privAttr)`,
        names: { ...live.names, '#privAttr': KV_PRIVATE_ATTR },
        values: { ...live.values },
    };
};

const emptyUsage = (): KVUsage => ({ read: 0, write: 0, cachedRead: 0 });

const readUsage = (units: number | undefined): KVUsage => ({
    read: Number(units ?? 0),
    write: 0,
    cachedRead: 0,
});

const writeUsage = (units: number | undefined): KVUsage => ({
    read: 0,
    write: Number(units ?? 0),
    cachedRead: 0,
});

const cachedReadUsage = (units: number): KVUsage => ({
    read: 0,
    write: 0,
    cachedRead: units,
});

const addUsage = (a: KVUsage, b: KVUsage): KVUsage => ({
    read: a.read + b.read,
    write: a.write + b.write,
    cachedRead: a.cachedRead + b.cachedRead,
});

const ensureActor = (opts?: KVOpts): Actor => opts?.actor ?? SYSTEM_ACTOR;

const isCrossApp = (opts?: KVOpts): boolean => Boolean(opts?.namespaceAppUuid);

// `effectiveApp`, not `app`, so the namespace agrees with the gate the driver
// applied: both read an access-token actor as the app that issued it, rather
// than the driver treating it as app-scoped while the store files its data
// under the shared global key.
const getNamespace = (actor: Actor, opts?: KVOpts): string => {
    if (isSystemActor(actor)) return SYSTEM_NAMESPACE;
    const appUuid =
        opts?.namespaceAppUuid ??
        actor.effectiveApp?.uid ??
        opts?.appUuid ??
        KV_GLOBAL_APP_KEY;
    return kvNamespace(actor.user.uuid!, appUuid);
};

/** The namespace one user's data for one app lives in. */
export const kvNamespace = (userUuid: string, appUid: string): string =>
    `v1:${userUuid}:${appUid}`;

/** Split a namespace back into its parts, or `null` if it is not one. */
export const parseKvNamespace = (
    namespace: string,
): { userUuid: string; appUid: string } | null => {
    const parts = namespace.split(':');
    if (parts.length !== 3 || parts[0] !== 'v1' || !parts[1] || !parts[2])
        return null;
    return { userUuid: parts[1], appUid: parts[2] };
};

const assertKey = (key: string): void => {
    if (key === '')
        throw new HttpError(400, 'kv: key is empty', {
            legacyCode: 'bad_request',
        });
    if (Buffer.byteLength(key, 'utf8') > MAX_KEY_BYTES) {
        throw new HttpError(
            400,
            `kv: key exceeds ${MAX_KEY_BYTES} byte limit`,
            { legacyCode: 'bad_request' },
        );
    }
};

/**
 * Object keys we refuse to store or to walk, anywhere in a value or a document
 * path.
 *
 * `__proto__` is the prototype-pollution vector: any code that walks a
 * caller-supplied path (`createPaths` below, and every future traversal) would
 * step onto `Object.prototype` and write there. It also can't round-trip — the
 * AWS document client unmarshalls maps with plain assignment, so a stored
 * `__proto__` attribute comes back as the object's prototype instead of as
 * data. `constructor`/`prototype` are the second hop of the same walk, and a
 * map holding a `constructor` key fails the document client's own "is this a
 * plain object" test, which surfaces as an opaque 500 rather than a client
 * error.
 */
const UNSAFE_OBJECT_KEYS: ReadonlySet<string> = new Set([
    '__proto__',
    'constructor',
    'prototype',
]);

const unsafeKeyError = (key: string, subject: string): HttpError =>
    new HttpError(400, `kv: ${subject} \`${key}\` is not allowed`, {
        legacyCode: 'bad_request',
    });

type PathToken =
    | { type: 'key'; value: string }
    | { type: 'index'; value: number };

const invalidPathError = (): HttpError =>
    new HttpError(400, 'kv: path has invalid syntax', {
        legacyCode: 'bad_request',
    });

/**
 * The store nests attributes at most 32 levels deep; the `value` attribute is
 * the first.
 */
const MAX_NESTING_LEVELS = 32;
/** The levels a caller's path can use under `value`. */
const MAX_PATH_TOKENS = MAX_NESTING_LEVELS - 1;
/**
 * Path segments one call may carry across all its paths. Each renders as at
 * least three bytes (`[0]`) of the one update expression a call sends, which
 * the store caps at 4,096 bytes, so past 1,365 a call can never apply.
 */
const MAX_CALL_PATH_TOKENS = 1500;

const tooDeepError = (valPath: string): HttpError =>
    new HttpError(
        400,
        `kv: path ${describePath(valPath)} is nested too deeply (at most ${MAX_PATH_TOKENS} levels)`,
        { legacyCode: 'bad_request' },
    );

/** A quoted path segment that names nothing, such as `[""]`. */
const emptySegmentError = (valPath: string): HttpError =>
    new HttpError(
        400,
        `kv: path ${describePath(valPath)} names an empty field; a field name needs at least one character`,
        { legacyCode: 'bad_request' },
    );

/** A call whose paths together are too many, or too long, to apply in one write. */
const tooManyPathsError = (cause?: unknown): HttpError =>
    new HttpError(
        400,
        'kv: the paths in this call are too many or too long to apply in one write; split them across several calls',
        { legacyCode: 'bad_request', cause },
    );

/** A value, or a value at a path, nested past the store's 32-level limit. */
const tooDeeplyNestedError = (path?: string, cause?: unknown): HttpError =>
    new HttpError(
        400,
        path === undefined
            ? `kv: the value is nested too deeply (at most ${MAX_NESTING_LEVELS} levels, counting the value itself)`
            : `kv: the value at ${describePath(path)} is nested too deeply (at most ${MAX_NESTING_LEVELS} levels, counting the value and each segment of its path)`,
        { legacyCode: 'bad_request', cause },
    );

/** Parse the dot and bracket forms accepted by the KV document methods. */
const parsePath = (valPath: string): PathToken[] => {
    if (typeof valPath !== 'string')
        throw new HttpError(400, 'kv: path must be a string', {
            legacyCode: 'bad_request',
        });
    if (valPath === '') return [];

    const tokens: PathToken[] = [];
    // Checked on every push, so a very long path is refused the moment it
    // crosses the cap instead of being parsed to the end first.
    const push = (token: PathToken): void => {
        if (tokens.length === MAX_PATH_TOKENS) throw tooDeepError(valPath);
        tokens.push(token);
    };
    let position = 0;
    let expectSegment = true;
    while (position < valPath.length) {
        if (valPath[position] === '.') {
            while (valPath[position] === '.') position++;
            expectSegment = true;
            continue;
        }

        if (!expectSegment && valPath[position] !== '[')
            throw invalidPathError();

        if (valPath[position] === '[') {
            position++;
            if (position >= valPath.length) throw invalidPathError();
            const quote = valPath[position];
            if (quote === '"' || quote === "'") {
                position++;
                let value = '';
                let closed = false;
                while (position < valPath.length) {
                    const char = valPath[position++];
                    if (char === '\\') {
                        if (position >= valPath.length)
                            throw invalidPathError();
                        value += valPath[position++];
                    } else if (char === quote) {
                        closed = true;
                        break;
                    } else {
                        value += char;
                    }
                }
                if (!closed || valPath[position] !== ']')
                    throw invalidPathError();
                position++;
                if (value === '') throw emptySegmentError(valPath);
                if (UNSAFE_OBJECT_KEYS.has(value))
                    throw unsafeKeyError(value, 'path segment');
                push({ type: 'key', value });
            } else {
                const start = position;
                while (
                    position < valPath.length &&
                    /[0-9]/.test(valPath[position])
                )
                    position++;
                if (start === position || valPath[position] !== ']')
                    throw invalidPathError();
                const value = Number(valPath.slice(start, position));
                if (!Number.isSafeInteger(value)) throw invalidPathError();
                position++;
                push({ type: 'index', value });
            }
            expectSegment = false;
            continue;
        }

        if (!expectSegment) throw invalidPathError();
        const start = position;
        while (
            position < valPath.length &&
            valPath[position] !== '.' &&
            valPath[position] !== '['
        )
            position++;
        const value = valPath.slice(start, position);
        if (!value) throw invalidPathError();
        if (UNSAFE_OBJECT_KEYS.has(value))
            throw unsafeKeyError(value, 'path segment');
        push({ type: 'key', value });
        expectSegment = false;
    }
    return tokens;
};

/**
 * Parse every path, refusing a call whose paths together exceed the per-call
 * cap.
 */
const parsePaths = (paths: string[]): PathToken[][] => {
    let total = 0;
    return paths.map((path) => {
        const tokens = parsePath(path);
        total += tokens.length;
        if (total > MAX_CALL_PATH_TOKENS) throw tooManyPathsError();
        return tokens;
    });
};

const isOversizedExpression = (err: unknown): boolean =>
    (err as Error)?.name === 'ValidationException' &&
    /expression size/i.test((err as Error).message);

/** How much of a caller's path an error message echoes before truncating it. */
const MAX_ECHOED_PATH_CHARS = 100;

/**
 * A path for an error message: the root reads as prose, and a long path is
 * capped so one call can't blow up a message (or the work to build it).
 */
const describePath = (path: string): string => {
    if (path === '') return 'the root';
    const shown =
        path.length > MAX_ECHOED_PATH_CHARS
            ? `${path.slice(0, MAX_ECHOED_PATH_CHARS)}…`
            : path;
    return `\`${shown}\``;
};

/** Up to three of the caller's own paths, quoted for an error message. */
const describePaths = (paths: string[]): string => {
    const shown = paths.slice(0, 3).map(describePath).join(', ');
    return paths.length > 3 ? `${shown} and ${paths.length - 3} more` : shown;
};

/**
 * "path `a`", "paths `a`, `b`", or, when the store didn't say which, "at least
 * one of the paths …".
 */
const pathsSubject = (
    paths: string[],
    exact: boolean,
): { subject: string; plural: boolean } =>
    paths.length === 1
        ? { subject: `path ${describePaths(paths)}`, plural: false }
        : exact
          ? { subject: `paths ${describePaths(paths)}`, plural: true }
          : {
                subject: `at least one of the paths ${describePaths(paths)}`,
                plural: false,
            };

const notANumberError = (cause?: unknown): HttpError =>
    new HttpError(
        400,
        'kv: the value is not a number, so it cannot be incremented or decremented',
        { code: 'value_not_a_number', cause },
    );

/**
 * `exact` says whether every listed path is at fault, or only at least one of
 * them.
 */
const notAListError = (
    key: string,
    paths: string[],
    exact: boolean,
    cause?: unknown,
): HttpError => {
    if (paths.length === 1 && paths[0] === '')
        return new HttpError(
            400,
            `kv: the value stored at \`${key}\` isn't a list, so it can't be appended to`,
            { code: 'value_not_a_list', cause },
        );
    const { subject, plural } = pathsSubject(paths, exact);
    return new HttpError(
        400,
        `kv: ${subject} in \`${key}\` ${plural ? 'hold' : 'holds'} something other than a list, so ${plural ? 'they' : 'it'} can't be appended to`,
        { code: 'value_not_a_list', cause },
    );
};

/**
 * `exact` says whether every listed path is at fault, or only at least one of
 * them.
 */
const unfitPathsError = (
    key: string,
    paths: string[],
    exact: boolean,
    cause?: unknown,
): HttpError => {
    const { subject, plural } = pathsSubject(paths, exact);
    return new HttpError(
        400,
        `kv: ${subject} ${plural ? "don't" : "doesn't"} fit the value stored at \`${key}\`: a field name only works inside an object, and an [index] it passes through must be an existing list element`,
        { code: 'invalid_path', cause },
    );
};

/**
 * The caller-facing error for a path write the store refused; anything else
 * unchanged.
 */
const pathWriteError = (
    err: unknown,
    op: 'add' | 'update' | 'incr' | 'remove',
    key: string,
    paths: string[],
): unknown => {
    if (isTypeMismatch(err) && op === 'incr') return notANumberError(err);
    if (isTypeMismatch(err) && op === 'add')
        return notAListError(key, paths, false, err);
    if (isInvalidDocumentPath(err))
        return unfitPathsError(key, paths, false, err);
    if (isItemTooLarge(err))
        return new HttpError(
            400,
            `kv: this write would take the value stored at \`${key}\` over the 400 KB limit`,
            { code: 'value_too_large', cause: err },
        );
    if (isOversizedExpression(err)) return tooManyPathsError(err);
    if (isNestingTooDeep(err))
        return new HttpError(
            400,
            `kv: this write would nest the value stored at \`${key}\` more than ${MAX_NESTING_LEVELS} levels deep`,
            { legacyCode: 'bad_request', cause: err },
        );
    return err;
};

const overlappingPathsError = (first: string, second: string): HttpError =>
    new HttpError(
        400,
        first === second
            ? `kv: path ${describePath(first)} is listed more than once`
            : `kv: paths ${describePath(first)} and ${describePath(second)} overlap: one is the same as, or inside, the other`,
        { legacyCode: 'bad_request' },
    );

const conflictingPathsError = (first: string, second: string): HttpError =>
    new HttpError(
        400,
        `kv: paths ${describePath(first)} and ${describePath(second)} conflict: one uses a list index where the other uses a field name`,
        { legacyCode: 'bad_request' },
    );

/**
 * Reject a path that repeats, lies inside another, or disagrees with another on
 * whether a shared prefix is a list or a map — the store refuses all three in
 * one write.
 */
const assertDisjointPaths = (
    paths: string[],
    pathList: PathToken[][],
): void => {
    if (pathList.length < 2) return;

    const prefixIds = new PathPrefixIds();
    const idsByPath = pathList.map((tokens) => prefixIds.of(tokens));

    const pathById = new Map<number, string>();
    pathList.forEach((tokens, i) => {
        const id = idsByPath[i][tokens.length];
        const clash = pathById.get(id);
        if (clash !== undefined) throw overlappingPathsError(clash, paths[i]);
        pathById.set(id, paths[i]);
    });

    // The token type a shared prefix's next step takes, per path that reaches
    // it: a list index for one and a field name for another can't both be
    // true of the same container.
    const nextTokenType = new Map<
        number,
        { type: PathToken['type']; path: string }
    >();
    pathList.forEach((tokens, i) => {
        const ids = idsByPath[i];
        for (let depth = 0; depth < tokens.length; depth++) {
            const prefixId = ids[depth];
            const ancestor = pathById.get(prefixId);
            if (ancestor !== undefined)
                throw overlappingPathsError(ancestor, paths[i]);

            const seenNext = nextTokenType.get(prefixId);
            const type = tokens[depth].type;
            if (seenNext && seenNext.type !== type)
                throw conflictingPathsError(seenNext.path, paths[i]);
            if (!seenNext)
                nextTokenType.set(prefixId, { type, path: paths[i] });
        }
    });
};

/**
 * Walk a value about to be stored, whose root sits at `rootLevel`: reject
 * unsafe keys, and nesting past the store's 32-level limit. Iterative, one
 * element at a time (never a spread onto the stack), so neither a deep value
 * nor a long array can overflow.
 */
const assertValueShape = (
    value: unknown,
    rootLevel: number,
    path?: string,
): void => {
    const nodes: unknown[] = [value];
    const levels: number[] = [rootLevel];
    while (nodes.length > 0) {
        const current = nodes.pop();
        const level = levels.pop()!;
        if (level > MAX_NESTING_LEVELS) throw tooDeeplyNestedError(path);
        if (!current || typeof current !== 'object') continue;
        if (Array.isArray(current)) {
            for (const item of current) {
                nodes.push(item);
                levels.push(level + 1);
            }
            continue;
        }
        for (const [k, v] of Object.entries(current)) {
            if (UNSAFE_OBJECT_KEYS.has(k)) throw unsafeKeyError(k, 'value key');
            nodes.push(v);
            levels.push(level + 1);
        }
    }
};

/**
 * Reject a value too big to store, nested too deep, or holding a key that
 * cannot be walked safely. An out-of-range number is not rejected — it is
 * clamped when the write is encoded. `rootLevel` is where the value lands: 1
 * for a whole value, deeper for one landing at a document path.
 */
const assertValue = (value: unknown, rootLevel = 1, path?: string): void => {
    // Shape first: it stops at the nesting cap, and the size check's stringify
    // would overflow the stack on a value nested thousands of levels deep.
    assertValueShape(value, rootLevel, path);
    const size = Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');
    if (size > MAX_VALUE_BYTES) {
        throw new HttpError(
            400,
            `kv: value exceeds ${MAX_VALUE_BYTES} byte limit`,
            { legacyCode: 'bad_request' },
        );
    }
};

const normalizePattern = (pattern?: string): string | undefined => {
    if (pattern === undefined || pattern === null) return undefined;
    if (typeof pattern !== 'string')
        throw new HttpError(400, 'kv: pattern must be a string', {
            legacyCode: 'bad_request',
        });
    const trimmed = pattern.trim();
    if (trimmed === '') return undefined;
    if (trimmed.endsWith('*')) {
        const prefix = trimmed.slice(0, -1);
        return prefix === '' ? undefined : prefix;
    }
    return trimmed;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && !Array.isArray(value);

const objectsEqual = (left: unknown, right: unknown): boolean => {
    if (left === right) return true;
    if (Array.isArray(left) && Array.isArray(right)) {
        return (
            left.length === right.length &&
            left.every((value, index) => objectsEqual(value, right[index]))
        );
    }
    if (!isPlainObject(left) || !isPlainObject(right)) return false;
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) return false;
    for (const key of leftKeys) {
        if (!rightKeys.includes(key)) return false;
        if (!objectsEqual(left[key], right[key])) return false;
    }
    return true;
};

/**
 * Numbers each distinct path prefix, so comparing prefixes costs one lookup per
 * segment.
 */
class PathPrefixIds {
    #ids = new Map<string, number>();
    /** `ids[d]` names `tokens.slice(0, d)`; the root is 0. */
    of(tokens: PathToken[]): number[] {
        const ids = [0];
        for (const token of tokens) {
            const step = `${ids[ids.length - 1]}${token.type === 'index' ? '[' : '.'}${token.value}`;
            let id = this.#ids.get(step);
            if (id === undefined) {
                id = this.#ids.size + 1;
                this.#ids.set(step, id);
            }
            ids.push(id);
        }
        return ids;
    }
}

class PathExpressionRenderer {
    readonly names: Record<string, string> = { '#value': 'value' };
    #aliases = new Map<string, string>();

    path(tokens: PathToken[]): string {
        let result = '#value';
        for (const token of tokens) {
            if (token.type === 'index') result += `[${token.value}]`;
            else result += `.${this.#alias(token.value)}`;
        }
        return result;
    }

    #alias(key: string): string {
        let alias = this.#aliases.get(key);
        if (alias) return alias;
        // A placeholder is capped at 255 bytes; the name is only a debugging hint.
        alias = `#p${this.#aliases.size}_${key.replaceAll(PATH_CLEANER_REGEX, '').slice(0, 32)}`;
        this.#aliases.set(key, alias);
        this.names[alias] = key;
        return alias;
    }
}

/** The `SET` assignment `incr` renders for one path. */
const incrSetStatement = (
    tokens: PathToken[],
    idx: number,
    renderer: PathExpressionRenderer,
): string => {
    const attrName = renderer.path(tokens);
    return `${attrName} = if_not_exists(${attrName}, :start${idx}) + :incr${idx}`;
};

/**
 * Ceiling a caller assembling its own batches should keep each one under.
 *
 * The store rejects an update expression past its own size limit, and that
 * limit is on the rendered string — where every path appears twice, at its full
 * length — so a count of paths says nothing about whether a write will be
 * accepted. Sized below the limit so the optional TTL clause and any encoding
 * variance still fit.
 */
export const INCR_EXPRESSION_BUDGET_BYTES = 3584;

/** Size of the update expression `incr` would send for `paths`. */
export const incrExpressionBytes = (paths: string[]): number => {
    const renderer = new PathExpressionRenderer();
    return Buffer.byteLength(
        `SET ${parsePaths(paths)
            .map((tokens, index) => incrSetStatement(tokens, index, renderer))
            .join(', ')}`,
    );
};

/**
 * Split items into batches whose rendered expression each fits `maxBytes`,
 * preserving order. An item always gets a batch even when it can't fit in one:
 * a caller narrowing down which item a rejection belongs to needs the
 * single-item attempt to happen rather than being told it is impossible.
 */
const chunkByExpressionBytes = <T>(
    items: T[],
    expressionBytes: (batch: T[]) => number,
    maxBytes: number,
): T[][] => {
    const batches: T[][] = [];
    let batch: T[] = [];

    for (const item of items) {
        const wouldOverflow =
            batch.length > 0 && expressionBytes([...batch, item]) > maxBytes;
        if (wouldOverflow) {
            batches.push(batch);
            batch = [];
        }
        batch.push(item);
    }
    if (batch.length > 0) batches.push(batch);

    return batches;
};

/** Split incr paths into batches whose expressions each fit `maxBytes`. */
export const chunkPathsForIncr = (
    paths: string[],
    maxBytes: number = INCR_EXPRESSION_BUDGET_BYTES,
): string[][] => chunkByExpressionBytes(paths, incrExpressionBytes, maxBytes);

/** One missing intermediate container `createPaths` needs to write. */
interface CreatePathsLayerEntry {
    path: PathToken[];
    containerType: PathToken['type'];
}

/**
 * The root skeleton (`null` when every path is the whole value) and the
 * intermediate containers under it, grouped by depth, shallowest first.
 */
interface CreatePathsPlan {
    nestedMapValue: Record<string, unknown> | unknown[] | null;
    layers: CreatePathsLayerEntry[][];
}

/** Validate paths and plan what `createPaths` writes for them. No writes. */
const planCreatePaths = (pathList: PathToken[][]): CreatePathsPlan => {
    const nestedMapValue = (() => {
        const rootIsList = pathList[0]?.[0]?.type === 'index';
        if (
            pathList.some(
                (tokens) =>
                    tokens[0] && (tokens[0].type === 'index') !== rootIsList,
            )
        )
            throw new HttpError(400, 'kv: paths require incompatible roots', {
                legacyCode: 'bad_request',
            });
        if (rootIsList) return [] as unknown[];

        const valueRoot: Record<string, unknown> = {};
        let hasPaths = false;
        pathList.forEach((tokens) => {
            if (tokens.length === 0) return;
            hasPaths = true;
            let cursor: Record<string, unknown> = valueRoot;
            for (let i = 0; i < tokens.length - 1; i++) {
                const token = tokens[i];
                if (token.type === 'index') break;
                const next = tokens[i + 1];
                const container = next.type === 'index' ? [] : {};
                // Own properties only: an inherited hit here would mean
                // walking (and then writing to) the prototype chain.
                const existing = Object.hasOwn(cursor, token.value)
                    ? cursor[token.value]
                    : undefined;
                if (!isPlainObject(existing)) {
                    cursor[token.value] = container;
                }
                if (Array.isArray(container)) break;
                cursor = cursor[token.value] as Record<string, unknown>;
            }
        });
        return hasPaths ? valueRoot : null;
    })();

    if (!nestedMapValue) return { nestedMapValue: null, layers: [] };

    // Indexed ancestors must already exist, so they are never created.
    const prefixIds = new PathPrefixIds();
    const seen = new Map<number, CreatePathsLayerEntry>();
    pathList.forEach((tokens) => {
        const ids = prefixIds.of(tokens);
        for (let i = 1; i < tokens.length; i++) {
            const prefix = tokens.slice(0, i);
            if (prefix.at(-1)?.type === 'index') continue;
            const id = ids[i];
            const containerType = tokens[i].type;
            const existing = seen.get(id);
            if (existing && existing.containerType !== containerType) {
                throw new HttpError(
                    400,
                    'kv: paths require incompatible containers',
                    { legacyCode: 'bad_request' },
                );
            }
            seen.set(id, { path: prefix, containerType });
        }
    });

    // Equal-depth prefixes never overlap, so each depth can share one write.
    const byDepth = new Map<number, CreatePathsLayerEntry[]>();
    for (const entry of seen.values()) {
        const depth = entry.path.length;
        let group = byDepth.get(depth);
        if (!group) {
            group = [];
            byDepth.set(depth, group);
        }
        group.push(entry);
    }
    const layers = [...byDepth.keys()]
        .sort((a, b) => a - b)
        .map((depth) => byDepth.get(depth)!);

    return { nestedMapValue, layers };
};

/**
 * Paths the stored value can't take even after `createPaths` builds missing
 * objects: `path` when one runs through a non-object (non-list for an
 * `[index]`) or a missing list element, `type` when incr/add would land on a
 * non-number/non-list.
 */
const findUnfitPaths = (
    stored: unknown,
    pathList: PathToken[][],
    op: 'add' | 'update' | 'incr',
): { path: number[]; type: number[] } => {
    const unfit = { path: [] as number[], type: [] as number[] };
    pathList.forEach((tokens, index) => {
        let current = stored;
        let present = stored !== undefined;
        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i];
            if (!present) {
                // createPaths builds this only under a field name (or at the root).
                if (i > 0 && tokens[i - 1].type === 'index') {
                    unfit.path.push(index);
                    return;
                }
                current = token.type === 'index' ? [] : {};
            }
            if (token.type === 'index') {
                if (!Array.isArray(current)) {
                    unfit.path.push(index);
                    return;
                }
                present = token.value < current.length;
                current = present ? current[token.value] : undefined;
            } else {
                if (!isPlainObject(current)) {
                    unfit.path.push(index);
                    return;
                }
                present = Object.hasOwn(current, token.value);
                current = present ? current[token.value] : undefined;
            }
        }
        if (!present || op === 'update') return;
        if (
            op === 'incr'
                ? typeof current !== 'number'
                : !Array.isArray(current)
        )
            unfit.type.push(index);
    });
    return unfit;
};

/** The `SET` assignment `createPaths` renders for one missing container. */
const createPathsSetStatement = (
    entry: CreatePathsLayerEntry,
    idx: number,
    renderer: PathExpressionRenderer,
): string => {
    const attrName = renderer.path(entry.path);
    return `${attrName} = if_not_exists(${attrName}, :empty${idx})`;
};

/** Size of the update expression a layer's containers would render to. */
const createPathsLayerExpressionBytes = (
    entries: CreatePathsLayerEntry[],
): number => {
    const renderer = new PathExpressionRenderer();
    return Buffer.byteLength(
        `SET ${entries
            .map((entry, index) =>
                createPathsSetStatement(entry, index, renderer),
            )
            .join(', ')}`,
    );
};

// -- SystemKVStore ----------------------------------------------------

/**
 * Underlying key-value store. Housed at the store layer so both services
 * (permissions, metering) and drivers (`puter-kvstore`) can share it.
 *
 * Every method returns `{ res, usage }` — `res` is the operation result,
 * `usage` is the DynamoDB consumed capacity split into read/write units so
 * callers can meter at the driver level when needed. No metering happens inside
 * the store itself.
 *
 * If `opts.actor` is omitted, operations are scoped to the system namespace.
 */
export class SystemKVStore extends PuterStore {
    private tableName = PUTER_KV_STORE_TABLE_NAME;
    private initialized: Promise<void> | null = null;

    #cache: KvCacheSettings = resolveKvCacheSettings(this.config);
    #pendingInvalidations = new Set<string>();
    #invalidationTimer: ReturnType<typeof setTimeout> | null = null;

    override async onServerStart(): Promise<void> {
        if (this.#cache.enabled) this.#subscribeRemoteInvalidations();

        // For local/dynalite runs we need to create the table up front.
        // Real AWS deployments provision tables externally (Terraform), so
        // we skip — unless the operator explicitly opts in via
        // `dynamo.bootstrapTables` (e.g. self-hosting against
        // dynamodb-local in docker-compose).
        const ddbConfig = this.config.dynamo ?? {};
        if (ddbConfig.aws && !ddbConfig.bootstrapTables) return;

        this.initialized = this.clients.dynamo.createTableIfNotExists(
            { ...PUTER_KV_STORE_TABLE_DEFINITION, TableName: this.tableName },
            'ttl',
        );
        await this.initialized;
    }

    override async onServerPrepareShutdown(): Promise<void> {
        if (this.#invalidationTimer) {
            clearTimeout(this.#invalidationTimer);
            this.#invalidationTimer = null;
        }
        // Peers would otherwise keep serving entries this node invalidated in
        // the last coalescing window.
        this.#flushInvalidationBroadcast();
    }

    // -- Read cache ---------------------------------------------------

    /**
     * Whether reads in this namespace may be served from the cache.
     *
     * The system namespace is where internal state lives — metering counters,
     * one-time codes, permission rows. Those callers read to decide something
     * on the spot and can't be handed a value that was true a moment ago, so
     * they always read through. It is also why nothing outside this store needs
     * to opt in or out: the namespace already says which kind of data it is.
     */
    #cacheable(namespace: string): boolean {
        return this.#cache.enabled && namespace !== SYSTEM_NAMESPACE;
    }

    /**
     * Look `keys` up in the cache. `resolved` holds the keys the cache answered
     * — a hit or a cached absence — and is what the caller subtracts from the
     * set it still has to fetch.
     */
    async #cacheRead(
        namespace: string,
        keys: string[],
    ): Promise<{
        items: KvCachedItem[];
        resolved: Set<string>;
        readUnits: number;
    }> {
        const empty = {
            items: [] as KvCachedItem[],
            resolved: new Set<string>(),
            readUnits: 0,
        };
        if (keys.length === 0) return empty;

        try {
            const raw =
                keys.length === 1
                    ? [
                          await this.clients.redis.get(
                              kvCacheKey(namespace, keys[0]),
                          ),
                      ]
                    : await this.#cachePipelineGet(namespace, keys);

            const items: KvCachedItem[] = [];
            const resolved = new Set<string>();
            let readUnits = 0;
            const now = Date.now() / 1000;
            const outcomes = countedOutcomes();

            keys.forEach((key, index) => {
                const cached = decodeCachedRead(raw[index], key);
                if (cached.state === 'hit') {
                    // The entry carries its own deadline and the cache TTL is
                    // only an upper bound on it, so an entry that lapsed since
                    // it was written counts as nothing cached at all.
                    if (isExpiredTtl(cached.item.ttl, now)) {
                        outcomes.expired++;
                        return;
                    }
                    outcomes.hit++;
                    items.push(cached.item);
                    resolved.add(key);
                    readUnits += cached.readUnits;
                    return;
                }
                if (cached.state === 'miss') {
                    outcomes.miss++;
                    resolved.add(key);
                    readUnits += cached.readUnits;
                    return;
                }
                if (cached.state === 'blocked') outcomes.blocked++;
                else outcomes.absent++;
            });

            recordCacheOutcomes(outcomes);
            return { items, resolved, readUnits };
        } catch (e) {
            // A cache that is down degrades to no cache, never to an error.
            // Counted so that a cache which has stopped answering reads as
            // exactly that, rather than as a cache nobody is asking.
            cacheLookupCounter.add(keys.length, { result: 'error' });
            console.warn(
                '[kv] read cache lookup failed:',
                (e as Error).message,
            );
            return empty;
        }
    }

    /**
     * Multi-key lookup as a pipeline rather than an `MGET`, so keys landing in
     * different hash slots don't have to share one.
     */
    async #cachePipelineGet(
        namespace: string,
        keys: string[],
    ): Promise<(string | null)[]> {
        const pipeline = this.clients.redis.pipeline();
        for (const key of keys) pipeline.get(kvCacheKey(namespace, key));
        const results = await pipeline.exec();
        return keys.map((_key, index) => {
            const entry = results?.[index];
            if (!entry || entry[0]) return null;
            return (entry[1] as string | null) ?? null;
        });
    }

    /**
     * Cache what a read just fetched. `keys` is what was asked of the
     * underlying store, so a key with no entry in `items` is cached as a known
     * absence.
     */
    #cachePopulate(params: {
        namespace: string;
        keys: string[];
        items: KvCachedItem[];
        readUnitsPerKey: number;
        startedAt: number;
    }): void {
        // A write that landed during this read left a block marker, and `NX`
        // below is what keeps the pre-write value out — but only for as long as
        // the marker lives. A read slower than that can no longer show its value
        // is the current one, so it doesn't get to cache it.
        if (Date.now() - params.startedAt > this.#cache.blockSeconds * 1000) {
            return;
        }

        const now = Date.now() / 1000;
        const byKey = new Map(params.items.map((item) => [item.key, item]));
        const writes: Array<{ key: string; payload: string; ttl: number }> = [];

        for (const key of params.keys) {
            const item = byKey.get(key);
            const ttl = item
                ? cacheTtlSecondsFor(this.#cache, item.ttl, now)
                : this.#cache.missTtlSeconds;
            if (ttl === null) continue;
            const payload = item
                ? encodeCachedHit(item, params.readUnitsPerKey)
                : encodeCachedMiss(params.readUnitsPerKey);
            if (
                Buffer.byteLength(payload, 'utf8') > this.#cache.maxEntryBytes
            ) {
                continue;
            }
            writes.push({
                key: kvCacheKey(params.namespace, key),
                payload,
                ttl,
            });
        }
        if (writes.length === 0) return;

        // Deliberately not awaited: a read shouldn't wait on its own cache fill.
        const pipeline = this.clients.redis.pipeline();
        for (const { key, payload, ttl } of writes) {
            pipeline.set(key, payload, 'EX', ttl, 'NX');
        }
        void Promise.resolve(pipeline.exec()).catch((e: unknown) => {
            console.warn(
                '[kv] read cache populate failed:',
                (e as Error).message,
            );
        });
    }

    /**
     * Post-commit fan-out for one mutation: drop the cached reads it made
     * wrong, then say on the bus that it happened.
     *
     * Every mutating method ends here, and the announcement sits outside the
     * cache's own guard — whether this install caches reads says nothing about
     * whether anyone subscribed to the change.
     */
    async #committed(
        actor: Actor,
        namespace: string,
        keys: string[],
        op: KvMutation,
        values?: unknown[],
        noShareKeys?: string[],
    ): Promise<void> {
        await this.#invalidate(namespace, keys);
        this.#emitMutation(actor, namespace, keys, op, values, noShareKeys);
    }

    /**
     * A flush is a namespace-level marker rather than a per-key fan-out: its
     * own key enumeration is truncated for a large namespace, so the keys it
     * names are not the keys it removed.
     */
    #emitMutation(
        actor: Actor,
        namespace: string,
        keys: string[],
        op: KvMutation,
        values?: unknown[],
        noShareKeys?: string[],
    ): void {
        // Internal system data has no subscribable subject, and it is written
        // often enough that the emit itself would be the cost.
        if (isSystemActor(actor)) return;
        const userId = actor.user?.id;
        if (typeof userId !== 'number') return;

        try {
            if (op === 'flush') {
                this.clients.event.emit(
                    'kv.flushed',
                    { namespace, userId },
                    {},
                );
                return;
            }
            if (keys.length === 0) return;
            const unique = [...new Set(keys)];
            this.clients.event.emit(
                'kv.mutated',
                {
                    namespace,
                    userId,
                    keys: unique,
                    op,
                    // Callers hand values aligned with `keys`; a deduped set
                    // would misalign them, so only a dedupe-free batch carries.
                    ...(values && unique.length === keys.length
                        ? { values }
                        : {}),
                    ...(noShareKeys?.length
                        ? { noShareKeys: [...new Set(noShareKeys)] }
                        : {}),
                    ...(actor.handlerDepth
                        ? { handlerDepth: actor.handlerDepth }
                        : {}),
                },
                {},
            );
        } catch {
            // A change nobody hears about is not a failed write.
        }
    }

    /**
     * Stop serving cached reads for `keys`, here and in every peer region.
     *
     * Awaited for the local part so a caller's own next read can't be answered
     * from the cache it just made wrong; the broadcast is fire-and-forget.
     */
    async #invalidate(namespace: string, keys: string[]): Promise<void> {
        if (!this.#cacheable(namespace) || keys.length === 0) return;
        const cacheKeys = [...new Set(keys)].map((key) =>
            kvCacheKey(namespace, key),
        );
        await this.publishCacheKeys({
            keys: cacheKeys,
            serializedData: KV_CACHE_BLOCK_MARKER,
            ttlSeconds: this.#cache.blockSeconds,
        });
        this.#queueInvalidationBroadcast(cacheKeys);
    }

    /**
     * Accumulate invalidations and send them as one message.
     *
     * Every broadcast is serialized twice on the way out — once to dedupe it,
     * once to sign it — and a per-write message would pay both plus its own
     * envelope for a single cache key. Batching keeps a write-heavy namespace
     * from turning the cache into a net cost.
     */
    #queueInvalidationBroadcast(cacheKeys: string[]): void {
        for (const key of cacheKeys) this.#pendingInvalidations.add(key);

        if (this.#cache.broadcastCoalesceMs === 0) {
            this.#flushInvalidationBroadcast();
            return;
        }
        if (this.#invalidationTimer) return;
        this.#invalidationTimer = setTimeout(() => {
            this.#invalidationTimer = null;
            this.#flushInvalidationBroadcast();
        }, this.#cache.broadcastCoalesceMs);
        this.#invalidationTimer.unref?.();
    }

    #flushInvalidationBroadcast(): void {
        if (this.#pendingInvalidations.size === 0) return;
        const cacheKeys = [...this.#pendingInvalidations];
        this.#pendingInvalidations.clear();

        for (let i = 0; i < cacheKeys.length; i += KV_CACHE_BROADCAST_CHUNK) {
            this.clients.event.emit(
                'outer.kv.cacheInvalidated',
                {
                    cacheKeys: cacheKeys.slice(i, i + KV_CACHE_BROADCAST_CHUNK),
                },
                {},
            );
        }
    }

    /**
     * Apply invalidations a peer region sent us.
     *
     * A marker, not a delete, and for the local block window rather than
     * anything the sender named: the entry reaches this region's copy of the
     * underlying store on its own schedule, so the point is to keep reads going
     * through until it has.
     */
    #subscribeRemoteInvalidations(): void {
        this.clients.event.on(
            'outer.kv.cacheInvalidated',
            (_key, data, meta) => {
                // Our own emit reaches local listeners too, and the local half
                // of the invalidation already ran before it went out.
                if (!(meta as { from_outside?: boolean })?.from_outside) return;

                const cacheKeys =
                    (data as { cacheKeys?: unknown })?.cacheKeys ?? [];
                if (!Array.isArray(cacheKeys)) return;
                const keys = cacheKeys.filter(
                    (key): key is string =>
                        typeof key === 'string' && key !== '',
                );
                if (keys.length === 0) return;

                void this.publishCacheKeys({
                    keys,
                    serializedData: KV_CACHE_BLOCK_MARKER,
                    ttlSeconds: this.#cache.blockSeconds,
                });
            },
        );
    }

    // -- Reserved items -----------------------------------------------
    //
    // Platform bookkeeping that happens to live in this table and is not
    // anyone's key-value data. Reserved items sit in the system namespace under
    // their own key prefix, so the driver can never address one, and they go
    // straight to the table: no usage is returned because nothing is billed, no
    // read cache is consulted or invalidated, and no mutation event is emitted
    // — a reserved item is not a change to a namespace anyone can subscribe to.

    /** One reserved item, or `null`. Eventually consistent, which is enough. */
    async getReservedItem<T extends object>(key: string): Promise<T | null> {
        assertKey(key);
        const response = await this.clients.dynamo.get(this.tableName, {
            namespace: SYSTEM_NAMESPACE,
            key,
        });
        return (response.Item as T | undefined) ?? null;
    }

    /**
     * Reserved items whose key starts with `prefix`, in the system namespace.
     * One page only: today's one caller (presence) is bounded by
     * deployed-region count. Expired rows are excluded the same way `list`
     * excludes them, so a caller never sees one the table's own sweep has not
     * reclaimed yet.
     */
    async queryReservedItems<T extends Record<string, unknown>>(
        prefix: string,
    ): Promise<T[]> {
        const now = Date.now() / 1000;
        const response = await this.clients.dynamo.query(
            this.tableName,
            { namespace: SYSTEM_NAMESPACE },
            0,
            undefined,
            '',
            false,
            { beginsWith: { key: 'key', value: prefix } },
        );
        return ((response.Items ?? []) as T[]).filter(
            (item) => !item.ttl || (item.ttl as number) > now,
        );
    }

    /**
     * Unconditional put of one whole reserved item. Safe without a condition
     * only because every caller's key already names the one writer allowed to
     * touch it (presence's key carries the writing region), so there is no
     * concurrent writer to race.
     */
    async putReservedItem(
        key: string,
        attributes: Record<string, unknown>,
    ): Promise<void> {
        assertKey(key);
        // Identity last: an attribute named `key` or `namespace` must not be
        // able to redirect the write at some other item.
        await this.clients.dynamo.put(this.tableName, {
            ...attributes,
            namespace: SYSTEM_NAMESPACE,
            key,
        });
    }

    /**
     * Unconditional update of one reserved item, creating it when missing:
     * `set` attributes are written outright, `setIfAbsent` ones only where the
     * item does not already carry them (a retired but unswept row keeps its
     * value). Same trust model as `putReservedItem` — callers gate the write.
     */
    async refreshReservedItem(
        key: string,
        set: Record<string, unknown>,
        setIfAbsent: Record<string, unknown> = {},
    ): Promise<void> {
        assertKey(key);
        const names: Record<string, string> = {};
        const values: Record<string, unknown> = {};
        const setParts: string[] = [];
        let idx = 0;
        for (const [attr, value] of Object.entries(set)) {
            const nameToken = `#r${idx}`;
            const valueToken = `:r${idx}`;
            names[nameToken] = attr;
            values[valueToken] = value;
            setParts.push(`${nameToken} = ${valueToken}`);
            idx++;
        }
        for (const [attr, value] of Object.entries(setIfAbsent)) {
            const nameToken = `#r${idx}`;
            const valueToken = `:r${idx}`;
            names[nameToken] = attr;
            values[valueToken] = value;
            setParts.push(
                `${nameToken} = if_not_exists(${nameToken}, ${valueToken})`,
            );
            idx++;
        }
        if (setParts.length === 0) return;

        await this.clients.dynamo.update(
            this.tableName,
            { namespace: SYSTEM_NAMESPACE, key },
            `SET ${setParts.join(', ')}`,
            values,
            names,
        );
    }

    /**
     * Expire one reserved item, conditional on an attribute the caller read
     * still holding. False means the condition lost the race (or the item never
     * existed) — an answer, not an error. Readers treat an expired `ttl` as
     * absent and the table's own sweep reclaims the row; the sentinel is `1`
     * because a falsy `ttl` reads as "no expiry".
     */
    async retireReservedItemIf(
        key: string,
        condition: string,
        conditionValues: Record<string, unknown>,
        conditionNames: Record<string, string> = {},
    ): Promise<boolean> {
        assertKey(key);
        try {
            await this.clients.dynamo.update(
                this.tableName,
                { namespace: SYSTEM_NAMESPACE, key },
                'SET #ttl = :expired',
                { ...conditionValues, ':expired': 1 },
                { ...conditionNames, '#ttl': 'ttl' },
                { condition },
            );
            return true;
        } catch (err) {
            if (isConditionRefused(err)) return false;
            throw err;
        }
    }

    // -- Public API ---------------------------------------------------

    /**
     * Refuse a cross-app mutation against a private entry. Not atomic with the
     * write that follows, so one in-flight write can still land on an entry the
     * owner flags in between.
     */
    async #assertNotPrivate(
        namespace: string,
        key: string,
        opts?: KVOpts,
    ): Promise<KVUsage> {
        if (!isCrossApp(opts)) return emptyUsage();
        let response = await this.clients.dynamo.get(this.tableName, {
            namespace,
            key,
        });
        let usage = readUsage(
            response.ConsumedCapacity?.CapacityUnits as number | undefined,
        );
        // An expired flag no longer applies, but a stale read could be wrong
        // — confirm with a consistent one before trusting it.
        if (
            response.Item?.[KV_PRIVATE_ATTR] &&
            isExpiredTtl(response.Item.ttl, Date.now() / 1000)
        ) {
            response = await this.clients.dynamo.get(
                this.tableName,
                { namespace, key },
                true,
            );
            usage = addUsage(
                usage,
                readUsage(
                    response.ConsumedCapacity?.CapacityUnits as
                        | number
                        | undefined,
                ),
            );
        }
        if (
            response.Item?.[KV_PRIVATE_ATTR] &&
            !isExpiredTtl(response.Item.ttl, Date.now() / 1000)
        ) {
            throw new HttpError(
                403,
                'kv: this entry is private to the app that wrote it',
                { legacyCode: 'forbidden' },
            );
        }
        // Returned rather than swallowed: the probe is a real read, and a caller
        // that did not pay for it is under-billed for the operation.
        return usage;
    }

    /**
     * The batch form: one batched read for every key rather than a round trip
     * each, which would turn a single batched write into N+1 calls.
     */
    async #assertNonePrivate(
        namespace: string,
        keys: string[],
        opts?: KVOpts,
    ): Promise<KVUsage> {
        if (!isCrossApp(opts) || keys.length === 0) return emptyUsage();
        const { entries, usage } = await this.getBatches(namespace, keys);
        const now = Date.now() / 1000;

        // Same race as the single-key form: confirm any private-and-expired
        // entries with a consistent read before trusting them.
        const staleKeys = new Set(
            entries
                .filter(
                    (entry) => entry?.noShare && isExpiredTtl(entry.ttl, now),
                )
                .map((entry) => entry.key),
        );
        let confirmedEntries: (KvCachedItem | null)[] = entries;
        let recheckUsage = emptyUsage();
        if (staleKeys.size > 0) {
            const rechecked = await this.getBatches(
                namespace,
                [...staleKeys],
                true,
            );
            recheckUsage = rechecked.usage;
            const byKey = new Map(
                rechecked.entries.map((entry) => [entry.key, entry]),
            );
            // A key rechecked but no longer found is gone, not stale — never
            // fall back to what the first, uncertain read said about it.
            confirmedEntries = entries.map((entry) =>
                staleKeys.has(entry.key)
                    ? (byKey.get(entry.key) ?? null)
                    : entry,
            );
        }

        // An expired row's flag no longer applies — nothing left to hide.
        const isPrivate = confirmedEntries.some(
            (entry) => entry?.noShare && !isExpiredTtl(entry.ttl, now),
        );
        if (isPrivate) {
            throw new HttpError(
                403,
                'kv: this entry is private to the app that wrote it',
                { legacyCode: 'forbidden' },
            );
        }
        return addUsage(usage, recheckUsage);
    }

    /**
     * Deletes a row that has expired but not been swept, so a write can build
     * on a clean slate. A refused delete means another writer got there first,
     * or the row's `ttl` isn't a number, which `#settleLegacyTtl` deals with.
     */
    async #dropIfExpired(namespace: string, key: string): Promise<KVUsage> {
        try {
            const response = await this.clients.dynamo.del(
                this.tableName,
                { namespace, key },
                { condition: expiredRowFilter(Date.now() / 1000) },
            );
            return writeUsage(
                (response.ConsumedCapacity?.CapacityUnits as
                    | number
                    | undefined) ?? 1,
            );
        } catch (e) {
            if (!isConditionRefused(e)) throw e;
            return addUsage(
                writeUsage(1),
                await this.#settleLegacyTtl(namespace, key),
            );
        }
    }

    /**
     * A `ttl` stored as text or a boolean: delete the row if reads already
     * treat it as expired, else store the same expiry as a number (or drop a
     * `ttl` with no numeric reading). Conditioned on that exact `ttl`, so a row
     * another writer has changed since is left alone.
     */
    async #settleLegacyTtl(namespace: string, key: string): Promise<KVUsage> {
        const read = await this.clients.dynamo.get(
            this.tableName,
            { namespace, key },
            true,
        );
        let usage = readUsage(
            read.ConsumedCapacity?.CapacityUnits as number | undefined,
        );
        const ttl: unknown = read.Item?.ttl;
        if (ttl === undefined || ttl === null || typeof ttl === 'number')
            return usage;

        const condition = '#ttl = :legacyTtl';
        const names = { '#ttl': 'ttl' };
        try {
            let units: number | undefined;
            if (isExpiredTtl(ttl, Date.now() / 1000)) {
                const response = await this.clients.dynamo.del(
                    this.tableName,
                    { namespace, key },
                    {
                        condition: {
                            expression: condition,
                            names,
                            values: { ':legacyTtl': ttl },
                        },
                    },
                );
                units = response.ConsumedCapacity?.CapacityUnits as
                    | number
                    | undefined;
            } else {
                const expiry = ttlNumber(ttl);
                const keep = Number.isFinite(expiry) && expiry !== 0;
                const response = await this.clients.dynamo.update(
                    this.tableName,
                    { namespace, key },
                    keep ? 'SET #ttl = :ttl' : 'REMOVE #ttl',
                    {
                        ':legacyTtl': ttl,
                        ...(keep ? { ':ttl': expiry } : {}),
                    },
                    names,
                    { condition },
                );
                units = response.ConsumedCapacity?.CapacityUnits as
                    | number
                    | undefined;
            }
            usage = addUsage(usage, writeUsage(units ?? 1));
        } catch (e) {
            if (!isConditionRefused(e)) throw e;
            usage = addUsage(usage, writeUsage(1));
        }
        return usage;
    }

    /**
     * Drops a stale expired row, or settles a legacy `ttl`, and retries the
     * write. After the last attempt, throws a retryable 503 instead of the raw
     * refusal.
     */
    async #writeLiveOrMissing<R>(
        namespace: string,
        key: string,
        write: () => Promise<R>,
    ): Promise<{ response: R; resetUsage: KVUsage }> {
        let resetUsage = emptyUsage();
        for (let attempt = 1; ; attempt++) {
            try {
                return { response: await write(), resetUsage };
            } catch (e) {
                if (!isConditionRefused(e)) throw e;
                if (attempt >= MAX_LIVE_WRITE_ATTEMPTS) {
                    // A caller can trigger this via contention, so it must
                    // stay a retryable 503, not a 4xx, and must not page.
                    throw new HttpError(
                        503,
                        'kv: too many writers are contending for this key right now; try again',
                        {
                            legacyCode: 'response_timeout',
                            cause: e,
                            noAlarm: true,
                        },
                    );
                }
                resetUsage = addUsage(
                    resetUsage,
                    addUsage(
                        writeUsage(1),
                        await this.#dropIfExpired(namespace, key),
                    ),
                );
            }
        }
    }

    async get(
        {
            key,
            consistentRead,
        }: { key: string | string[]; consistentRead?: boolean },
        opts?: KVOpts,
    ): Promise<KVResult<unknown | null | (unknown | null)[]>> {
        const actor = ensureActor(opts);
        const namespace = getNamespace(actor, opts);
        const crossApp = isCrossApp(opts);
        const multi = Array.isArray(key);
        const keys = multi ? key : [key];

        for (const k of keys) assertKey(k);

        let kvEntries: KvCachedItem[] = [];
        let usage = emptyUsage();

        // A consistent read is asking for the source of truth by definition.
        const useCache = !consistentRead && this.#cacheable(namespace);
        // Deduped so a key repeated in a batch is looked up — and charged for —
        // once, matching what `getBatches` already does.
        const wanted = [...new Set(keys)];
        let toFetch = wanted;

        if (useCache) {
            const cached = await this.#cacheRead(namespace, wanted);
            kvEntries = cached.items;
            usage = addUsage(usage, cachedReadUsage(cached.readUnits));
            toFetch = wanted.filter((k) => !cached.resolved.has(k));
        }

        if (toFetch.length > 0) {
            const startedAt = Date.now();
            let fetched: KvCachedItem[];
            let fetchUnits: number;

            if (multi) {
                const { entries, usage: u } = await this.getBatches(
                    namespace,
                    toFetch,
                );
                fetched = entries;
                fetchUnits = u.read;
            } else {
                const response = await this.clients.dynamo.get(
                    this.tableName,
                    { namespace, key: toFetch[0] },
                    consistentRead,
                );
                fetched = response.Item ? [response.Item as KvCachedItem] : [];
                fetchUnits = Number(
                    (response.ConsumedCapacity?.CapacityUnits as
                        | number
                        | undefined) ?? 0,
                );
            }

            kvEntries = kvEntries.concat(fetched);
            usage = addUsage(usage, readUsage(fetchUnits));

            if (useCache) {
                // Capacity is reported per call, not per item, so a cached read
                // replays the batch's average rather than an exact figure.
                this.#cachePopulate({
                    namespace,
                    keys: toFetch,
                    items: fetched,
                    readUnitsPerKey: fetchUnits / toFetch.length,
                    startedAt,
                });
            }
        }

        const now = Date.now() / 1000;
        const values = keys.map((k) => {
            const entry = kvEntries.find((e) => e.key === k);
            if (!entry) return null;
            if (isExpiredTtl(entry.ttl, now)) return null;
            // Absent rather than refused: the flag must not confirm the key.
            if (crossApp && entry.noShare) return null;
            return entry.value ?? null;
        });

        return { res: multi ? values : values[0], usage };
    }

    async set(
        {
            key,
            value,
            expireAt,
            disableSharing,
        }: {
            key: string;
            value: unknown;
            /** `null` or `0` (like the omitted case) mean no expiry. */
            expireAt?: number | null;
            /**
             * Mark the entry private. `put` replaces the item, so omitting it
             * on a later write is how the owner re-shares the entry.
             */
            disableSharing?: boolean;
        },
        opts?: KVOpts,
    ): Promise<KVResult<boolean>> {
        assertKey(key);
        assertValue(value);
        const ttl = coerceExpiry(expireAt, 'expireAt');
        const actor = ensureActor(opts);
        const namespace = getNamespace(actor, opts);
        const probeUsage = await this.#assertNotPrivate(namespace, key, opts);

        let response: Awaited<ReturnType<typeof this.clients.dynamo.put>>;
        try {
            response = await this.clients.dynamo.put(this.tableName, {
                namespace,
                key,
                value,
                ...(ttl ? { ttl: storedExpiry(ttl) } : {}),
                ...(disableSharing ? { [KV_PRIVATE_ATTR]: true } : {}),
            });
        } catch (e) {
            if (isNestingTooDeep(e)) throw tooDeeplyNestedError(undefined, e);
            throw e;
        }
        await this.#committed(
            actor,
            namespace,
            [key],
            'set',
            [value],
            disableSharing ? [key] : undefined,
        );

        return {
            res: true,
            usage: addUsage(
                probeUsage,
                writeUsage(
                    response.ConsumedCapacity?.CapacityUnits as
                        | number
                        | undefined,
                ),
            ),
        };
    }

    async batchPut(
        {
            items,
            disableSharing,
        }: {
            items: Array<{
                key: string;
                value: unknown;
                /** `null` or `0` (like the omitted case) mean no expiry. */
                expireAt?: number | null;
            }>;
            /**
             * Marks every entry in the batch private, as `set` does for one.
             * Batch-wide rather than per-item: it arrives on the same trailing
             * options object the single form takes.
             */
            disableSharing?: boolean;
        },
        opts?: KVOpts,
    ): Promise<KVResult<boolean>> {
        if (!Array.isArray(items) || items.length === 0) {
            return { res: true, usage: emptyUsage() };
        }

        const byKey = new Map<
            string,
            { key: string; value: unknown; expireAt?: number | null }
        >();
        for (const item of items) {
            const k = String(item.key);
            assertKey(k);
            assertValue(item.value);
            byKey.set(k, {
                key: k,
                value: item.value,
                expireAt: coerceExpiry(item.expireAt, 'expireAt'),
            });
        }

        const actor = ensureActor(opts);
        const namespace = getNamespace(actor, opts);

        // One private key refuses the batch — no partial success to probe with.
        const probeUsage = await this.#assertNonePrivate(
            namespace,
            [...byKey.keys()],
            opts,
        );

        const putParams = Array.from(byKey.values()).map((item) => ({
            table: this.tableName,
            item: {
                namespace,
                key: item.key,
                value: item.value,
                ...(item.expireAt ? { ttl: storedExpiry(item.expireAt) } : {}),
                ...(disableSharing ? { [KV_PRIVATE_ATTR]: true } : {}),
            },
        }));

        let response: Awaited<ReturnType<typeof this.clients.dynamo.batchPut>>;
        try {
            response = await this.clients.dynamo.batchPut(putParams);
        } catch (e) {
            if (isNestingTooDeep(e)) throw tooDeeplyNestedError(undefined, e);
            throw e;
        }
        await this.#committed(
            actor,
            namespace,
            [...byKey.keys()],
            'set',
            [...byKey.values()].map((item) => item.value),
            disableSharing ? [...byKey.keys()] : undefined,
        );
        const units =
            response.ConsumedCapacity?.reduce(
                (acc, curr) => acc + Number(curr.CapacityUnits ?? 0),
                0,
            ) ?? byKey.size;

        return {
            res: true,
            usage: addUsage(probeUsage, writeUsage(units || byKey.size)),
        };
    }

    async del(
        { key }: { key: string },
        opts?: KVOpts,
    ): Promise<KVResult<boolean>> {
        const actor = ensureActor(opts);
        const namespace = getNamespace(actor, opts);
        const probeUsage = await this.#assertNotPrivate(namespace, key, opts);

        // The old item is only worth reading back for the private-key check,
        // which a system write never needs an event for anyway.
        const response = await this.clients.dynamo.del(
            this.tableName,
            { namespace, key },
            { returnOld: !isSystemActor(actor) },
        );
        await this.#committed(
            actor,
            namespace,
            [key],
            'del',
            [null],
            privateKeys(key, response.Attributes),
        );
        return {
            res: true,
            usage: addUsage(
                probeUsage,
                writeUsage(
                    (response.ConsumedCapacity?.CapacityUnits as
                        | number
                        | undefined) ?? 1,
                ),
            ),
        };
    }

    /**
     * Delete a key and return what it held — an atomic claim. However many
     * callers race the same key, exactly one gets the value; the rest get
     * null.
     */
    async take(
        { key }: { key: string },
        opts?: KVOpts,
    ): Promise<KVResult<unknown | null>> {
        assertKey(key);
        const actor = ensureActor(opts);
        const namespace = getNamespace(actor, opts);
        const probeUsage = await this.#assertNotPrivate(namespace, key, opts);

        const response = await this.clients.dynamo.del(
            this.tableName,
            { namespace, key },
            { returnOld: true },
        );
        await this.#committed(
            actor,
            namespace,
            [key],
            'del',
            [null],
            privateKeys(key, response.Attributes),
        );

        const old = response.Attributes as
            | { value?: unknown; ttl?: number }
            | undefined;
        const now = Date.now() / 1000;
        const res =
            old === undefined || isExpiredTtl(old.ttl, now)
                ? null
                : (old.value ?? null);

        return {
            res,
            usage: addUsage(
                probeUsage,
                writeUsage(
                    (response.ConsumedCapacity?.CapacityUnits as
                        | number
                        | undefined) ?? 1,
                ),
            ),
        };
    }

    async batchDel(
        { keys }: { keys: string[] },
        opts?: KVOpts,
    ): Promise<KVResult<boolean>> {
        if (!Array.isArray(keys) || keys.length === 0) {
            return { res: true, usage: emptyUsage() };
        }

        const unique = new Set<string>();
        for (const key of keys) {
            const k = String(key);
            assertKey(k);
            unique.add(k);
        }
        const uniqueKeys = [...unique];

        const actor = ensureActor(opts);
        const namespace = getNamespace(actor, opts);

        // One private key refuses the batch — same posture as batchPut:
        // no partial success to probe with.
        const probeUsage = await this.#assertNonePrivate(
            namespace,
            uniqueKeys,
            opts,
        );

        const response = await this.clients.dynamo.batchDel(
            uniqueKeys.map((key) => ({
                table: this.tableName,
                key: { namespace, key },
            })),
        );
        await this.#committed(
            actor,
            namespace,
            uniqueKeys,
            'del',
            uniqueKeys.map((): unknown => null),
            // A batch delete reports no prior state, so a same-app batch is
            // marked private wholesale; a cross-app caller was already
            // refused any private key.
            isCrossApp(opts) ? undefined : uniqueKeys,
        );
        const units =
            response.ConsumedCapacity?.reduce(
                (acc, curr) => acc + Number(curr.CapacityUnits ?? 0),
                0,
            ) ?? unique.size;

        return {
            res: true,
            usage: addUsage(probeUsage, writeUsage(units || unique.size)),
        };
    }

    async list(
        {
            as,
            limit,
            cursor,
            pattern,
            offset,
            includeTotal,
            fetchUntilFull,
            reverse,
        }: {
            as?: 'keys' | 'values' | 'entries';
            limit?: number;
            cursor?: string | Record<string, unknown>;
            pattern?: string;
            offset?: number;
            includeTotal?: boolean;
            fetchUntilFull?: boolean;
            reverse?: boolean;
        },
        opts?: KVOpts,
    ): Promise<
        KVResult<
            | string[]
            | unknown[]
            | { key: string; value: unknown }[]
            | {
                  items:
                      | string[]
                      | unknown[]
                      | { key: string; value: unknown }[];
                  cursor?: string;
                  total?: number;
              }
        >
    > {
        const actor = ensureActor(opts);
        const namespace = getNamespace(actor, opts);

        const normalizedLimit = normalizeLimit(limit, { label: 'kv: limit' });
        const normalizedOffset = normalizeOffset(offset, {
            cap: MAX_LIST_OFFSET,
            label: 'kv: offset',
        });
        if (reverse !== undefined && typeof reverse !== 'boolean') {
            throw new HttpError(400, 'kv: reverse must be a boolean', {
                legacyCode: 'bad_request',
            });
        }
        const decodedCursor = decodeCursor(cursor, 'kv: cursor');
        let pageKey = decodedCursor;
        let cursorReverse = false;
        if (decodedCursor !== undefined) {
            if (
                !decodedCursor ||
                typeof decodedCursor !== 'object' ||
                Array.isArray(decodedCursor)
            ) {
                throw new HttpError(400, 'invalid kv: cursor', {
                    legacyCode: 'bad_request',
                });
            }
            if (Object.hasOwn(decodedCursor, 'reverse')) {
                if (
                    decodedCursor.reverse !== true ||
                    !decodedCursor.key ||
                    typeof decodedCursor.key !== 'object' ||
                    Array.isArray(decodedCursor.key) ||
                    Object.keys(decodedCursor.key).length === 0
                ) {
                    throw new HttpError(400, 'invalid kv: cursor', {
                        legacyCode: 'bad_request',
                    });
                }
                cursorReverse = true;
                pageKey = decodedCursor.key as Record<string, unknown>;
            }
            if (reverse !== undefined && reverse !== cursorReverse) {
                throw new HttpError(
                    400,
                    'kv: reverse conflicts with cursor direction',
                    {
                        legacyCode: 'bad_request',
                    },
                );
            }
        }
        const effectiveReverse = reverse ?? cursorReverse;
        const normalizedPattern = normalizePattern(pattern);

        if (pageKey !== undefined && normalizedOffset !== undefined) {
            throw new HttpError(
                400,
                'kv: cursor and offset cannot be combined',
                {
                    legacyCode: 'bad_request',
                },
            );
        }
        if (fetchUntilFull && normalizedLimit === undefined) {
            throw new HttpError(400, 'kv: fetchUntilFull requires limit', {
                legacyCode: 'bad_request',
            });
        }

        const kind = as ?? 'entries';
        if (!['keys', 'values', 'entries'].includes(kind)) {
            throw new HttpError(
                400,
                'kv: list "as" must be keys, values, or entries',
                { legacyCode: 'bad_request' },
            );
        }

        const paginated =
            normalizedLimit !== undefined ||
            pageKey !== undefined ||
            normalizedOffset !== undefined ||
            includeTotal === true ||
            fetchUntilFull === true;

        const now = Date.now() / 1000;
        let usage = emptyUsage();
        const runQuery = async (
            qLimit: number,
            startKey?: Record<string, unknown>,
            select?: 'COUNT',
        ) => {
            const response = await this.clients.dynamo.query(
                this.tableName,
                { namespace },
                qLimit,
                startKey,
                '',
                false,
                {
                    scanIndexForward: !effectiveReverse,
                    ...(normalizedPattern
                        ? {
                              beginsWith: {
                                  key: 'key',
                                  value: normalizedPattern,
                              },
                          }
                        : {}),
                    filter: listFilter(now, isCrossApp(opts)),
                    ...(select ? { select } : {}),
                },
            );
            usage = addUsage(
                usage,
                readUsage(
                    (response.ConsumedCapacity?.CapacityUnits as
                        | number
                        | undefined) ?? 1,
                ),
            );
            return response;
        };

        // Offset emulation: COUNT queries advance the page key past the
        // skipped rows without transferring item data. Cost is still
        // proportional to the offset — cursors are the cheap path.
        let startKey = pageKey;
        let exhausted = false;
        if (normalizedOffset !== undefined && normalizedOffset > 0) {
            let remaining = normalizedOffset;
            while (remaining > 0) {
                const skip = await runQuery(remaining, startKey, 'COUNT');
                remaining -= Number(skip.Count ?? 0);
                startKey = skip.LastEvaluatedKey as
                    | Record<string, unknown>
                    | undefined;
                if (!startKey) {
                    exhausted = remaining > 0;
                    break;
                }
            }
        }

        const collected: Array<Record<string, unknown>> = [];
        let nextKey = startKey;
        if (!exhausted) {
            let pages = 0;
            do {
                const want = normalizedLimit
                    ? normalizedLimit - collected.length
                    : 0;
                const response = await runQuery(want, nextKey);
                collected.push(
                    ...((response.Items ?? []) as Array<
                        Record<string, unknown>
                    >),
                );
                nextKey = response.LastEvaluatedKey as
                    | Record<string, unknown>
                    | undefined;
                pages++;
                if (normalizedLimit === undefined) {
                    // Legacy full listing: follow continuation pages so the
                    // result is complete rather than capped at one response.
                    if (!nextKey) break;
                } else if (
                    !fetchUntilFull ||
                    collected.length >= normalizedLimit ||
                    !nextKey ||
                    pages >= MAX_FILL_PAGES
                ) {
                    break;
                }
            } while (true);
        }

        const entries = collected
            .filter((e) => e && !isExpiredTtl(e.ttl, now))
            .map((e) => ({ key: e.key as string, value: e.value }));

        let items: string[] | unknown[] | { key: string; value: unknown }[] =
            entries;
        if (kind === 'keys') items = entries.map((e) => e.key);
        else if (kind === 'values') items = entries.map((e) => e.value);

        if (!paginated) return { res: items, usage };

        let total: number | undefined;
        // The query filter can't read a legacy text or boolean ttl as a
        // number, so such a row past its expiry is counted until a write
        // settles it.
        if (includeTotal) {
            total = 0;
            let countKey: Record<string, unknown> | undefined;
            do {
                const counted = await runQuery(0, countKey, 'COUNT');
                total += Number(counted.Count ?? 0);
                countKey = counted.LastEvaluatedKey as
                    | Record<string, unknown>
                    | undefined;
            } while (countKey);
        }

        const nextCursor = encodeCursor(
            nextKey && effectiveReverse
                ? { reverse: true, key: nextKey }
                : nextKey,
        );
        return {
            res: {
                items,
                ...(nextCursor ? { cursor: nextCursor } : {}),
                ...(total !== undefined ? { total } : {}),
            },
            usage,
        };
    }

    async flush(opts?: KVOpts): Promise<KVResult<boolean>> {
        const actor = ensureActor(opts);
        const namespace = getNamespace(actor, opts);

        const response = await this.clients.dynamo.query(this.tableName, {
            namespace,
        });
        let usage = readUsage(
            response.ConsumedCapacity?.CapacityUnits as number | undefined,
        );

        const entries = response.Items ?? [];
        // One BatchWriteItem fan-out (25-item chunks with retries inside the
        // client) instead of an unbounded Promise.all of single deletes.
        // Failure posture matches the old per-item loop: log and fall through
        // to invalidation — a partial flush must still drop cached reads for
        // every key the query saw.
        let deleteUnits = 0;
        if (entries.length > 0) {
            try {
                const deleted = await this.clients.dynamo.batchDel(
                    entries.map((entry) => ({
                        table: this.tableName,
                        key: { namespace, key: entry.key },
                    })),
                );
                deleteUnits =
                    deleted.ConsumedCapacity?.reduce(
                        (acc, curr) => acc + Number(curr.CapacityUnits ?? 0),
                        0,
                    ) ?? 0;
            } catch (e) {
                console.error('[kv] flush batch delete failed', e);
            }
        }
        usage = addUsage(usage, writeUsage(deleteUnits));

        // Exactly the keys the query saw, which is also exactly what was
        // deleted — anything a truncated query missed is still there to read.
        await this.#committed(
            actor,
            namespace,
            entries.map((entry) => String(entry.key)),
            'flush',
        );

        return { res: true, usage };
    }

    async expireAt(
        { key, timestamp }: { key: string; timestamp: number },
        opts?: KVOpts,
    ): Promise<KVResult<boolean>> {
        assertKey(key);
        const ts = Number(timestamp);
        if (Number.isNaN(ts))
            throw new HttpError(400, 'kv: timestamp must be a number', {
                legacyCode: 'bad_request',
            });
        const actor = ensureActor(opts);
        const namespace = getNamespace(actor, opts);
        const probeUsage = await this.#assertNotPrivate(namespace, key, opts);
        const { usage, isPrivate } = await this.rawExpireAt(namespace, key, ts);
        await this.#committed(
            actor,
            namespace,
            [key],
            'expire',
            undefined,
            isPrivate ? [key] : undefined,
        );
        return { res: true, usage: addUsage(probeUsage, usage) };
    }

    async expire(
        { key, ttl }: { key: string; ttl: number },
        opts?: KVOpts,
    ): Promise<KVResult<boolean>> {
        assertKey(key);
        const seconds = Number(ttl);
        if (Number.isNaN(seconds))
            throw new HttpError(400, 'kv: ttl must be a number', {
                legacyCode: 'bad_request',
            });
        const actor = ensureActor(opts);
        const namespace = getNamespace(actor, opts);
        const probeUsage = await this.#assertNotPrivate(namespace, key, opts);
        const timestamp = Math.floor(Date.now() / 1000) + seconds;
        const { usage, isPrivate } = await this.rawExpireAt(
            namespace,
            key,
            timestamp,
        );
        await this.#committed(
            actor,
            namespace,
            [key],
            'expire',
            undefined,
            isPrivate ? [key] : undefined,
        );
        return { res: true, usage: addUsage(probeUsage, usage) };
    }

    async incr<T extends Record<string, number>>(
        {
            key,
            pathAndAmountMap,
            expireAt,
        }: { key: string; pathAndAmountMap: T; expireAt?: number | null },
        opts?: KVOpts,
    ): Promise<
        KVResult<T extends { '': number } ? number : RecursiveRecord<number>>
    > {
        assertKey(key);
        if (!pathAndAmountMap || Object.keys(pathAndAmountMap).length === 0)
            throw new HttpError(400, 'kv: incr requires pathAndAmountMap', {
                legacyCode: 'bad_request',
            });
        if (
            Object.values(pathAndAmountMap).some((v) => typeof v !== 'number')
        ) {
            throw new HttpError(
                400,
                'kv: all values in pathAndAmountMap must be numbers',
                { legacyCode: 'bad_request' },
            );
        }
        const paths = Object.keys(pathAndAmountMap);
        const pathTokens = parsePaths(paths);
        assertDisjointPaths(paths, pathTokens);
        const expiry = coerceExpiry(expireAt, 'expireAt');

        const actor = ensureActor(opts);
        const namespace = getNamespace(actor, opts);

        const probeUsage = await this.#assertNotPrivate(namespace, key, opts);

        const renderer = new PathExpressionRenderer();
        const setStatements = pathTokens.map((tokens, idx) =>
            incrSetStatement(tokens, idx, renderer),
        );
        const valueAttributeValues: Record<string, unknown> = Object.entries(
            pathAndAmountMap,
        ).reduce(
            (acc, [_path, amt], idx) => {
                acc[`:incr${idx}`] = amt;
                acc[`:start${idx}`] = 0;
                return acc;
            },
            {} as Record<string, unknown>,
        );

        // Fold the TTL into the same UpdateItem so a counter bump is a single
        // write instead of incr + a separate expireAt. if_not_exists keeps the
        // first stamp for the key (re-stamping the same value was always a
        // no-op) — but now we don't pay for that extra write on every bump.
        if (expiry !== null) {
            setStatements.push('#ttl = if_not_exists(#ttl, :ttl)');
            valueAttributeValues[':ttl'] = storedExpiry(expiry);
            renderer.names['#ttl'] = 'ttl';
        }

        const updateExpression = `SET ${setStatements.join(', ')}`;
        // Only applies to a writable (or missing) row — a stale expired one,
        // or a legacy row whose ttl a condition can't read, refuses so the
        // caller settles it instead of building on top of it.
        const runUpdate = () => {
            const live = writableRowFilter(Date.now() / 1000);
            return this.clients.dynamo.update(
                this.tableName,
                { key, namespace },
                updateExpression,
                { ...valueAttributeValues, ...live.values },
                { ...renderer.names, ...live.names },
                { condition: live.expression },
            );
        };

        // Most increments land on an item whose parent maps already exist (a
        // day's counter is created once, then bumped on every event), so try
        // the update directly and only pay for createPaths when a nested
        // parent is genuinely missing — typically the first bump for a key.
        let resetUsage: KVUsage;
        let response: Awaited<ReturnType<typeof runUpdate>>;
        let createPathsUsage: KVUsage;
        try {
            const outcome = await this.#writeLiveOrMissing(namespace, key, () =>
                this.withCreatePathsFallback(
                    namespace,
                    key,
                    'incr',
                    paths,
                    pathTokens,
                    runUpdate,
                ),
            );
            resetUsage = outcome.resetUsage;
            response = outcome.response.response;
            createPathsUsage = outcome.response.createPathsUsage;
        } catch (e) {
            throw pathWriteError(e, 'incr', key, paths);
        }
        await this.#committed(
            actor,
            namespace,
            [key],
            'set',
            [response.Attributes?.value],
            privateKeys(key, response.Attributes),
        );

        const usage = addUsage(
            probeUsage,
            addUsage(
                resetUsage,
                addUsage(
                    writeUsage(
                        Number(response.ConsumedCapacity?.CapacityUnits ?? 0),
                    ),
                    createPathsUsage,
                ),
            ),
        );

        return { res: response.Attributes?.value, usage };
    }

    async decr<T extends Record<string, number>>(
        { key, pathAndAmountMap }: { key: string; pathAndAmountMap: T },
        opts?: KVOpts,
    ): Promise<
        KVResult<T extends { '': number } ? number : RecursiveRecord<number>>
    > {
        const negated = Object.fromEntries(
            Object.entries(pathAndAmountMap).map(([k, v]) => [k, -v]),
        ) as T;
        return this.incr({ key, pathAndAmountMap: negated }, opts);
    }

    async add(
        {
            key,
            pathAndValueMap,
        }: { key: string; pathAndValueMap: Record<string, unknown> },
        opts?: KVOpts,
    ): Promise<KVResult<unknown>> {
        assertKey(key);
        if (!pathAndValueMap || Object.keys(pathAndValueMap).length === 0) {
            throw new HttpError(400, 'kv: add requires pathAndValueMap', {
                legacyCode: 'bad_request',
            });
        }
        const paths = Object.keys(pathAndValueMap);
        const pathTokens = parsePaths(paths);
        // An appended scalar is wrapped into a one-element list, landing one
        // level inside it; an appended array lands at the list itself.
        Object.values(pathAndValueMap).forEach((val, i) =>
            assertValue(
                val,
                (Array.isArray(val) ? 1 : 2) + pathTokens[i].length,
                paths[i],
            ),
        );
        assertDisjointPaths(paths, pathTokens);

        const actor = ensureActor(opts);
        const namespace = getNamespace(actor, opts);

        const probeUsage = await this.#assertNotPrivate(namespace, key, opts);
        // Reject incompatible paths before any write, not only on the fallback.
        planCreatePaths(pathTokens);

        const renderer = new PathExpressionRenderer();
        const setStatements = pathTokens.map((tokens, idx) => {
            const attrName = renderer.path(tokens);
            return `${attrName} = list_append(if_not_exists(${attrName}, :emptyList${idx}), :append${idx})`;
        });
        const valueAttributeValues = Object.entries(pathAndValueMap).reduce(
            (acc, [_path, val], idx) => {
                acc[`:append${idx}`] = Array.isArray(val) ? val : [val];
                acc[`:emptyList${idx}`] = [];
                return acc;
            },
            {} as Record<string, unknown>,
        );
        // Only applies to a writable (or missing) row — a stale expired one,
        // or a legacy row whose ttl a condition can't read, refuses so the
        // caller settles it instead of building on top of it.
        const runUpdate = () => {
            const live = writableRowFilter(Date.now() / 1000);
            return this.clients.dynamo.update(
                this.tableName,
                { key, namespace },
                `SET ${setStatements.join(', ')}`,
                { ...valueAttributeValues, ...live.values },
                { ...renderer.names, ...live.names },
                { condition: live.expression },
            );
        };

        let resetUsage: KVUsage;
        let response: Awaited<ReturnType<typeof runUpdate>>;
        let createPathsUsage: KVUsage;
        try {
            const outcome = await this.#writeLiveOrMissing(namespace, key, () =>
                this.withCreatePathsFallback(
                    namespace,
                    key,
                    'add',
                    paths,
                    pathTokens,
                    runUpdate,
                ),
            );
            resetUsage = outcome.resetUsage;
            response = outcome.response.response;
            createPathsUsage = outcome.response.createPathsUsage;
        } catch (e) {
            throw pathWriteError(e, 'add', key, paths);
        }
        await this.#committed(
            actor,
            namespace,
            [key],
            'set',
            [response.Attributes?.value],
            privateKeys(key, response.Attributes),
        );

        const usage = addUsage(
            probeUsage,
            addUsage(
                resetUsage,
                addUsage(
                    writeUsage(
                        Number(response.ConsumedCapacity?.CapacityUnits ?? 0),
                    ),
                    createPathsUsage,
                ),
            ),
        );

        return { res: response.Attributes?.value, usage };
    }

    async remove(
        { key, paths }: { key: string; paths: string[] },
        opts?: KVOpts,
    ): Promise<KVResult<unknown>> {
        assertKey(key);
        if (!paths || paths.length === 0) {
            throw new HttpError(400, 'kv: remove requires paths', {
                legacyCode: 'bad_request',
            });
        }
        const pathTokens = parsePaths(paths);
        assertDisjointPaths(paths, pathTokens);

        // The root takes the whole value with it; a REMOVE would leave the
        // key holding nothing.
        if (pathTokens.length === 1 && pathTokens[0].length === 0) {
            const { usage } = await this.del({ key }, opts);
            return { res: null, usage };
        }

        const actor = ensureActor(opts);
        const namespace = getNamespace(actor, opts);

        const probeUsage = await this.#assertNotPrivate(namespace, key, opts);

        const renderer = new PathExpressionRenderer();
        const removeStatements = pathTokens.map((tokens) =>
            renderer.path(tokens),
        );
        const live = liveRowFilter(Date.now() / 1000);

        try {
            const response = await this.clients.dynamo.update(
                this.tableName,
                { key, namespace },
                `REMOVE ${removeStatements.join(', ')}`,
                live.values,
                { ...renderer.names, ...live.names },
                { condition: live.expression },
            );
            const units =
                (response.ConsumedCapacity?.CapacityUnits as
                    | number
                    | undefined) ?? 1;
            // A legacy ttl the condition couldn't read: the row was already expired.
            const removedTtl = response.Attributes?.ttl;
            if (
                typeof removedTtl !== 'number' &&
                isExpiredTtl(removedTtl, Date.now() / 1000)
            ) {
                return {
                    res: null,
                    usage: addUsage(probeUsage, writeUsage(units)),
                };
            }
            await this.#committed(
                actor,
                namespace,
                [key],
                'set',
                [response.Attributes?.value],
                privateKeys(key, response.Attributes),
            );
            return {
                res: response.Attributes?.value,
                usage: addUsage(probeUsage, writeUsage(units)),
            };
        } catch (e) {
            // An expired row reads as missing — nothing to remove from, and
            // no retry: unlike the other writes, there is nothing to build.
            if (isConditionRefused(e)) {
                return {
                    res: null,
                    usage: addUsage(probeUsage, writeUsage(1)),
                };
            }
            if (isInvalidDocumentPath(e)) {
                // A path that isn't there has nothing to remove.
                const fallback = await this.get({ key }, opts);
                return {
                    res: fallback.res,
                    usage: addUsage(
                        probeUsage,
                        addUsage(fallback.usage, writeUsage(1)),
                    ),
                };
            }
            throw pathWriteError(e, 'remove', key, paths);
        }
    }

    async update(
        {
            key,
            pathAndValueMap,
            ttl,
        }: {
            key: string;
            pathAndValueMap: Record<string, unknown>;
            /**
             * Seconds from now. Omit it, or pass `''`/`false`, to keep the
             * key's TTL; `null` removes it.
             */
            ttl?: number | null;
        },
        opts?: KVOpts,
    ): Promise<KVResult<unknown>> {
        assertKey(key);
        if (!pathAndValueMap || Object.keys(pathAndValueMap).length === 0) {
            throw new HttpError(400, 'kv: update requires pathAndValueMap', {
                legacyCode: 'bad_request',
            });
        }
        const paths = Object.keys(pathAndValueMap);
        const pathTokens = parsePaths(paths);
        Object.values(pathAndValueMap).forEach((val, i) =>
            assertValue(val, 1 + pathTokens[i].length, paths[i]),
        );
        assertDisjointPaths(paths, pathTokens);
        const ttlSeconds = coerceTtlSeconds(ttl);

        const actor = ensureActor(opts);
        const namespace = getNamespace(actor, opts);
        const probeUsage = await this.#assertNotPrivate(namespace, key, opts);
        // Reject incompatible paths before any write, not only on the fallback.
        planCreatePaths(pathTokens);

        const renderer = new PathExpressionRenderer();
        const setStatements = pathTokens.map((tokens, idx) => {
            const attrName = renderer.path(tokens);
            return `${attrName} = :value${idx}`;
        });
        const valueAttributeValues: Record<string, unknown> = Object.entries(
            pathAndValueMap,
        ).reduce(
            (acc, [_path, val], idx) => {
                acc[`:value${idx}`] = val;
                return acc;
            },
            {} as Record<string, unknown>,
        );
        let removeTtl = false;
        if (ttlSeconds === null) {
            removeTtl = true;
            renderer.names['#ttl'] = 'ttl';
        } else if (ttlSeconds !== undefined) {
            const timestamp = storedExpiry(
                Math.floor(Date.now() / 1000) + ttlSeconds,
            );
            setStatements.push('#ttl = :ttl');
            valueAttributeValues[':ttl'] = timestamp;
            renderer.names['#ttl'] = 'ttl';
        }
        const baseExpression = `SET ${setStatements.join(', ')}${
            removeTtl ? ' REMOVE #ttl' : ''
        }`;

        // Only applies to a writable (or missing) row — a stale expired one,
        // or a legacy row whose ttl a condition can't read, refuses so the
        // caller settles it instead of building on top of it.
        const runUpdate = () => {
            const live = writableRowFilter(Date.now() / 1000);
            return this.clients.dynamo.update(
                this.tableName,
                { key, namespace },
                baseExpression,
                { ...valueAttributeValues, ...live.values },
                { ...renderer.names, ...live.names },
                { condition: live.expression },
            );
        };

        let resetUsage: KVUsage;
        let response: Awaited<ReturnType<typeof runUpdate>>;
        let createPathsUsage: KVUsage;
        try {
            const outcome = await this.#writeLiveOrMissing(namespace, key, () =>
                this.withCreatePathsFallback(
                    namespace,
                    key,
                    'update',
                    paths,
                    pathTokens,
                    runUpdate,
                ),
            );
            resetUsage = outcome.resetUsage;
            response = outcome.response.response;
            createPathsUsage = outcome.response.createPathsUsage;
        } catch (e) {
            throw pathWriteError(e, 'update', key, paths);
        }

        await this.#committed(
            actor,
            namespace,
            [key],
            'set',
            [response.Attributes?.value],
            privateKeys(key, response.Attributes),
        );

        const usage = addUsage(
            probeUsage,
            addUsage(
                resetUsage,
                addUsage(
                    writeUsage(
                        Number(response.ConsumedCapacity?.CapacityUnits ?? 0),
                    ),
                    createPathsUsage,
                ),
            ),
        );

        return { res: response.Attributes?.value, usage };
    }

    // -- Internals ----------------------------------------------------

    private async getBatches(
        namespace: string,
        allKeys: string[],
        consistentRead = false,
    ): Promise<{
        entries: KvCachedItem[];
        usage: KVUsage;
    }> {
        const batches: string[][] = [];
        for (let i = 0; i < allKeys.length; i += KV_BATCH_GET_LIMIT) {
            batches.push(allKeys.slice(i, i + KV_BATCH_GET_LIMIT));
        }

        const results = await runWithConcurrencyLimit(
            batches,
            KV_BATCH_GET_CONCURRENCY,
            async (keys) => {
                const requests = [...new Set(keys)].map((k) => ({
                    table: this.tableName,
                    items: { namespace, key: k },
                }));
                const response = await this.clients.dynamo.batchGet(
                    requests,
                    consistentRead,
                );
                const entries = (response.Responses?.[this.tableName] ??
                    []) as unknown as KvCachedItem[];
                const units =
                    response.ConsumedCapacity?.reduce(
                        (acc, curr) => acc + Number(curr.CapacityUnits ?? 0),
                        0,
                    ) ?? 0;
                return { entries, units };
            },
        );

        return results.reduce(
            (acc, curr) => {
                acc.entries.push(...curr.entries);
                acc.usage.read += curr.units;
                return acc;
            },
            {
                entries: [] as KvCachedItem[],
                usage: emptyUsage(),
            },
        );
    }

    /**
     * Sets `ttl`, defaulting a missing value to `null` — a reset always writes
     * a fresh marker rather than reviving the old value.
     */
    private async rawExpireAt(
        namespace: string,
        key: string,
        timestamp: number,
    ): Promise<{ usage: KVUsage; isPrivate: boolean }> {
        const runUpdate = () => {
            const live = writableRowFilter(Date.now() / 1000);
            return this.clients.dynamo.update(
                this.tableName,
                { key, namespace },
                'SET #ttl = :ttl, #value = if_not_exists(#value, :defaultValue)',
                {
                    ':ttl': storedExpiry(timestamp),
                    ':defaultValue': null,
                    ...live.values,
                },
                { '#ttl': 'ttl', '#value': 'value', ...live.names },
                { condition: live.expression },
            );
        };
        const { response, resetUsage } = await this.#writeLiveOrMissing(
            namespace,
            key,
            runUpdate,
        );
        return {
            usage: addUsage(
                resetUsage,
                writeUsage(
                    (response.ConsumedCapacity?.CapacityUnits as
                        | number
                        | undefined) ?? 1,
                ),
            ),
            isPrivate: Boolean(response.Attributes?.[KV_PRIVATE_ATTR]),
        };
    }

    /**
     * Try `runUpdate`; on a ValidationException (typically a missing parent
     * container), reads the stored value once to refuse an inapplicable path
     * before writing anything, else creates the missing containers and retries
     * once. An oversized expression, a type mismatch, an item already at the
     * size cap, or nesting past the store's limit is rethrown: createPaths
     * can't fix any of them, and each of its writes costs the whole item.
     */
    private async withCreatePathsFallback<R>(
        namespace: string,
        key: string,
        op: 'add' | 'update' | 'incr',
        paths: string[],
        pathList: PathToken[][],
        runUpdate: () => Promise<R>,
    ): Promise<{ response: R; createPathsUsage: KVUsage }> {
        try {
            return {
                response: await runUpdate(),
                createPathsUsage: emptyUsage(),
            };
        } catch (e) {
            const err = e as Error;
            if (err?.name !== 'ValidationException') throw e;
            if (
                isOversizedExpression(err) ||
                isTypeMismatch(err) ||
                isItemTooLarge(err) ||
                isNestingTooDeep(err)
            )
                throw e;
        }

        // Plan against what's stored, so a path that can't apply is refused
        // before any container is written.
        const current = await this.clients.dynamo.get(
            this.tableName,
            { namespace, key },
            true,
        );
        let usage = readUsage(
            current.ConsumedCapacity?.CapacityUnits as number | undefined,
        );
        const item = current.Item;
        const stored =
            item && !isExpiredTtl(item.ttl, Date.now() / 1000)
                ? item.value
                : undefined;
        const unfit = findUnfitPaths(stored, pathList, op);
        if (unfit.path.length > 0)
            throw unfitPathsError(
                key,
                unfit.path.map((i) => paths[i]),
                true,
            );
        if (unfit.type.length > 0)
            throw op === 'incr'
                ? notANumberError()
                : notAListError(
                      key,
                      unfit.type.map((i) => paths[i]),
                      true,
                  );

        try {
            usage = addUsage(
                usage,
                writeUsage(await this.createPaths(namespace, key, pathList)),
            );
            return { response: await runUpdate(), createPathsUsage: usage };
        } catch (e) {
            // createPaths may have committed containers before this failed.
            await this.#invalidate(namespace, [key]);
            throw e;
        }
    }

    /**
     * Create missing parent containers and return write units consumed. Indexed
     * ancestors must already exist. The root skeleton goes first (for a key
     * with no value it creates everything), then one write per depth,
     * shallowest first, split only where the expression budget requires.
     */
    private async createPaths(
        namespace: string,
        key: string,
        pathList: PathToken[][],
    ): Promise<number> {
        const plan = planCreatePaths(pathList);
        if (!plan.nestedMapValue) return 0;

        // Guarded like every other write here, so a lapsed row refuses
        // instead of raising a raw document-path error.
        const rootRenderer = new PathExpressionRenderer();
        const rootAttr = rootRenderer.path([]);
        const rootLive = writableRowFilter(Date.now() / 1000);
        const rootResponse = await this.clients.dynamo.update(
            this.tableName,
            { key, namespace },
            `SET ${rootAttr} = if_not_exists(${rootAttr}, :nestedMap)`,
            { ':nestedMap': plan.nestedMapValue, ...rootLive.values },
            { ...rootRenderer.names, ...rootLive.names },
            { condition: rootLive.expression },
        );
        let writeUnits = Number(
            rootResponse.ConsumedCapacity?.CapacityUnits ?? 0,
        );
        if (objectsEqual(rootResponse.Attributes?.value, plan.nestedMapValue)) {
            return writeUnits;
        }

        for (const depthEntries of plan.layers) {
            const batches = chunkByExpressionBytes(
                depthEntries,
                createPathsLayerExpressionBytes,
                INCR_EXPRESSION_BUDGET_BYTES,
            );
            for (const batch of batches) {
                const renderer = new PathExpressionRenderer();
                const expressionValues: Record<string, unknown> = {};
                const setStatements = batch.map((entry, idx) => {
                    expressionValues[`:empty${idx}`] =
                        entry.containerType === 'index' ? [] : {};
                    return createPathsSetStatement(entry, idx, renderer);
                });
                const live = writableRowFilter(Date.now() / 1000);
                const response = await this.clients.dynamo.update(
                    this.tableName,
                    { key, namespace },
                    `SET ${setStatements.join(', ')}`,
                    { ...expressionValues, ...live.values },
                    { ...renderer.names, ...live.names },
                    { condition: live.expression },
                );
                writeUnits += Number(
                    response.ConsumedCapacity?.CapacityUnits ?? 0,
                );
            }
        }
        return writeUnits;
    }
}
