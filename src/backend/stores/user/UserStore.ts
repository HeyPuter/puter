import { PuterStore } from '../types';

// ── Types ────────────────────────────────────────────────────────────

/**
 * Canonical user row. Typed fields cover everything auth/acl/quota code
 * actually reads; `[k: string]: unknown` keeps the escape hatch for
 * lesser-used columns the store doesn't surface yet.
 *
 * Note: `suspended` / `email_confirmed` / `requires_email_confirmation` come
 * off the DB as MySQL TINYINT or SQLite INTEGER — 0 or 1. We coerce to
 * booleans in `#normalizeRow` so downstream code gets consistent types.
 */
export interface UserRow {
    id: number;
    uuid: string;
    username: string;
    email?: string | null;
    /** True when an admin has suspended the account. */
    suspended?: boolean;
    /** True when the user has confirmed the email currently on file. */
    email_confirmed?: boolean;
    /** True for accounts that must confirm email before taking most actions. */
    requires_email_confirmation?: boolean;
    /** Metadata JSON blob; decoded on read when the DB returns it as a string. */
    metadata?: Record<string, unknown>;
    [k: string]: unknown;
}

/**
 * Identifying properties the store will look users up by. Adding a new
 * property is as simple as adding a key here — lookups + cache fan-out
 * follow automatically.
 */
export const USER_ID_PROPERTIES = ['id', 'uuid', 'username', 'email'] as const;
export type UserIdProperty = (typeof USER_ID_PROPERTIES)[number];

// ── Constants ────────────────────────────────────────────────────────

const CACHE_KEY_PREFIX = 'users';
const CACHE_TTL_SECONDS = 15 * 60;
// Cap on placeholders per `IN (?, ?, …)` query. SQLite's default parameter
// limit is 999; staying well under that keeps `getByIds` portable across
// backends without splitting the cap by driver.
const BULK_QUERY_CHUNK_SIZE = 200;

// ── UserStore ────────────────────────────────────────────────────────

/**
 * Persistence + cache for the `user` table. Provides a multi-key Redis cache
 * over property-indexed lookups and thin `user`-table accessors.
 *
 * Intentionally NOT folded in:
 * - `generate_default_fsentries` (filesystem concern; belongs with FS)
 * - `whoami.get_details` enrichment (service-level, not store)
 * - runtime identifying-property registration — the identifying properties
 *   are declared inline in `USER_ID_PROPERTIES`; callers that need more
 *   add the property to that tuple.
 */
export class UserStore extends PuterStore {
    // ── Reads ────────────────────────────────────────────────────────

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
     * MGET, and resolves remaining misses with a single
     * `SELECT … WHERE id IN (…)` per chunk. Use this in place of
     * `Promise.all(ids.map(getById))` to avoid one connection per row on
     * large id sets.
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
     * Look up a user by the canonical `clean_email` column. Used by signup
     * and OIDC link flows to collapse gmail-style aliases (`foo.bar+tag@…`)
     * to the same account.
     *
     * Not cached — `clean_email` isn't an identifying property and callers
     * use this for duplicate detection at write time, which needs fresh
     * reads. Rehydrates through `getById` so the caller gets a normalized
     * row (and warms the id-keyed cache for subsequent reads).
     */
    async getByCleanEmail(cleanEmailValue: string): Promise<UserRow | null> {
        if (!cleanEmailValue) return null;
        const rows = (await this.clients.db.tryHardRead(
            'SELECT `id` FROM `user` WHERE `clean_email` = ? LIMIT 1',
            [cleanEmailValue],
        )) as Array<{ id: number }>;
        const row = rows[0];
        if (!row) return null;
        return this.getById(row.id as number);
    }

    /**
     * Generic property lookup. Fast-path reads redis first (cache is
     * multi-key — every identifying property points at the same serialized
     * row). On miss, falls back to DB and backfills the cache.
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

        // Replication-aware read: on `force`, go straight to the primary
        // (`pread`) to bypass replica lag for hot reads (e.g., immediately
        // after a signup). Otherwise `tryHardRead` parallels primary +
        // replica and prefers whichever returns rows.
        const sql = `SELECT * FROM \`user\` WHERE \`${prop}\` = ? LIMIT 1`;
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

    // ── Writes ───────────────────────────────────────────────────────

    /**
     * Merge-update a user's `metadata` JSON blob. Reads current value,
     * applies `Object.assign` semantics, and writes back. Invalidates
     * every cache key pointing at this user on success.
     */
    /**
     * Create a new user row.
     *
     * Returns the created user (by id). Password must already be hashed.
     * Pass `null` for temporary users (no email, no password).
     */
    async create(fields: {
        username: string;
        uuid: string;
        password: string | null;
        email: string | null;
        clean_email?: string | null;
        free_storage?: number | null;
        requires_email_confirmation?: boolean;
        email_confirm_code?: string | null;
        email_confirm_token?: string | null;
        audit_metadata?: Record<string, unknown> | null;
        signup_ip?: string | null;
        signup_ip_forwarded?: string | null;
        signup_user_agent?: string | null;
        signup_origin?: string | null;
    }): Promise<UserRow> {
        const result = await this.clients.db.write(
            `INSERT INTO \`user\`
            (username, email, clean_email, password, uuid, free_storage,
             requires_email_confirmation, email_confirm_code, email_confirm_token,
             audit_metadata, signup_ip, signup_ip_forwarded,
             signup_user_agent, signup_origin)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                fields.username,
                fields.email,
                fields.clean_email ?? null,
                fields.password,
                fields.uuid,
                fields.free_storage ?? null,
                fields.requires_email_confirmation ? 1 : 0,
                fields.email_confirm_code ?? null,
                fields.email_confirm_token ?? null,
                fields.audit_metadata
                    ? JSON.stringify(fields.audit_metadata)
                    : null,
                fields.signup_ip ?? null,
                fields.signup_ip_forwarded ?? null,
                fields.signup_user_agent ?? null,
                fields.signup_origin ?? null,
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
     * Only pass whitelisted columns — this uses string interpolation for
     * column names for ergonomic call sites. Never take column names from
     * request bodies.
     */
    async update(
        userId: number,
        patch: Record<string, unknown>,
    ): Promise<void> {
        const keys = Object.keys(patch);
        if (keys.length === 0) return;

        const setClause = keys.map((k) => `\`${k}\` = ?`).join(', ');
        const values = keys.map((k) => patch[k]);

        await this.clients.db.write(
            `UPDATE \`user\` SET ${setClause} WHERE \`id\` = ?`,
            [...values, userId],
        );

        const fresh = await this.getByProperty('id', userId, { force: true });
        if (fresh) {
            await this.#refreshCache({ ...fresh, ...patch });
        } else {
            await this.invalidateById(userId);
        }
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

    async invalidate(user: UserRow): Promise<void> {
        const keys = this.#cacheKeysForUser(user);
        await this.publishCacheKeys({ keys });
    }

    /** Invalidate by id — fetches the cached row first so we know all its keys. */
    async invalidateById(id: number): Promise<void> {
        const cached = await this.#readCache('id', id);
        if (cached) await this.invalidate(cached);
    }

    // ── Internals ────────────────────────────────────────────────────

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
        const keys = this.#cacheKeysForUser(user);
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
        const keys = this.#cacheKeysForUser(user);
        if (keys.length === 0) return;
        await this.publishCacheKeys({
            keys,
            serializedData: JSON.stringify(user),
            ttlSeconds: CACHE_TTL_SECONDS,
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
            metadata,
        };
    }
}
