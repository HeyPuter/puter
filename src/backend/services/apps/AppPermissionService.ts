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

import { Context } from '../../core/context.js';
import { HttpError } from '../../core/http/HttpError.js';
import type { puterStores } from '../../stores/index.js';
import type { LayerInstances } from '../../types.js';
import type { puterServices } from '../index.js';
import {
    APP_DATA_KV_OP_CLASSES,
    APP_DATA_PERMISSION_PREFIX,
    appDataPermission,
    appDataSharingAllowed,
    type AppDataKvOp,
    type AppDataStore,
} from '../permission/appDataScopes.js';
import {
    MANAGE_PERM_PREFIX,
    PERMISSION_FOR_NOTHING_IN_PARTICULAR,
} from '../permission/consts.js';
import { PermissionUtil } from '../permission/permissionUtil.js';
import { PuterService } from '../types.js';

/**
 * Permission rewriters / implicators for the `app:*`, `apps-of-user:*`,
 * `subdomains-of-user:*`, and `app-root-dir:*` namespaces.
 *
 * Ports three v1 services (ProtectedAppService, AppPermissionService, the
 * app-root-dir arm of AppService) into one domain-scoped service. Nothing here
 * needs to live beyond init — the registrations are stateless.
 */
export class AppPermissionService extends PuterService {
    declare protected stores: LayerInstances<typeof puterStores>;
    declare protected services: LayerInstances<typeof puterServices>;

    override onServerStart(): void {
        const permissions = this.services.permission;
        const appStore = this.stores.app;

        // -- app:<name>:mode → app:uid#<uid>:mode -----------------------
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

        // -- app-is-owner implicator -----------------------------------
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

        // -- apps-of-user:<own_uuid>:* / subdomains-of-user:… ----------
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

        // -- app-root-dir:<app_uid>:<mode> → fs:<root_uid>:<mode> -------
        // Only rewrites while a user-app permission row is being written or
        // removed — `grantUserAppPermission` / `revokeUserAppPermission`, which
        // both set the context flag (see PermissionService) precisely so the
        // revoke names the row the grant wrote. During scans we return
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
                    throw new HttpError(403, 'Forbidden', {
                        legacyCode: 'forbidden',
                    });
                }
                if (!actor.user?.id) {
                    throw new HttpError(403, 'Forbidden', {
                        legacyCode: 'forbidden',
                    });
                }

                const parts = PermissionUtil.split(permission);
                if (parts.length < 3) {
                    throw new HttpError(
                        400,
                        'Invalid `app-root-dir` permission',
                        { legacyCode: 'bad_request' },
                    );
                }
                const [, targetAppUid, access, ...rest] = parts;
                if (!targetAppUid) {
                    throw new HttpError(400, 'Missing target_app_uid', {
                        legacyCode: 'bad_request',
                    });
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
                    throw new HttpError(403, 'Forbidden', {
                        legacyCode: 'forbidden',
                    });
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

        // -- app-data:<target_app_uid>:<store>:<op> ----------------------
        // One app reaching another's per-user state (KV namespace, AppData
        // directory). Both live under the granting user, so the user holds them
        // implicitly and `#scanUserApp` resolves a grant through here.
        //
        // No `manage:` form, deliberately: `canManagePermission` gates
        // user-to-user and dev-app grants, so neither can hand out cross-app
        // access without the user answering a prompt.
        permissions.registerImplicator({
            id: 'user-holds-own-app-data',
            matches: (permission: string) =>
                permission.startsWith(`${APP_DATA_PERMISSION_PREFIX}:`),
            check: async ({ actor }): Promise<unknown> => {
                if (actor.app || actor.accessToken) return undefined;
                if (!actor.user?.id) return undefined;
                return {};
            },
        });

        // Prefix implication already covers `…:kv` and `…:<uid>` grants; this
        // covers the class level, so a check for a concrete op also accepts the
        // class containing it. Mirrors `fs-access-levels` in FSService.
        permissions.registerExploder({
            id: 'app-data-op-classes',
            matches: (permission: string) =>
                permission.startsWith(`${APP_DATA_PERMISSION_PREFIX}:`),
            explode: ({ permission }) => {
                const parts = PermissionUtil.split(permission);
                if (parts.length < 4) return [permission];
                const [, targetAppUid, store, op] = parts;
                const out = [permission];
                const push = (cls: string) => {
                    out.push(
                        appDataPermission(
                            targetAppUid,
                            store as AppDataStore,
                            cls,
                        ),
                    );
                };
                if (store === 'kv') {
                    for (const cls of APP_DATA_KV_OP_CLASSES[
                        op as AppDataKvOp
                    ] ?? []) {
                        push(cls);
                    }
                }
                // fs:read is satisfied by fs:write. `delete` is orthogonal —
                // it implies neither, and neither implies it.
                if (store === 'fs' && op === 'read') push('write');
                return out;
            },
        });

        // A cross-app grant names its target inside the permission string, so no
        // foreign key withdraws it when that app goes away — and an
        // origin-derived uid is regenerated verbatim if the app comes back, which
        // would silently reattach the old consent to whoever controls the origin
        // now. Sweep on both edges, and when an app stops sharing.
        this.clients.event.on(
            'app.changed',
            async (_key: string, data: unknown) => {
                const d = data as
                    | {
                          app_uid?: string;
                          action?: string;
                          app?: unknown;
                          old_app?: unknown;
                      }
                    | undefined;
                if (!d?.app_uid) return;

                let reason: string | null = null;
                if (d.action === 'deleted') {
                    reason = 'target app deleted';
                } else if (
                    d.action === 'updated' &&
                    appDataSharingAllowed(
                        (d.old_app ?? {}) as { metadata?: unknown },
                    ) &&
                    !appDataSharingAllowed(
                        (d.app ?? {}) as { metadata?: unknown },
                    )
                ) {
                    reason = 'target app stopped sharing its data';
                }
                if (!reason) return;

                // Best-effort here, unlike the origin-bootstrap sweep the auth
                // controller drives: deleting or updating an app must not fail
                // because this did. `withdrawAppDataGrants` has already raised
                // the alarm, so the failure is not silent.
                try {
                    await this.withdrawAppDataGrants(d.app_uid, reason);
                } catch {
                    // Already alarmed and logged.
                }
            },
        );
    }

    /**
     * Withdraw every cross-app grant naming `targetAppUid`, audit each removal,
     * and bust the holders' permission caches so the change is effective at
     * once rather than after the scan TTL.
     *
     * Throws on failure. Every caller decides for itself whether a failed sweep
     * is fatal: the event listener treats it as best-effort, because deleting
     * an app must not fail because this did, while the origin-bootstrap path
     * refuses to issue a token rather than let a new app inherit the consent
     * its predecessor was given.
     */
    async withdrawAppDataGrants(
        targetAppUid: string,
        reason: string,
    ): Promise<void> {
        try {
            const removed =
                await this.stores.permission.deleteAppGrantsByPermissionPrefix(
                    appDataPermission(targetAppUid),
                );
            if (removed.length === 0) return;

            const usernames = new Set<string>();
            for (const row of removed) {
                const audit = {
                    user_id: row.user_id,
                    app_id: row.app_id,
                    permission: row.permission,
                    action: 'revoke',
                    reason,
                };
                if (row.table === 'user_to_app_permissions') {
                    await this.stores.permission.auditUserAppPerm(audit);
                    const user = await this.stores.user.getById(row.user_id);
                    if (user?.username) usernames.add(user.username);
                } else {
                    await this.stores.permission.auditDevAppPerm(audit);
                }
            }

            if (usernames.size > 0) {
                // A user-level bump also orphans that user's app actors, which
                // is where these grants were being read.
                await this.services.permission.bumpPermissionCacheForUsernames([
                    ...usernames,
                ]);
            }
        } catch (e) {
            // A sweep that fails leaves consent live for an app the user can no
            // longer see, so it is worth a human looking today — but nobody
            // needs waking, since the callers that cannot tolerate it fail the
            // request outright.
            this.clients.alarm.create(
                `app_data_grant_withdrawal_failed:${targetAppUid}`,
                'Failed to withdraw cross-app data grants',
                { targetAppUid, reason, error: e as Error },
                'warning',
            );
            throw e;
        }
    }

    /**
     * Resolve an app's filesystem root directory id by parsing the hosting
     * subdomain out of `app.index_url` and looking up the matching subdomain
     * row.
     *
     * V1 first consulted `subdomains.associated_app_id` for a direct binding —
     * that column was user-writable without an ownership check, so trusting it
     * let any user point an arbitrary app's "root dir" at their own subdomain.
     * The column is no longer authoritative; the `index_url`-derived lookup
     * below is the only path.
     */
    async #resolveAppRootDirId(app: {
        id: number;
        uid: string;
        index_url?: string;
    }): Promise<number | null> {
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
