import { v4 as uuidv4 } from 'uuid';
import { PuterStore } from '../types';

/**
 * CRUD over the `subdomains` table. Used for user-hosted sites.
 *
 * Columns: id, uuid, subdomain, user_id, root_dir_id, associated_app_id,
 * ts, app_owner.
 *
 * Security: all lookups are user_id-scoped by default. Callers that
 * need cross-user reads (e.g., public hosting resolution) should use
 * the unscoped variants.
 */

const READ_ONLY_COLUMNS = new Set(['id', 'uuid', 'user_id', 'ts']);

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
        const rows = await this.clients.db.read(
            'SELECT * FROM `subdomains` WHERE `subdomain` = ? LIMIT 1',
            [subdomain],
        );
        return rows[0] ?? null;
    }

    async listByUserId(userId, { limit = 500 } = {}) {
        const rows = await this.clients.db.read(
            `SELECT * FROM \`subdomains\` WHERE \`user_id\` = ? LIMIT ${limit}`,
            [userId],
        );
        return rows;
    }

    async existsBySubdomain(subdomain) {
        const rows = await this.clients.db.read(
            'SELECT `id` FROM `subdomains` WHERE `subdomain` = ? LIMIT 1',
            [subdomain],
        );
        return rows.length > 0;
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

    async listByUserIdAndPrefix(userId, prefix) {
        const like = `${prefix}%`;
        return this.clients.db.read(
            'SELECT * FROM `subdomains` WHERE `user_id` = ? AND `subdomain` LIKE ?',
            [userId, like],
        );
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
        return this.getByUuid(uuid);
    }

    async update(uuid, patch, { userId } = {}) {
        const allowed = {};
        for (const [k, v] of Object.entries(patch)) {
            if (READ_ONLY_COLUMNS.has(k)) continue;
            allowed[k] = v;
        }
        const keys = Object.keys(allowed);
        if (keys.length === 0) return this.getByUuid(uuid, { userId });

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
        return this.getByUuid(uuid, { userId });
    }

    async deleteByUuid(uuid, { userId } = {}) {
        const where =
            userId !== undefined
                ? 'WHERE `uuid` = ? AND `user_id` = ?'
                : 'WHERE `uuid` = ?';
        const params = userId !== undefined ? [uuid, userId] : [uuid];

        const result = await this.clients.db.write(
            `DELETE FROM \`subdomains\` ${where}`,
            params,
        );
        return (result?.affectedRows ?? result?.changes ?? 0) > 0;
    }
}
