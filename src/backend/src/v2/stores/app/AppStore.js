import { v4 as uuidv4 } from 'uuid';
import { PuterStore } from '../types';

/**
 * Persistence + cache for the `apps` table.
 *
 * CRUD over app rows with multi-key caching (uid, name, id). No
 * validation or permission logic — those live in AppDriver. Callers
 * that need enforcement should go through the driver; callers that
 * just need data (internal services) can hit the store directly.
 */

const CACHE_KEY_PREFIX = 'apps';
const CACHE_TTL_SECONDS = 5 * 60;
const APP_ID_PROPERTIES = ['id', 'uid', 'name'];

// Columns that may not be set through `create` / `update` from user input.
// Admin-only or system-managed fields.
const READ_ONLY_COLUMNS = new Set([
    'id',
    'timestamp',
    'last_review',
    'approved_for_listing',
    'approved_for_opening_items',
    'approved_for_incentive_program',
    'godmode',
]);

export class AppStore extends PuterStore {

    // ── Reads ────────────────────────────────────────────────────────

    async getByUid (uid) { return this.#getByProperty('uid', uid); }
    async getById (id) { return this.#getByProperty('id', id); }
    async getByName (name) { return this.#getByProperty('name', name); }

    async existsByName (name) {
        const rows = await this.clients.db.read(
            'SELECT `id` FROM `apps` WHERE `name` = ? LIMIT 1',
            [name],
        );
        return rows.length > 0;
    }

    async existsByIndexUrl (indexUrl) {
        const rows = await this.clients.db.read(
            'SELECT `id` FROM `apps` WHERE `index_url` = ? LIMIT 1',
            [indexUrl],
        );
        return rows.length > 0;
    }

    /**
     * List apps with optional filters. Returns raw normalised rows —
     * the driver is responsible for permission filtering + icon URL
     * resolution when serving to clients.
     *
     * @param {object} filters
     * @param {number} [filters.ownerUserId] — only apps owned by this user
     * @param {number} [filters.appOwner] — only apps created by another app
     * @param {string} [filters.name] — exact name match
     * @param {number} [filters.limit=500]
     */
    async list (filters = {}) {
        const where = [];
        const params = [];

        if ( filters.ownerUserId !== undefined ) {
            where.push('`owner_user_id` = ?');
            params.push(filters.ownerUserId);
        }
        if ( filters.appOwner !== undefined ) {
            where.push('`app_owner` = ?');
            params.push(filters.appOwner);
        }
        if ( filters.name !== undefined ) {
            where.push('`name` = ?');
            params.push(filters.name);
        }

        const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const limit = filters.limit ?? 500;

        const rows = await this.clients.db.read(
            `SELECT * FROM \`apps\` ${whereClause} LIMIT ${limit}`,
            params,
        );
        return rows.map(r => this.#normalizeRow(r));
    }

    // ── Writes ───────────────────────────────────────────────────────

    /**
     * Create a new app row. `fields` is the raw column map (after
     * validation). Generates a new UID if not provided.
     *
     * Returns the created app row.
     */
    async create (fields) {
        const uid = fields.uid ?? `app-${uuidv4()}`;
        const allowed = this.#filterEditable(fields);
        const columns = ['uid', ...Object.keys(allowed)];
        const values = [uid, ...Object.values(allowed)];

        const placeholders = columns.map(() => '?').join(', ');
        const colList = columns.map(c => `\`${c}\``).join(', ');

        const result = await this.clients.db.write(
            `INSERT INTO \`apps\` (${colList}) VALUES (${placeholders})`,
            values,
        );
        const insertId = result?.insertId;
        if ( ! insertId ) throw new Error('Failed to create app — no insertId returned');

        return this.getById(insertId);
    }

    /**
     * Update an app row. `patch` is the raw column map (after
     * validation). Read-only columns are silently stripped.
     *
     * Invalidates cache. Returns the updated row.
     */
    async update (appId, patch) {
        const allowed = this.#filterEditable(patch);
        const keys = Object.keys(allowed);
        if ( keys.length === 0 ) return this.getById(appId);

        const setClause = keys.map(k => `\`${k}\` = ?`).join(', ');
        const values = keys.map(k => allowed[k]);

        await this.clients.db.write(
            `UPDATE \`apps\` SET ${setClause} WHERE \`id\` = ?`,
            [...values, appId],
        );
        await this.invalidateById(appId);
        return this.getById(appId);
    }

    /**
     * Delete an app row. Also deletes its filetype associations.
     * Invalidates cache.
     */
    async delete (appId) {
        const app = await this.getById(appId);
        if ( ! app ) return false;

        await this.clients.db.write(
            'DELETE FROM `app_filetype_association` WHERE `app_id` = ?',
            [appId],
        );
        await this.clients.db.write(
            'DELETE FROM `apps` WHERE `id` = ?',
            [appId],
        );
        await this.invalidate(app);
        return true;
    }

    // ── Filetype associations ────────────────────────────────────────

    async getFiletypeAssociations (appId) {
        const rows = await this.clients.db.read(
            'SELECT `type` FROM `app_filetype_association` WHERE `app_id` = ?',
            [appId],
        );
        return rows.map(r => r.type);
    }

    async setFiletypeAssociations (appId, types) {
        // Replace-all semantics
        await this.clients.db.write(
            'DELETE FROM `app_filetype_association` WHERE `app_id` = ?',
            [appId],
        );
        if ( ! Array.isArray(types) || types.length === 0 ) return;
        for ( const type of types ) {
            await this.clients.db.write(
                'INSERT INTO `app_filetype_association` (`app_id`, `type`) VALUES (?, ?)',
                [appId, type],
            );
        }
    }

    // ── Cache invalidation ───────────────────────────────────────────

    async invalidate (app) {
        const keys = this.#cacheKeysForApp(app);
        if ( keys.length === 0 ) return;
        try {
            await this.clients.redis.client.del(...keys);
        } catch {
            // Best-effort
        }
    }

    async invalidateById (id) {
        const cached = await this.#readCache('id', id);
        if ( cached ) await this.invalidate(cached);
    }

    // ── Internals ────────────────────────────────────────────────────

    async #getByProperty (prop, value) {
        if ( value === undefined || value === null ) return null;

        const cached = await this.#readCache(prop, value);
        if ( cached ) return cached;

        const rows = await this.clients.db.read(
            `SELECT * FROM \`apps\` WHERE \`${prop}\` = ? LIMIT 1`,
            [value],
        );
        if ( rows.length === 0 ) return null;

        const normalized = this.#normalizeRow(rows[0]);
        this.#writeCache(normalized).catch(() => {
            // Best-effort caching
        });
        return normalized;
    }

    #cacheKey (prop, value) {
        return `${CACHE_KEY_PREFIX}:${prop}:${value}`;
    }

    #cacheKeysForApp (app) {
        const keys = [];
        for ( const prop of APP_ID_PROPERTIES ) {
            if ( app[prop] !== undefined && app[prop] !== null ) {
                keys.push(this.#cacheKey(prop, app[prop]));
            }
        }
        return keys;
    }

    async #readCache (prop, value) {
        try {
            const raw = await this.clients.redis.client.get(this.#cacheKey(prop, value));
            return raw ? JSON.parse(raw) : null;
        } catch {
            return null;
        }
    }

    async #writeCache (app) {
        const keys = this.#cacheKeysForApp(app);
        if ( keys.length === 0 ) return;
        const serialized = JSON.stringify(app);
        await Promise.all(keys.map(k =>
            this.clients.redis.client.set(k, serialized, 'EX', CACHE_TTL_SECONDS)));
    }

    #filterEditable (fields) {
        const out = {};
        for ( const [k, v] of Object.entries(fields) ) {
            if ( READ_ONLY_COLUMNS.has(k) ) continue;
            out[k] = v;
        }
        return out;
    }

    #normalizeRow (row) {
        if ( ! row ) return null;
        // Coerce booleans
        for ( const key of ['godmode', 'background', 'maximize_on_start', 'protected',
            'is_private', 'approved_for_listing', 'approved_for_opening_items',
            'approved_for_incentive_program'] ) {
            if ( row[key] !== undefined ) row[key] = Boolean(row[key]);
        }
        // Parse metadata
        if ( typeof row.metadata === 'string' ) {
            try { row.metadata = JSON.parse(row.metadata); } catch { row.metadata = null; }
        }
        // Alias created_at
        if ( row.timestamp !== undefined && row.created_at === undefined ) {
            row.created_at = row.timestamp;
        }
        return row;
    }
}
