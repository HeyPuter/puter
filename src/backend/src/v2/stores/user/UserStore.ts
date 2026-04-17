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
    referral_code?: string | null;
    [k: string]: unknown;
}

/**
 * Identifying properties the store will look users up by. Adding a new
 * property is as simple as adding a key here — lookups + cache fan-out
 * follow automatically.
 */
export const USER_ID_PROPERTIES = ['id', 'uuid', 'username', 'email', 'referral_code'] as const;
export type UserIdProperty = typeof USER_ID_PROPERTIES[number];

// ── Constants ────────────────────────────────────────────────────────

const CACHE_KEY_PREFIX = 'users';
const CACHE_TTL_SECONDS = 15 * 60;

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

    async getById (id: number, opts: { cached?: boolean; force?: boolean } = {}): Promise<UserRow | null> {
        return this.getByProperty('id', id, opts);
    }

    async getByUuid (uuid: string, opts: { cached?: boolean; force?: boolean } = {}): Promise<UserRow | null> {
        return this.getByProperty('uuid', uuid, opts);
    }

    async getByUsername (username: string, opts: { cached?: boolean; force?: boolean } = {}): Promise<UserRow | null> {
        return this.getByProperty('username', username, opts);
    }

    async getByEmail (email: string, opts: { cached?: boolean; force?: boolean } = {}): Promise<UserRow | null> {
        return this.getByProperty('email', email, opts);
    }

    async getByReferralCode (code: string, opts: { cached?: boolean; force?: boolean } = {}): Promise<UserRow | null> {
        return this.getByProperty('referral_code', code, opts);
    }

    /**
     * Generic property lookup. Fast-path reads redis first (cache is
     * multi-key — every identifying property points at the same serialized
     * row). On miss, falls back to DB and backfills the cache.
     *
     * `force: true` bypasses cache both on read and on replication.
     */
    async getByProperty (
        prop: UserIdProperty,
        value: unknown,
        options: { cached?: boolean; force?: boolean } = {},
    ): Promise<UserRow | null> {
        const cached = options.cached ?? true;
        const force = options.force ?? false;

        if ( cached && !force ) {
            const hit = await this.#readCache(prop, value);
            if ( hit ) return hit;
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
        if ( ! row ) return null;

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
    async create (fields: {
        username: string;
        uuid: string;
        password: string | null;
        email: string | null;
        clean_email?: string | null;
        free_storage?: number | null;
        referred_by?: number | null;
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
             referred_by, requires_email_confirmation, email_confirm_code,
             email_confirm_token, audit_metadata, signup_ip, signup_ip_forwarded,
             signup_user_agent, signup_origin)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                fields.username,
                fields.email,
                fields.clean_email ?? null,
                fields.password,
                fields.uuid,
                fields.free_storage ?? null,
                fields.referred_by ?? null,
                fields.requires_email_confirmation ? 1 : 0,
                fields.email_confirm_code ?? null,
                fields.email_confirm_token ?? null,
                fields.audit_metadata ? JSON.stringify(fields.audit_metadata) : null,
                fields.signup_ip ?? null,
                fields.signup_ip_forwarded ?? null,
                fields.signup_user_agent ?? null,
                fields.signup_origin ?? null,
            ],
        );

        const insertId = (result as unknown as { insertId?: number }).insertId;
        if ( ! insertId ) throw new Error('Failed to create user — no insertId returned');

        const user = await this.getById(insertId, { force: true });
        if ( ! user ) throw new Error('Failed to fetch created user');
        return user;
    }

    /**
     * Update arbitrary user fields by id. Invalidates cache on write.
     *
     * Only pass whitelisted columns — this uses string interpolation for
     * column names for ergonomic call sites. Never take column names from
     * request bodies.
     */
    async update (userId: number, patch: Record<string, unknown>): Promise<void> {
        const keys = Object.keys(patch);
        if ( keys.length === 0 ) return;

        const setClause = keys.map(k => `\`${k}\` = ?`).join(', ');
        const values = keys.map(k => patch[k]);

        await this.clients.db.write(
            `UPDATE \`user\` SET ${setClause} WHERE \`id\` = ?`,
            [...values, userId],
        );
        await this.invalidateById(userId);
    }

    async updateMetadata (userId: number, patch: Record<string, unknown>): Promise<void> {
        const user = await this.getById(userId);
        const current: Record<string, unknown> = user?.metadata ?? {};
        const merged = { ...current, ...patch };

        await this.clients.db.write(
            'UPDATE `user` SET `metadata` = ? WHERE `id` = ?',
            [JSON.stringify(merged), userId],
        );
        if ( user ) await this.invalidate(user);
    }

    /** Remove every cache key pointing at the given user. Call after any DB write. */
    async invalidate (user: UserRow): Promise<void> {
        const keys = this.#cacheKeysForUser(user);
        if ( keys.length === 0 ) return;
        try {
            await this.clients.redis.del(...keys);
        } catch {
            // Best-effort invalidation.
        }
    }

    /** Invalidate by id — fetches the cached row first so we know all its keys. */
    async invalidateById (id: number): Promise<void> {
        const cached = await this.#readCache('id', id);
        if ( cached ) await this.invalidate(cached);
    }

    // ── Internals ────────────────────────────────────────────────────

    #cacheKey (prop: UserIdProperty, value: unknown): string {
        return `${CACHE_KEY_PREFIX}:${prop}:${String(value)}`;
    }

    #cacheKeysForUser (user: UserRow): string[] {
        const keys: string[] = [];
        for ( const prop of USER_ID_PROPERTIES ) {
            const value = user[prop];
            if ( value === undefined || value === null || value === '' ) continue;
            keys.push(this.#cacheKey(prop, value));
        }
        return keys;
    }

    async #readCache (prop: UserIdProperty, value: unknown): Promise<UserRow | null> {
        try {
            const raw = await this.clients.redis.get(this.#cacheKey(prop, value));
            if ( ! raw ) return null;
            const parsed = JSON.parse(raw) as UserRow;
            // Cached rows were normalized on the write path, so booleans are booleans.
            return parsed;
        } catch {
            return null;
        }
    }

    async #writeCache (user: UserRow): Promise<void> {
        const keys = this.#cacheKeysForUser(user);
        if ( keys.length === 0 ) return;
        const serialized = JSON.stringify(user);
        await Promise.all(keys.map(key =>
            this.clients.redis.set(key, serialized, 'EX', CACHE_TTL_SECONDS)));
    }

    /**
     * Coerce raw DB row values into consistent JS types. MySQL returns
     * BOOLEAN/TINYINT as 0|1; SQLite returns INTEGER. JSON columns come as
     * strings on SQLite, parsed objects on MySQL.
     */
    #normalizeRow (row: Record<string, unknown>): UserRow {
        const asBool = (v: unknown): boolean | undefined => {
            if ( v === null || v === undefined ) return undefined;
            if ( typeof v === 'boolean' ) return v;
            if ( typeof v === 'number' ) return v !== 0;
            if ( typeof v === 'string' ) return v !== '0' && v.toLowerCase() !== 'false' && v !== '';
            return Boolean(v);
        };

        const metadata = this.clients.db.case<() => Record<string, unknown>>({
            mysql: () => (row.metadata as Record<string, unknown>) ?? {},
            otherwise: () => {
                if ( row.metadata == null ) return {};
                if ( typeof row.metadata === 'object' ) return row.metadata as Record<string, unknown>;
                try {
                    return JSON.parse(String(row.metadata));
                } catch {
                    return {};
                }
            },
        })();

        return {
            ...row,
            id: Number(row.id),
            uuid: String(row.uuid),
            username: String(row.username),
            email: row.email == null ? null : String(row.email),
            suspended: asBool(row.suspended),
            email_confirmed: asBool(row.email_confirmed),
            requires_email_confirmation: asBool(row.requires_email_confirmation),
            referral_code: row.referral_code == null ? null : String(row.referral_code),
            metadata,
        };
    }
}
