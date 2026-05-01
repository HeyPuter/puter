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

import { Context } from '../../core/context.js';
import { HttpError } from '../../core/http/HttpError.js';
import {
    MANAGE_PERM_PREFIX,
    PERMISSION_FOR_NOTHING_IN_PARTICULAR,
} from '../permission/consts.js';
import { PermissionUtil } from '../permission/permissionUtil.js';
import type { LayerInstances } from '../../types.js';
import type { puterStores } from '../../stores/index.js';
import type { puterServices } from '../index.js';
import { PuterService } from '../types.js';

/**
 * Permission rewriters / implicators for the `app:*`, `apps-of-user:*`,
 * `subdomains-of-user:*`, and `app-root-dir:*` namespaces.
 *
 * Ports three v1 services (ProtectedAppService, AppPermissionService, the
 * app-root-dir arm of AppService) into one domain-scoped service. Nothing
 * here needs to live beyond init — the registrations are stateless.
 */
export class AppPermissionService extends PuterService {
    declare protected stores: LayerInstances<typeof puterStores>;
    declare protected services: LayerInstances<typeof puterServices>;

    override onServerStart(): void {
        const permissions = this.services.permission;
        const appStore = this.stores.app;

        // ── app:<name>:mode → app:uid#<uid>:mode ───────────────────────
        // Names change (via app rename); uids are stable. Store/scan uid
        // form so renames don't invalidate existing grants. AppStore caches
        // `getByName` in Redis (5m), invalidated on rename/update.
        permissions.registerRewriter({
            id: 'app-name-to-uid',
            matches: (permission: string) => {
                if (!permission.startsWith('app:')) return false;
                const [, specifier] = PermissionUtil.split(permission);
                return Boolean(specifier && !specifier.startsWith('uid#'));
            },
            rewrite: async (permission: string): Promise<string> => {
                const [prefix, name, ...rest] =
                    PermissionUtil.split(permission);
                const app = await appStore.getByName(name);
                if (!app || typeof app.uid !== 'string') return permission;
                return PermissionUtil.join(prefix, `uid#${app.uid}`, ...rest);
            },
        });

        // ── app-is-owner implicator ───────────────────────────────────
        // User actors implicitly hold `app:uid#X:*` (and manage form) on
        // apps they own. Mirrors the fs is-owner pattern.
        permissions.registerImplicator({
            id: 'app-is-owner',
            matches: (permission: string) => {
                return (
                    permission.startsWith('app:') ||
                    permission.startsWith(`${MANAGE_PERM_PREFIX}:app:`)
                );
            },
            check: async ({ actor, permission }): Promise<unknown> => {
                if (actor.app || actor.accessToken) return undefined;
                if (!actor.user?.id) return undefined;

                const parts = PermissionUtil.split(permission);
                if (parts[0] === MANAGE_PERM_PREFIX) parts.shift();
                if (parts.length < 2) return undefined;
                const specifier = parts[1];
                if (!specifier.startsWith('uid#')) return undefined;
                const uid = specifier.slice('uid#'.length);
                if (!uid) return undefined;

                const app = await appStore.getByUid(uid);
                if (!app) return undefined;
                const ownerId = (app as { owner_user_id?: number })
                    .owner_user_id;
                if (ownerId === actor.user.id) return {};
                return undefined;
            },
        });

        // ── apps-of-user:<own_uuid>:* / subdomains-of-user:… ──────────
        // A user implicitly holds read/write over *their own* apps and
        // subdomains. `puter.perms` expresses these as
        // `apps-of-user:<own_uuid>:<mode>` etc.
        permissions.registerImplicator({
            id: 'user-can-grant-read-own-apps',
            matches: (permission: string) => {
                return (
                    permission.startsWith('apps-of-user:') ||
                    permission.startsWith('subdomains-of-user:')
                );
            },
            check: async ({ actor, permission }): Promise<unknown> => {
                if (actor.app || actor.accessToken) return undefined;
                if (!actor.user?.uuid) return undefined;
                const parts = PermissionUtil.split(permission);
                if (parts[1] === actor.user.uuid) return {};
                return undefined;
            },
        });

        // ── app-root-dir:<app_uid>:<mode> → fs:<root_uid>:<mode> ───────
        // Only rewrites during an explicit `grantUserAppPermission` (see
        // PermissionService for the context flag). During scans we return
        // PERMISSION_FOR_NOTHING_IN_PARTICULAR so `check(actor, 'app-root-dir:…')`
        // never accidentally matches through the fs-permission path.
        permissions.registerRewriter({
            id: 'app-root-dir-to-fs',
            matches: (permission: string) =>
                permission.startsWith('app-root-dir:'),
            rewrite: async (permission: string): Promise<string> => {
                if (!Context.get('is_grant_user_app_permission')) {
                    return PERMISSION_FOR_NOTHING_IN_PARTICULAR;
                }
                const actor = Context.get('actor');
                if (!actor || actor.app || actor.accessToken) {
                    throw new HttpError(403, 'Forbidden');
                }
                if (!actor.user?.id) {
                    throw new HttpError(403, 'Forbidden');
                }

                const parts = PermissionUtil.split(permission);
                if (parts.length < 3) {
                    throw new HttpError(
                        400,
                        'Invalid `app-root-dir` permission',
                    );
                }
                const [, targetAppUid, access, ...rest] = parts;
                if (!targetAppUid) {
                    throw new HttpError(400, 'Missing target_app_uid');
                }

                const targetApp = await appStore.getByUid(targetAppUid);
                if (!targetApp) {
                    throw new HttpError(
                        404,
                        `Entry not found: app=${targetAppUid}`,
                        { legacyCode: 'subject_does_not_exist' },
                    );
                }
                if (
                    (targetApp as { owner_user_id?: number }).owner_user_id !==
                    actor.user.id
                ) {
                    throw new HttpError(403, 'Forbidden');
                }

                const rootDirId = await this.#resolveAppRootDirId(
                    targetApp as {
                        id: number;
                        uid: string;
                        index_url?: string;
                    },
                );
                if (rootDirId === null) {
                    throw new HttpError(
                        404,
                        `Entry not found: app root dir for ${targetAppUid}`,
                        { legacyCode: 'subject_does_not_exist' },
                    );
                }
                const entry = await this.stores.fsEntry.getEntryById(rootDirId);
                if (!entry) {
                    throw new HttpError(
                        404,
                        `Entry not found: app root dir for ${targetAppUid}`,
                        { legacyCode: 'subject_does_not_exist' },
                    );
                }
                return PermissionUtil.join('fs', entry.uuid, access, ...rest);
            },
        });
    }

    /**
     * Resolve an app's filesystem root directory id. Ported from v1's
     * AppService.getAppRootDirId — first checks the canonical
     * `subdomains.associated_app_id` binding, then falls back to parsing
     * the hosting subdomain out of `app.index_url` and resolving it.
     */
    async #resolveAppRootDirId(app: {
        id: number;
        uid: string;
        index_url?: string;
    }): Promise<number | null> {
        const rows = (await this.clients.db.read(
            'SELECT root_dir_id FROM subdomains WHERE associated_app_id = ? AND root_dir_id IS NOT NULL LIMIT 1',
            [app.id],
        )) as Array<{ root_dir_id: number | null }>;
        const direct = rows[0]?.root_dir_id;
        if (direct !== undefined && direct !== null) {
            return Number(direct);
        }

        const hostingDomain = (
            this.config as { static_hosting_domain?: string }
        ).static_hosting_domain?.toLowerCase();
        if (!hostingDomain || !app.index_url) return null;

        let hostname: string;
        try {
            hostname = new URL(app.index_url).hostname.toLowerCase();
        } catch {
            return null;
        }
        if (!hostname.endsWith(`.${hostingDomain}`)) return null;

        const subdomain = hostname.slice(
            0,
            hostname.length - hostingDomain.length - 1,
        );
        const row = (await this.stores.subdomain.getBySubdomain(subdomain)) as {
            root_dir_id?: number | null;
        } | null;
        if (!row?.root_dir_id) return null;
        return Number(row.root_dir_id);
    }
}
