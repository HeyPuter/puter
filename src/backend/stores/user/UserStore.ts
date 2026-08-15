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

import { cleanEmail } from '../../util/email.js';
import { PuterStore } from '../types';

// -- Types ------------------------------------------------------------

/**
 * Canonical user row. Typed fields cover everything auth/acl/quota code
 * actually reads; `[k: string]: unknown` keeps the escape hatch for lesser-used
 * columns the store doesn't surface yet.
 *
 * Note: `suspended` / `email_confirmed` / `requires_email_confirmation` come
 * off the DB as MySQL TINYINT or SQLite INTEGER — 0 or 1. We coerce to booleans
 * in `#normalizeRow` so downstream code gets consistent types.
 */
export interface UserRow {
    id: number;
    uuid: string;
    username: string;
    email?: string | null;
    /** True when an admin has suspended the account. */
    suspended?: boolean;
    /**
     * When the account was suspended, as unix seconds; null while not
     * suspended.
     */
    suspended_at?: number | null;
    /** True when the user has confirmed the email currently on file. */
    email_confirmed?: boolean;
    /** True for accounts that must confirm email before taking most actions. */
    requires_email_confirmation?: boolean;
    /** Metadata JSON blob; decoded on read when the DB returns it as a string. */
    metadata?: Record<string, unknown>;
    /** Abuse v2 reputation score recorded at signup (DB default 100). */
    reputation?: number;
    /** E.164 phone number collected during SMS verification. */
    phone?: string | null;
    /** True while the account must complete SMS phone verification before use. */
    requires_phone_verification?: boolean;
    /** True while the account must complete credit-card verification before use. */
    requires_card_verification?: boolean;
    /**
     * Payment-provider fingerprint of the card this account verified with —
     * stable per card, written only on a successful check. Its presence is what
     * "this account verified a card" reads off; null for accounts that never
     * did.
     */
    card_fingerprint?: string | null;
    password?: string;
    [k: string]: unknown;
}

/**
 * Identifying properties the store will look users up by. Adding a new property
 * is as simple as adding a key here — lookups + cache fan-out follow
 * automatically.
 */
export const USER_ID_PROPERTIES = ['id', 'uuid', 'username', 'email'] as const;
export type UserIdProperty = (typeof USER_ID_PROPERTIES)[number];

// -- Constants --------------------------------------------------------

const CACHE_KEY_PREFIX = 'users';
const CACHE_TTL_SECONDS = 15 * 60;
// Tie-break for address lookups that can match more than one row. An address is
// "owned" by a confirmed account, or failing that by one holding a password;
// everything else is an unconfirmed placeholder that anyone may still claim.
// Ordering by that precedence (then by age) makes every guard, login and
// recovery resolve the same address to the same row.
const EMAIL_OWNER_ORDER =
    'ORDER BY `email_confirmed` DESC, (`password` IS NOT NULL) DESC, `id` ASC';

/**
 * Unique index backing "at most one row owns an address". Application checks
 * race — two signups can both read "address is free" and both insert — so this
 * is the only thing that actually holds the invariant. Writes that can lose
 * that race have to recognise the violation and turn it into the same message
 * the pre-check would have produced.
 */
export const OWNED_EMAIL_INDEX = 'idx_user_owned_email';

export const isOwnedEmailConflict = (e: unknown): boolean => {
    const err = e as { code?: string; message?: string } | null;
    if (!err) return false;
    const isUnique =
        err.code === 'ER_DUP_ENTRY' ||
        err.code === '23505' ||
        (typeof err.code === 'string' &&
            err.code.startsWith('SQLITE_CONSTRAINT'));
    if (!isUnique) return false;
    // Other unique columns on `user` (username, uuid, referral_code) raise the
    // same code and must keep their own error handling.
    return (err.message ?? '').includes(OWNED_EMAIL_INDEX);
};
// Cap on placeholders per `IN (?, ?, …)` query. SQLite's default parameter
// limit is 999; staying well under that keeps `getByIds` portable across
// backends without splitting the cap by driver.
const BULK_QUERY_CHUNK_SIZE = 200;

// The `email`, `clean_email`, and `username` columns are latin1_swedish_ci.
// MySQL throws ER_CANT_AGGREGATE_2COLLATIONS on `=` when a utf8mb4 param
// contains any character > U+00FF, since the implicit conversion to latin1
// would lose data. No stored row can match such a value anyway, so we
// short-circuit these lookups at the boundary instead of letting the driver
// surface the collation error.
const isStorableAsLatin1 = (value: string): boolean => {
    for (let i = 0; i < value.length; i++) {
        if (value.charCodeAt(i) > 0xff) return false;
    }
    return true;
};

// Columns on the `user` table that are stored as latin1_swedish_ci. Used by
// both the read path (skip the DB on un-storable lookups) and the write path
// (reject inserts/updates before MySQL throws on conversion).
const LATIN1_USER_COLUMNS: ReadonlySet<string> = new Set([
    'email',
    'username',
    'clean_email',
    'phone',
]);
const USER_BOOLEAN_COLUMNS: ReadonlySet<string> = new Set([
    'requires_email_confirmation',
    'email_confirmed',
    'requires_phone_verification',
    'requires_card_verification',
    'dev_approved_for_incentive_program',
    'dev_joined_incentive_program',
    'suspended',
    'unsubscribed',
    'otp_enabled',
]);

const assertLatin1Writable = (fields: Record<string, unknown>): void => {
    for (const [key, value] of Object.entries(fields)) {
        if (!LATIN1_USER_COLUMNS.has(key)) continue;
        if (typeof value !== 'string') continue;
        if (isStorableAsLatin1(value)) continue;
        const err = new Error(
            `User field '${key}' contains characters outside latin1`,
        );
        (err as { code?: string }).code = 'userFieldNotLatin1';
        throw err;
    }
};

// -- UserStore --------------------------------------------------------

/**
 * Persistence + cache for the `user` table. Provides a multi-key Redis cache
 * over property-indexed lookups and thin `user`-table accessors.
 *
 * Intentionally NOT folded in:
 *
 * - `generate_default_fsentries` (filesystem concern; belongs with FS)
 * - `whoami.get_details` enrichment (service-level, not store)
 * - Runtime identifying-property registration — the identifying properties are
 *   declared inline in `USER_ID_PROPERTIES`; callers that need more add the
 *   property to that tuple.
 */
export class UserStore extends PuterStore {
    // -- Reads --------------------------------------------------------

    async getById(
        id: number,
        opts: { cached?: boolean; force?: boolean } = {},
    ): Promise<UserRow | null> {
        return this.getByProperty('id', id, opts);
    }

    async getByUuid(
        uuid: string,
        opts: { cached?: boolean; force?: boolean } = {},
    ): Promise<UserRow | null> {
        return this.getByProperty('uuid', uuid, opts);
    }

    async getByUsername(
        username: string,
        opts: { cached?: boolean; force?: boolean } = {},
    ): Promise<UserRow | null> {
        return this.getByProperty('username', username, opts);
    }

    async getByEmail(
        email: string,
        opts: { cached?: boolean; force?: boolean } = {},
    ): Promise<UserRow | null> {
        return this.getByProperty('email', email, opts);
    }

    /**
     * Batched lookup by id. Dedupes input ids, reads cache via a pipelined
     * MGET, and resolves remaining misses with a single `SELECT … WHERE id IN
     * (…)` per chunk. Use this in place of `Promise.all(ids.map(getById))` to
     * avoid one connection per row on large id sets.
     *
     * Missing ids (no DB row) are simply absent from the returned map.
     */
    async getByIds(ids: number[]): Promise<Map<number, UserRow>> {
        const result = new Map<number, UserRow>();
        const uniqueIds = [
            ...new Set(
                (Array.isArray(ids) ? ids : []).filter(
                    (id): id is number => typeof id === 'number',
                ),
            ),
        ];
        if (uniqueIds.length === 0) return result;

        const missingIds: number[] = [];
        try {
            const pipeline = this.clients.redis.pipeline();
            for (const id of uniqueIds) {
                pipeline.get(this.#cacheKey('id', id));
            }
            const cacheResults = (await pipeline.exec()) ?? [];
            for (let i = 0; i < uniqueIds.length; i++) {
                const id = uniqueIds[i];
                const raw = cacheResults[i]?.[1];
                if (typeof raw === 'string') {
                    try {
                        result.set(id, JSON.parse(raw) as UserRow);
                        continue;
                    } catch {
                        // Fall through to DB on any parse failure.
                    }
                }
                missingIds.push(id);
            }
        } catch {
            missingIds.push(...uniqueIds);
        }

        for (
            let offset = 0;
            offset < missingIds.length;
            offset += BULK_QUERY_CHUNK_SIZE
        ) {
            const chunk = missingIds.slice(
                offset,
                offset + BULK_QUERY_CHUNK_SIZE,
            );
            const placeholders = chunk.map(() => '?').join(', ');
            const rows = (await this.clients.db.tryHardRead(
                `SELECT * FROM \`user\` WHERE \`id\` IN (${placeholders})`,
                chunk,
            )) as Array<Record<string, unknown>>;
            for (const row of rows) {
                const user = this.#normalizeRow(row);
                result.set(user.id, user);
                this.#writeCache(user).catch(() => {
                    // Best-effort cache backfill.
                });
            }
        }

        return result;
    }

    /**
     * Look up a user by the canonical `clean_email` column. Used by signup and
     * OIDC link flows to collapse gmail-style aliases (`foo.bar+tag@…`) to the
     * same account.
     *
     * Not cached — `clean_email` isn't an identifying property and callers use
     * this for duplicate detection at write time, which needs fresh reads.
     * Rehydrates through `getById` so the caller gets a normalized row (and
     * warms the id-keyed cache for subsequent reads).
     */
    async getByCleanEmail(
        cleanEmailValue: string,
        opts: { force?: boolean } = {},
    ): Promise<UserRow | null> {
        if (!cleanEmailValue) return null;
        if (!isStorableAsLatin1(cleanEmailValue)) return null;
        const sql = `SELECT \`id\` FROM \`user\` WHERE \`clean_email\` = ? ${EMAIL_OWNER_ORDER} LIMIT 1`;
        const rows = (await (opts.force
            ? this.clients.db.pread(sql, [cleanEmailValue])
            : this.clients.db.tryHardRead(sql, [cleanEmailValue]))) as Array<{
            id: number;
        }>;
        const row = rows[0];
        if (!row) return null;
        return this.getById(row.id as number, opts);
    }

    /**
     * Resolve whoever currently holds an address, matching the raw `email`
     * column first and falling back to the canonical `clean_email` so
     * gmail-style aliases (`foo.bar+tag@gmail.com` vs `foobar@gmail.com`)
     * collapse to the same account.
     *
     * This is the single duplicate-detection lookup for every write path that
     * attaches an address to a row (signup, save-account, change-email, OIDC,
     * admin provisioning). Callers decide what to do with the hit: a row that
     * is confirmed or holds a password owns the address and blocks the write;
     * an unconfirmed password-less row is a placeholder the caller may claim.
     *
     * Pass `force` to read the primary. Every caller doing a last-moment
     * re-check before an insert must, or it re-reads the same stale snapshot
     * the first check saw.
     */
    async findEmailOwner(
        email: string,
        opts: { force?: boolean } = {},
    ): Promise<UserRow | null> {
        if (!email) return null;
        const direct = await this.getByEmail(email, { force: opts.force });
        if (direct) return direct;
        return this.getByCleanEmail(cleanEmail(email), opts);
    }

    /**
     * Count accounts other than `excludeUserId` whose confirmed `phone` equals
     * this number. Backs the cap on live accounts per phone number (the row is
     * deleted with the account, so this only counts accounts that still exist —
     * recycling velocity is rate-limited separately by the abuse policy's KV
     * log).
     *
     * Not cached — like `getByCleanEmail`, callers use this for duplicate
     * detection at write time, which needs fresh reads.
     */
    async countOthersByPhone(
        phone: string,
        excludeUserId: number,
    ): Promise<number> {
        if (!phone) return 0;
        if (!isStorableAsLatin1(phone)) return 0;
        const rows = (await this.clients.db.tryHardRead(
            'SELECT COUNT(*) AS n FROM `user` WHERE `phone` = ? AND `id` != ?',
            [phone, excludeUserId],
        )) as Array<{ n: number | string }>;
        return Number(rows[0]?.n) || 0;
    }

    /**
     * Generic property lookup. Fast-path reads redis first (cache is multi-key
     * — every identifying property points at the same serialized row). On miss,
     * falls back to DB and backfills the cache.
     *
     * `force: true` bypasses cache both on read and on replication.
     */
    async getByProperty(
        prop: UserIdProperty,
        value: unknown,
        options: { cached?: boolean; force?: boolean } = {},
    ): Promise<UserRow | null> {
        const cached = options.cached ?? true;
        const force = options.force ?? false;

        if (cached && !force) {
            const hit = await this.#readCache(prop, value);
            if (hit) return hit;
        }

        // Reject lookup values that can't exist in a latin1 column before
        // the driver turns them into a collation-mix error at MySQL.
        if (
            LATIN1_USER_COLUMNS.has(prop) &&
            typeof value === 'string' &&
            !isStorableAsLatin1(value)
        ) {
            return null;
        }

        // Replication-aware read: on `force`, go straight to the primary
        // (`pread`) to bypass replica lag for hot reads (e.g., immediately
        // after a signup). Otherwise `tryHardRead` parallels primary +
        // replica and prefers whichever returns rows.
        // `id`, `uuid` and `username` are UNIQUE, so at most one row matches and
        // the optimizer drops the ordering. `email` is not — multiple rows may
        // legitimately hold the same address while unconfirmed, so without an
        // explicit order the winner is whatever the storage engine hands back
        // first, and login / password recovery would resolve the same address to
        // a different account run to run. Prefer the row that owns the address.
        const sql =
            `SELECT * FROM \`user\` WHERE \`${prop}\` = ?` +
            (prop === 'email' ? ` ${EMAIL_OWNER_ORDER}` : '') +
            ' LIMIT 1';
        const rows = force
            ? await this.clients.db.pread(sql, [value])
            : await this.clients.db.tryHardRead(sql, [value]);
        const row = rows[0];
        if (!row) return null;

        const user = this.#normalizeRow(row);
        // Fire-and-forget cache write — don't block the caller on redis.
        this.#writeCache(user).catch(() => {
            // Best-effort cache; swallow errors.
        });
        return user;
    }

    // -- Writes -------------------------------------------------------

    /**
     * Merge-update a user's `metadata` JSON blob. Reads current value, applies
     * `Object.assign` semantics, and writes back. Invalidates every cache key
     * pointing at this user on success.
     */
    /**
     * Create a new user row.
     *
     * Returns the created user (by id). Password must already be hashed. Pass
     * `null` for temporary users (no email, no password).
     */
    async create(fields: {
        username: string;
        uuid: string;
        password: string | null;
        email: string | null;
        clean_email?: string | null;
        free_storage?: number | null;
        requires_email_confirmation?: boolean;
        /**
         * Set this at insert time for accounts that are confirmed from birth
         * (an identity provider already verified the address). Confirming in a
         * follow-up `update` instead means the insert does not yet own the
         * address, so two concurrent creates both succeed and only collide on
         * the later update — past the point where the caller can cleanly report
         * a duplicate.
         */
        email_confirmed?: boolean;
        email_confirm_code?: string | null;
        email_confirm_token?: string | null;
        audit_metadata?: Record<string, unknown> | null;
        signup_ip?: string | null;
        signup_ip_forwarded?: string | null;
        signup_user_agent?: string | null;
        signup_origin?: string | null;
        signup_server?: string | null;
        referrer?: string | null;
        last_activity_ts?: string | null;
        reputation?: number | null;
        phone?: string | null;
        requires_phone_verification?: boolean;
        requires_card_verification?: boolean;
    }): Promise<UserRow> {
        assertLatin1Writable(fields as Record<string, unknown>);
        const result = await this.clients.db.write(
            `INSERT INTO \`user\`
            (username,
             email,
             clean_email,
             password,
             uuid,
             free_storage,
             requires_email_confirmation,
             email_confirmed,
             email_confirm_code,
             email_confirm_token,
             audit_metadata,
             signup_ip,
             signup_ip_forwarded,
             signup_user_agent,
             signup_origin,
             signup_server,
             referrer,
             last_activity_ts,
             reputation,
             phone,
             requires_phone_verification,
             requires_card_verification)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)${this.clients.db.returningIdClause()}`,
            [
                fields.username,
                fields.email,
                fields.clean_email ?? null,
                fields.password,
                fields.uuid,
                fields.free_storage ?? null,
                this.clients.db.booleanValue(
                    Boolean(fields.requires_email_confirmation),
                ),
                this.clients.db.booleanValue(Boolean(fields.email_confirmed)),
                fields.email_confirm_code ?? null,
                fields.email_confirm_token ?? null,
                fields.audit_metadata
                    ? JSON.stringify(fields.audit_metadata)
                    : null,
                fields.signup_ip ?? null,
                fields.signup_ip_forwarded ?? null,
                fields.signup_user_agent ?? null,
                fields.signup_origin ?? null,
                fields.signup_server ?? null,
                fields.referrer ?? null,
                fields.last_activity_ts ?? null,
                // Default matches the DB column default + v2's STARTING_REPUTATION.
                fields.reputation ?? 100,
                fields.phone ?? null,
                this.clients.db.booleanValue(
                    Boolean(fields.requires_phone_verification),
                ),
                this.clients.db.booleanValue(
                    Boolean(fields.requires_card_verification),
                ),
            ],
        );

        const insertId = (result as unknown as { insertId?: number }).insertId;
        if (!insertId)
            throw new Error('Failed to create user — no insertId returned');

        const user = await this.getById(insertId, { force: true });
        if (!user) throw new Error('Failed to fetch created user');
        return user;
    }

    /**
     * Update arbitrary user fields by id. Invalidates cache on write.
     *
     * Only pass whitelisted columns — this uses string interpolation for column
     * names for ergonomic call sites. Never take column names from request
     * bodies.
     */
    async update(
        userId: number,
        patch: Record<string, unknown>,
    ): Promise<void> {
        await this.#write(userId, patch);
    }

    /**
     * Convert an unconfirmed, password-less placeholder row — the
     * admin-provisioned pre-registration a signup claims instead of inserting a
     * new row.
     *
     * The guard is the whole point. Two signups can both read the row as
     * claimable, and an unguarded `UPDATE` lets the second overwrite the first:
     * the row ends up with the second signup's username and password while the
     * first was already handed a session for it. The unique index cannot catch
     * that — the row already existed, so nothing is inserted and no address
     * changes hands.
     *
     * Returns false when someone claimed the row in between, which the caller
     * reports as a duplicate address.
     */
    async claimPlaceholder(
        userId: number,
        patch: Record<string, unknown>,
    ): Promise<boolean> {
        const unclaimed =
            '`password` IS NULL AND `email_confirmed` = ' +
            this.clients.db.booleanLiteral(false);
        return this.#write(userId, patch, unclaimed);
    }

    /**
     * Shared write path for `update` / `claimPlaceholder`. `guard` is extra SQL
     * ANDed into the WHERE clause; the write is reported as lost when it
     * matches no row.
     */
    async #write(
        userId: number,
        patch: Record<string, unknown>,
        guard?: string,
    ): Promise<boolean> {
        const dbPatch: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(patch)) {
            dbPatch[key] =
                USER_BOOLEAN_COLUMNS.has(key) &&
                value !== null &&
                value !== undefined
                    ? this.clients.db.booleanValue(Boolean(value))
                    : value;
        }

        const keys = Object.keys(dbPatch);
        if (keys.length === 0) return true;

        assertLatin1Writable(dbPatch);

        const setClause = keys.map((k) => `\`${k}\` = ?`).join(', ');
        const values = keys.map((k) => dbPatch[k]);

        // Identifying columns are themselves cache keys, so changing one
        // leaves the old key holding a full copy of the pre-update row.
        // Snapshot the row first so the keys this write retires can be
        // dropped: otherwise a replaced email keeps resolving to the account
        // for the rest of the TTL, and login and password recovery accept it
        // as if it were still the account's address.
        const touchesIdentity = keys.some((k) =>
            (USER_ID_PROPERTIES as readonly string[]).includes(k),
        );
        const before = touchesIdentity
            ? await this.getByProperty('id', userId, { force: true })
            : null;

        const result = await this.clients.db.write(
            `UPDATE \`user\` SET ${setClause} WHERE \`id\` = ?` +
                (guard ? ` AND ${guard}` : ''),
            [...values, userId],
        );

        if (guard) {
            const affected =
                (result as { affectedRows?: number; changes?: number })
                    ?.affectedRows ??
                (result as { affectedRows?: number; changes?: number })
                    ?.changes ??
                0;
            // Nothing was written, so there are no cache keys to retire.
            if (affected === 0) return false;
        }

        const fresh = await this.getByProperty('id', userId, { force: true });

        if (before) {
            // Compare against the keys the refresh below will actually write,
            // not every key the fresh row could be found by: a row that just
            // stopped owning its address keeps the address in its key list but
            // no longer gets cached under it, and the old value would survive.
            const live = new Set(fresh ? this.#cacheKeysToWrite(fresh) : []);
            const retired = this.#cacheKeysForUser(before).filter(
                (key) => !live.has(key),
            );
            if (retired.length > 0) {
                await this.publishCacheKeys({ keys: retired, broadcast: true });
            }
        }

        if (fresh) {
            await this.#refreshCache(fresh);
        } else {
            await this.invalidateById(userId);
        }
        return true;
    }

    async updateMetadata(
        userId: number,
        patch: Record<string, unknown>,
    ): Promise<void> {
        const user = await this.getById(userId);
        const current: Record<string, unknown> = user?.metadata ?? {};
        const merged = { ...current, ...patch };

        await this.clients.db.write(
            'UPDATE `user` SET `metadata` = ? WHERE `id` = ?',
            [JSON.stringify(merged), userId],
        );
        if (user) {
            const refreshed: UserRow = { ...user, metadata: merged };
            await this.#refreshCache(refreshed);
        }
    }

    /**
     * The account other than `userId` that has already confirmed this address,
     * if there is one. Matches raw + canonical, exactly like
     * `unconfirmOthersByEmail`, and is meant to run immediately before it: a
     * confirmed row proved access to the inbox, so it is refused rather than
     * demoted. Everything that lookup leaves behind is an unconfirmed row,
     * which is what `unconfirmOthersByEmail` is for.
     *
     * Reads the primary — the confirmation it guards is about to write.
     */
    async findConfirmedOtherByEmail(
        userId: number,
        email: string,
        cleanEmailValue: string,
    ): Promise<UserRow | null> {
        if (!email) return null;
        const rows = (await this.clients.db.pread(
            'SELECT * FROM `user` WHERE `id` != ? AND (`email` = ? OR `clean_email` = ?) ' +
                `AND \`email_confirmed\` = ${this.clients.db.booleanLiteral(true)} ` +
                'ORDER BY `id` ASC LIMIT 1',
            [userId, email, cleanEmailValue],
        )) as Array<Record<string, unknown>>;
        const row = rows[0];
        return row ? this.#normalizeRow(row) : null;
    }

    async unconfirmOthersByEmail(
        userId: number,
        email: string,
        cleanEmailValue: string,
    ): Promise<void> {
        // Read the rows this strips before stripping them: the update goes
        // straight to SQL, so without their pre-image we don't know which
        // cache keys it retires — and a cached copy still carries the address
        // that was just revoked, which would keep answering lookups for it.
        const stripped = (await this.clients.db.pread(
            'SELECT * FROM `user` WHERE `id` != ? AND (`email` = ? OR `clean_email` = ?)',
            [userId, email, cleanEmailValue],
        )) as Array<Record<string, unknown>>;

        await this.clients.db.write(
            `UPDATE \`user\`
                SET \`email\` = NULL,
                    \`clean_email\` = NULL,
                    \`email_confirmed\` = ?,
                    \`requires_email_confirmation\` = ?,
                    \`email_confirm_code\` = NULL,
                    \`email_confirm_token\` = NULL
              WHERE \`id\` != ?
                AND (\`email\` = ? OR \`clean_email\` = ?)`,
            [
                this.clients.db.booleanValue(false),
                this.clients.db.booleanValue(false),
                userId,
                email,
                cleanEmailValue,
            ],
        );

        for (const row of stripped) {
            await this.invalidate(this.#normalizeRow(row));
        }
    }

    async invalidate(user: UserRow): Promise<void> {
        const keys = this.#cacheKeysForUser(user);
        await this.publishCacheKeys({ keys, broadcast: true });
    }

    /** Invalidate by id — fetches the cached row first so we know all its keys. */
    async invalidateById(id: number): Promise<void> {
        const cached = await this.#readCache('id', id);
        if (cached) await this.invalidate(cached);
    }

    // -- Internals ----------------------------------------------------

    #cacheKey(prop: UserIdProperty, value: unknown): string {
        return `${CACHE_KEY_PREFIX}:${prop}:${String(value)}`;
    }

    #cacheKeysForUser(user: UserRow): string[] {
        const keys: string[] = [];
        for (const prop of USER_ID_PROPERTIES) {
            const value = user[prop];
            if (value === undefined || value === null || value === '') continue;
            keys.push(this.#cacheKey(prop, value));
        }
        return keys;
    }

    /**
     * The subset of `#cacheKeysForUser` that may point _at_ this row. Same
     * keys, minus the address when the row doesn't own it: several rows may
     * hold one address, and `EMAIL_OWNER_ORDER` makes SQL resolve it to the
     * owner. Caching a placeholder under the address would shadow that for the
     * whole TTL, and login and password recovery both resolve an address
     * through the cache.
     *
     * Invalidation deliberately keeps using the full set, so a key written
     * while the row still owned the address is never orphaned.
     */
    #cacheKeysToWrite(user: UserRow): string[] {
        const keys = this.#cacheKeysForUser(user);
        if (user.email_confirmed || user.password != null) return keys;
        const addressKey = this.#cacheKey('email', user.email);
        return keys.filter((key) => key !== addressKey);
    }

    async #readCache(
        prop: UserIdProperty,
        value: unknown,
    ): Promise<UserRow | null> {
        try {
            const raw = await this.clients.redis.get(
                this.#cacheKey(prop, value),
            );
            if (!raw) return null;
            const parsed = JSON.parse(raw) as UserRow;
            // Cached rows were normalized on the write path, so booleans are booleans.
            return parsed;
        } catch {
            return null;
        }
    }

    async #writeCache(user: UserRow): Promise<void> {
        const keys = this.#cacheKeysToWrite(user);
        if (keys.length === 0) return;
        const serialized = JSON.stringify(user);
        await Promise.all(
            keys.map((key) =>
                this.clients.redis.set(
                    key,
                    serialized,
                    'EX',
                    CACHE_TTL_SECONDS,
                ),
            ),
        );
    }

    async #refreshCache(user: UserRow): Promise<void> {
        const keys = this.#cacheKeysToWrite(user);
        if (keys.length === 0) return;
        await this.publishCacheKeys({
            keys,
            serializedData: JSON.stringify(user),
            ttlSeconds: CACHE_TTL_SECONDS,
            broadcast: true,
        });
    }

    /**
     * Coerce raw DB row values into consistent JS types. MySQL returns
     * BOOLEAN/TINYINT as 0|1; SQLite returns INTEGER. JSON columns come as
     * strings on SQLite, parsed objects on MySQL.
     */
    #normalizeRow(row: Record<string, unknown>): UserRow {
        const { referral_code: _referralCode, ...rest } = row;
        const asBool = (v: unknown): boolean | undefined => {
            if (v === null || v === undefined) return undefined;
            if (typeof v === 'boolean') return v;
            if (typeof v === 'number') return v !== 0;
            if (typeof v === 'string')
                return v !== '0' && v.toLowerCase() !== 'false' && v !== '';
            return Boolean(v);
        };

        const metadata = this.clients.db.case<() => Record<string, unknown>>({
            mysql: () => (row.metadata as Record<string, unknown>) ?? {},
            otherwise: () => {
                if (row.metadata == null) return {};
                if (typeof row.metadata === 'object')
                    return row.metadata as Record<string, unknown>;
                try {
                    return JSON.parse(String(row.metadata));
                } catch {
                    return {};
                }
            },
        })();

        return {
            ...rest,
            id: Number(rest.id),
            uuid: String(rest.uuid),
            username: String(rest.username),
            email: rest.email == null ? null : String(rest.email),
            suspended: asBool(rest.suspended),
            email_confirmed: asBool(rest.email_confirmed),
            requires_email_confirmation: asBool(
                rest.requires_email_confirmation,
            ),
            requires_phone_verification: asBool(
                rest.requires_phone_verification,
            ),
            requires_card_verification: asBool(rest.requires_card_verification),
            phone: rest.phone == null ? null : String(rest.phone),
            reputation:
                rest.reputation == null ? undefined : Number(rest.reputation),
            metadata,
        };
    }
}
