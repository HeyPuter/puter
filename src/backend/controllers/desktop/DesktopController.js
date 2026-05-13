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
                            { legacyCode: 'bad_request' },
                        );
                    }
                    patch.desktop_bg_url = url;
                }
                if (color !== undefined) {
                    if (color !== null && typeof color !== 'string') {
                        throw new HttpError(
                            400,
                            '`color` must be a string or null',
                            { legacyCode: 'bad_request' },
                        );
                    }
                    patch.desktop_bg_color = color;
                }
                if (fit !== undefined) {
                    if (fit !== null && typeof fit !== 'string') {
                        throw new HttpError(
                            400,
                            '`fit` must be a string or null',
                            { legacyCode: 'bad_request' },
                        );
                    }
                    patch.desktop_bg_fit = fit;
                }

                if (Object.keys(patch).length === 0) {
                    throw new HttpError(400, 'No fields provided', {
                        legacyCode: 'bad_request',
                    });
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
                        { legacyCode: 'bad_request' },
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
                        { legacyCode: 'bad_request' },
                    );
                }
                await this.#updateFSEntry(
                    req.actor,
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
                        { legacyCode: 'bad_request' },
                    );
                }
                const resolvedOrder = sort_order ?? 'asc';
                if (!ALLOWED_SORT_ORDER.includes(resolvedOrder)) {
                    throw new HttpError(
                        400,
                        `\`sort_order\` must be one of: ${ALLOWED_SORT_ORDER.join(', ')}`,
                        { legacyCode: 'bad_request' },
                    );
                }
                await this.#updateFSEntry(
                    req.actor,
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
     * Update columns on an actor-owned fsentry. Accepts either `item_uid`
     * (fast path) or `item_path` (path lookups in FSEntryStore now have
     * a recursive-CTE fallback for legacy rows with a NULL `path` column,
     * so this works for old accounts too).
     *
     * Ownership: `entry.user_id === actor.user.id`. Kept as added
     * validation against bad paths — the previous "drop user_id entirely"
     * theory turned out to be wrong (the actual legacy issue was NULL
     * paths, not user_id drift), so this filter doesn't lock out old
     * accounts in practice.
     */
    async #updateFSEntry(actor, { item_uid, item_path }, patch) {
        if (!item_uid && !item_path) {
            throw new HttpError(400, 'Missing `item_uid` or `item_path`', {
                legacyCode: 'bad_request',
            });
        }

        const entry = item_uid
            ? await this.stores.fsEntry.getEntryByUuid(item_uid)
            : await this.stores.fsEntry.getEntryByPath(item_path);
        if (!entry) {
            throw new HttpError(404, 'Item not found', {
                legacyCode: 'not_found',
            });
        }

        const actorUserId = actor?.user?.id;
        if (typeof actorUserId !== 'number' || entry.userId !== actorUserId) {
            throw new HttpError(403, 'Not allowed to update this item', {
                legacyCode: 'forbidden',
            });
        }

        const keys = Object.keys(patch);
        const setClause = keys.map((k) => `\`${k}\` = ?`).join(', ');
        const values = keys.map((k) => patch[k]);

        await this.db.write(
            `UPDATE \`fsentries\` SET ${setClause} WHERE \`id\` = ?`,
            [...values, entry.id],
        );

        await this.stores.fsEntry.invalidateEntryCacheByUuid(entry.uuid);
    }

    onServerStart() {}
    onServerPrepareShutdown() {}
    onServerShutdown() {}
}
