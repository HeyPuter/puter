import { v4 as uuidv4 } from 'uuid';
import { PuterStore } from '../types';

const READ_ONLY_COLUMNS = new Set(['id', 'uuid', 'user_id', 'ts']);

const CACHE_KEY_PREFIX = 'subdomains';
const CACHE_TTL_SECONDS = 60 * 60;
// Sentinel so 404s on the same public subdomain don't hit the DB repeatedly.
const NEGATIVE_CACHE_MARKER = '__none__';
const NEGATIVE_CACHE_TTL_SECONDS = 60;

export class SubdomainStore extends PuterStore {
    // ── Reads ────────────────────────────────────────────────────────

    async getByUuid(uuid, { userId } = {}) {
        const where =
            userId !== undefined
                ? 'WHERE `uuid` = ? AND `user_id` = ?'
                : 'WHERE `uuid` = ?';
        const params = userId !== undefined ? [uuid, userId] : [uuid];
        const rows = await this.clients.db.read(
            `SELECT * FROM \`subdomains\` ${where} LIMIT 1`,
            params,
        );
        return rows[0] ?? null;
    }

    async getBySubdomain(subdomain) {
        if (!subdomain) return null;

        const cacheKey = this.#cacheKey(subdomain);
        try {
            const raw = await this.clients.redis.get(cacheKey);
            if (raw === NEGATIVE_CACHE_MARKER) return null;
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed) return parsed;
            }
        } catch {
            /* fall through */
        }

        const rows = await this.clients.db.read(
            'SELECT * FROM `subdomains` WHERE `subdomain` = ? LIMIT 1',
            [subdomain],
        );
        const row = rows[0] ?? null;

        if (row) {
            this.clients.redis
                .set(cacheKey, JSON.stringify(row), 'EX', CACHE_TTL_SECONDS)
                .catch(() => {});
        } else {
            this.clients.redis
                .set(
                    cacheKey,
                    NEGATIVE_CACHE_MARKER,
                    'EX',
                    NEGATIVE_CACHE_TTL_SECONDS,
                )
                .catch(() => {});
        }
        return row;
    }

    async listByUserId(userId, { limit = 500 } = {}) {
        const rows = await this.clients.db.read(
            `SELECT * FROM \`subdomains\` WHERE \`user_id\` = ? LIMIT ${limit}`,
            [userId],
        );
        return rows;
    }

    async existsBySubdomain(subdomain) {
        // Reuse the positive/negative cache populated by getBySubdomain —
        // creation uniqueness checks and the Workers quota path would
        // otherwise punch through to the DB on every call.
        const row = await this.getBySubdomain(subdomain);
        return row != null;
    }

    async countByUserId(userId) {
        const rows = await this.clients.db.read(
            'SELECT COUNT(*) AS n FROM `subdomains` WHERE `user_id` = ?',
            [userId],
        );
        return rows[0]?.n ?? 0;
    }

    async getByDomain(domain) {
        const rows = await this.clients.db.read(
            'SELECT * FROM `subdomains` WHERE `domain` = ? LIMIT 1',
            [domain],
        );
        return rows[0] ?? null;
    }

    async listByDomain(domain) {
        return this.clients.db.read(
            'SELECT * FROM `subdomains` WHERE `domain` = ?',
            [domain],
        );
    }

    async listByUserIdAndPrefix(userId, prefix, extra = {}) {
        if (!userId || prefix == null) return [];

        const like = `${prefix}%`;
        let rows;
        if (!extra.appId) {
            rows = await this.clients.db.read(
                'SELECT * FROM `subdomains` WHERE `user_id` = ? AND `subdomain` LIKE ?',
                [userId, like],
            );
        } else {
            rows = await this.clients.db.read(
                'SELECT * FROM `subdomains` WHERE `user_id` = ? AND `app_owner` = ? AND `subdomain` LIKE ?',
                [userId, extra.appId, like],
            );
        }

        return rows;
    }

    // ── Writes ───────────────────────────────────────────────────────

    /** @param {{ userId: number, subdomain: string, rootDirId?: number|null, associatedAppId?: number|null, appOwner?: number|null }} opts */
    async create({
        userId,
        subdomain,
        rootDirId = null,
        associatedAppId = null,
        appOwner = null,
    }) {
        if (!userId || !subdomain) {
            throw new Error('create: userId and subdomain are required');
        }
        const uuid = uuidv4();
        await this.clients.db.write(
            `INSERT INTO \`subdomains\`
                (\`uuid\`, \`subdomain\`, \`user_id\`, \`root_dir_id\`, \`associated_app_id\`, \`app_owner\`)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                uuid,
                subdomain,
                userId,
                rootDirId ?? null,
                associatedAppId,
                appOwner,
            ],
        );
        const row = await this.getByUuid(uuid);
        if (row) {
            await this.#refreshCache(row);
            await this.#invalidatePrefixListsForUser(userId);
        }
        return row;
    }

    async update(uuid, patch, { userId } = {}) {
        const allowed = {};
        for (const [k, v] of Object.entries(patch)) {
            if (READ_ONLY_COLUMNS.has(k)) continue;
            allowed[k] = v;
        }
        const keys = Object.keys(allowed);
        if (keys.length === 0) return this.getByUuid(uuid, { userId });

        // Rename drops the old cache key.
        const before = await this.getByUuid(uuid, { userId });

        const setClause = keys.map((k) => `\`${k}\` = ?`).join(', ');
        const values = keys.map((k) => allowed[k]);

        const where =
            userId !== undefined
                ? 'WHERE `uuid` = ? AND `user_id` = ?'
                : 'WHERE `uuid` = ?';
        const whereParams = userId !== undefined ? [uuid, userId] : [uuid];

        await this.clients.db.write(
            `UPDATE \`subdomains\` SET ${setClause} ${where}`,
            [...values, ...whereParams],
        );

        const after = await this.getByUuid(uuid, { userId });
        if (before?.subdomain && before.subdomain !== after?.subdomain) {
            await this.publishCacheKeys({
                keys: [this.#cacheKey(before.subdomain)],
            });
        }
        if (after) await this.#refreshCache(after);
        // A patched root_dir_id / associated_app_id / domain changes the rows
        // the prefix-list cache would return, so drop those caches for the
        // owning user(s). Covers pre- and post-rename owners in case the
        // caller ever allowed re-assignment (currently we don't, but cheap).
        const affectedUsers = new Set(
            [before?.user_id, after?.user_id].filter((v) => v != null),
        );
        for (const uid of affectedUsers) {
            await this.#invalidatePrefixListsForUser(uid);
        }
        return after;
    }

    async deleteByUuid(uuid, { userId } = {}) {
        const row = await this.getByUuid(uuid, { userId });

        const where =
            userId !== undefined
                ? 'WHERE `uuid` = ? AND `user_id` = ?'
                : 'WHERE `uuid` = ?';
        const params = userId !== undefined ? [uuid, userId] : [uuid];

        const result = await this.clients.db.write(
            `DELETE FROM \`subdomains\` ${where}`,
            params,
        );
        const affected = (result?.affectedRows ?? result?.changes ?? 0) > 0;
        if (affected && row?.subdomain) {
            await this.publishCacheKeys({
                keys: [this.#cacheKey(row.subdomain)],
            });
            if (row.user_id != null) {
                await this.#invalidatePrefixListsForUser(row.user_id);
            }
        }
        return affected;
    }

    // ── Internals ────────────────────────────────────────────────────

    #cacheKey(subdomain) {
        return `${CACHE_KEY_PREFIX}:name:${subdomain}`;
    }

    #prefixListTrackerKey(userId) {
        return `${CACHE_KEY_PREFIX}:listByUserPrefixKeys:${userId}`;
    }

    async #refreshCache(row) {
        if (!row?.subdomain) return;
        await this.publishCacheKeys({
            keys: [this.#cacheKey(row.subdomain)],
            serializedData: JSON.stringify(row),
            ttlSeconds: CACHE_TTL_SECONDS,
        });
    }

    async #invalidatePrefixListsForUser(userId) {
        if (userId == null) return;
        const trackerKey = this.#prefixListTrackerKey(userId);
        let cacheKeys = [];
        try {
            cacheKeys = await this.clients.redis.smembers(trackerKey);
        } catch {
            return;
        }
        const keysToInvalidate = [...cacheKeys, trackerKey];
        if (keysToInvalidate.length === 0) return;
        await this.publishCacheKeys({ keys: keysToInvalidate });
    }
}
