/**
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

import { v4 as uuidv4 } from 'uuid';
import { PuterStore } from '../types';

// Columns that may not be set through an `update` patch map. Defence-in-depth
// against future callers (admin routes, extensions, new REST handlers) that
// might forward `req.body` straight into the store: the driver's update
// builds its patch from a strict allow-list upstream, but the store is the
// last line before SQL.
//
// Categories:
//   - identity: `id`, `uuid`
//   - system timestamps: `ts`
//   - name / identity: `subdomain` — v1 marks this `immutable: true`; rename
//     would orphan DNS + ACL wiring tied to the old name.
//   - ownership: `user_id`, `app_owner` — set via `create`, never via patch.
//     Flipping either hands the site to another user / app.
//   - access gate: `protected` — clearing this lets a future caller delete
//     or rename a protected site (e.g. `puter-app-icons`). The driver itself
//     honours the flag only via a read check in `delete`.
//   - external resource link: `database_id` — repointing a Cloudflare D1
//     binding could route another site's traffic / writes to attacker DB.
//
// `root_dir_id`, `associated_app_id`, and `domain` are intentionally NOT
// here — they're legitimately editable through the driver with their own
// access checks (FS permission, app ownership, custom-domain validation).
const READ_ONLY_COLUMNS = new Set([
    'id',
    'uuid',
    'ts',
    'subdomain',
    'user_id',
    'app_owner',
    'protected',
    'database_id',
]);

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
            `SELECT * FROM \`subdomains\` WHERE \`user_id\` = ? LIMIT ?`,
            [userId, limit],
        );
        return rows;
    }

    async listAll({ limit = 5000 } = {}) {
        const rows = await this.clients.db.read(
            `SELECT * FROM \`subdomains\` LIMIT ?`,
            [limit],
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

        const row = {
            uuid,
            subdomain,
            user_id: userId,
            root_dir_id: rootDirId ?? null,
            associated_app_id: associatedAppId,
            app_owner: appOwner,
        };
        await this.#refreshCache(row);
        await this.#invalidatePrefixListsForUser(userId);
        await this.#invalidateRootDirEntry(row.root_dir_id);

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
                broadcast: true,
            });
        }
        if (after) {
            await this.#refreshCache({ ...after, ...allowed });
        }
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
        // FSEntry rows embed a `subdomains_agg` JSON of associated subdomains,
        // so any rename / root_dir reassignment must drop the stale entry
        // caches on both the old and new root_dir_id.
        const affectedRootDirIds = new Set(
            [before?.root_dir_id, after?.root_dir_id].filter((v) => v != null),
        );
        for (const id of affectedRootDirIds) {
            await this.#invalidateRootDirEntry(id);
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
                broadcast: true,
            });
            if (row.user_id != null) {
                await this.#invalidatePrefixListsForUser(row.user_id);
            }
            await this.#invalidateRootDirEntry(row.root_dir_id);
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
            broadcast: true,
        });
    }

    // FSEntryStore caches each row with an embedded `subdomains_agg` JSON
    // (uuid + subdomain) keyed on `root_dir_id`. Without this, a deleted or
    // renamed subdomain keeps showing up under its old folder in the GUI
    // (website badge, "associated websites" popover) until the entry's
    // independent TTL expires.
    async #invalidateRootDirEntry(rootDirId) {
        if (rootDirId == null) return;
        const id =
            typeof rootDirId === 'number' ? rootDirId : Number(rootDirId);
        if (!Number.isFinite(id)) return;
        const fsEntry = this.stores?.fsEntry;
        if (!fsEntry?.invalidateEntryCacheById) return;
        try {
            await fsEntry.invalidateEntryCacheById(id);
        } catch {
            /* best-effort */
        }
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
        await this.publishCacheKeys({
            keys: keysToInvalidate,
            broadcast: true,
        });
    }
}
