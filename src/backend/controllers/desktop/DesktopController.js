import { HttpError } from '../../core/http/HttpError.js';
import { PuterController } from '../types.js';

const ALLOWED_LAYOUTS = ['icons', 'details', 'list'];
const ALLOWED_SORT_BY = ['name', 'size', 'modified', 'type'];
const ALLOWED_SORT_ORDER = ['asc', 'desc'];

/**
 * Desktop/UI preference routes.
 *
 * Two categories:
 *   - User-level: desktop background, taskbar items (UserStore)
 *   - Folder-level: layout, sort_by/sort_order (fsentries table)
 */
export class DesktopController extends PuterController {
    constructor(config, clients, stores, services) {
        super(config, clients, stores, services);
    }

    get userStore() {
        return this.stores.user;
    }
    get db() {
        return this.clients.db;
    }

    registerRoutes(router) {
        // ── Desktop background ──────────────────────────────────────

        router.post(
            '/set-desktop-bg',
            {
                subdomain: 'api',
                requireUserActor: true,
            },
            async (req, res) => {
                const { url, color, fit } = req.body ?? {};

                const patch = {};
                if (url !== undefined) {
                    if (url !== null && typeof url !== 'string') {
                        throw new HttpError(
                            400,
                            '`url` must be a string or null',
                        );
                    }
                    patch.desktop_bg_url = url;
                }
                if (color !== undefined) {
                    if (color !== null && typeof color !== 'string') {
                        throw new HttpError(
                            400,
                            '`color` must be a string or null',
                        );
                    }
                    patch.desktop_bg_color = color;
                }
                if (fit !== undefined) {
                    if (fit !== null && typeof fit !== 'string') {
                        throw new HttpError(
                            400,
                            '`fit` must be a string or null',
                        );
                    }
                    patch.desktop_bg_fit = fit;
                }

                if (Object.keys(patch).length === 0) {
                    throw new HttpError(400, 'No fields provided');
                }

                await this.userStore.update(req.actor.user.id, patch);
                res.json({});
            },
        );

        // ── Taskbar items ───────────────────────────────────────────

        router.post(
            '/update-taskbar-items',
            {
                subdomain: 'api',
                requireUserActor: true,
            },
            async (req, res) => {
                const { items } = req.body ?? {};
                if (!Array.isArray(items)) {
                    throw new HttpError(
                        400,
                        'Missing or invalid `items` array',
                    );
                }

                await this.userStore.update(req.actor.user.id, {
                    taskbar_items: JSON.stringify(items),
                });
                res.json({});
            },
        );

        // ── Folder layout ───────────────────────────────────────────

        router.post(
            '/set_layout',
            {
                subdomain: 'api',
                requireUserActor: true,
            },
            async (req, res) => {
                const { item_uid, item_path, layout } = req.body ?? {};
                if (!layout || !ALLOWED_LAYOUTS.includes(layout)) {
                    throw new HttpError(
                        400,
                        `\`layout\` must be one of: ${ALLOWED_LAYOUTS.join(', ')}`,
                    );
                }
                await this.#updateFSEntry(
                    req.actor.user.id,
                    { item_uid, item_path },
                    { layout },
                );
                res.json({});
            },
        );

        // ── Folder sort ─────────────────────────────────────────────

        router.post(
            '/set_sort_by',
            {
                subdomain: 'api',
                requireUserActor: true,
            },
            async (req, res) => {
                const { item_uid, item_path, sort_by, sort_order } =
                    req.body ?? {};
                if (!sort_by || !ALLOWED_SORT_BY.includes(sort_by)) {
                    throw new HttpError(
                        400,
                        `\`sort_by\` must be one of: ${ALLOWED_SORT_BY.join(', ')}`,
                    );
                }
                const resolvedOrder = sort_order ?? 'asc';
                if (!ALLOWED_SORT_ORDER.includes(resolvedOrder)) {
                    throw new HttpError(
                        400,
                        `\`sort_order\` must be one of: ${ALLOWED_SORT_ORDER.join(', ')}`,
                    );
                }
                await this.#updateFSEntry(
                    req.actor.user.id,
                    { item_uid, item_path },
                    {
                        sort_by,
                        sort_order: resolvedOrder,
                    },
                );
                res.json({});
            },
        );
    }

    // ── Helpers ──────────────────────────────────────────────────────

    /**
     * Update columns on a user-owned fsentry, scoped by user_id for
     * security. Accepts either `item_uid` (fast path) or `item_path`.
     */
    async #updateFSEntry(userId, { item_uid, item_path }, patch) {
        if (!item_uid && !item_path) {
            throw new HttpError(400, 'Missing `item_uid` or `item_path`');
        }

        const keys = Object.keys(patch);
        const setClause = keys.map((k) => `\`${k}\` = ?`).join(', ');
        const values = keys.map((k) => patch[k]);

        let result;
        if (item_uid) {
            result = await this.db.write(
                `UPDATE \`fsentries\` SET ${setClause} WHERE \`uuid\` = ? AND \`user_id\` = ?`,
                [...values, item_uid, userId],
            );
        } else {
            result = await this.db.write(
                `UPDATE \`fsentries\` SET ${setClause} WHERE \`path\` = ? AND \`user_id\` = ?`,
                [...values, item_path, userId],
            );
        }

        const affected = result?.affectedRows ?? result?.changes ?? 0;
        if (affected === 0) {
            throw new HttpError(404, 'Item not found or not owned by you');
        }
    }

    onServerStart() {}
    onServerPrepareShutdown() {}
    onServerShutdown() {}
}
