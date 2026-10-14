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

import { posix as pathPosix } from 'node:path';
import type { LayerInstances } from '../../types';
import type { puterServices } from '../index';
import { PuterService } from '../types';
import type { Actor } from '../../core/actor';
import {
    isAppActor,
    isPlainUserActor,
    isSystemActor,
    makeActor,
} from '../../core/actor';
import { PermissionUtil } from '../permission/permissionUtil';
import { MANAGE_PERM_PREFIX } from '../permission/consts';
import { closedAppDataOwners } from '../permission/appDataScopes';
import { HttpError } from '../../core/http/HttpError.js';
import { actorHasSubscription } from '../metering/enforcement';
import { withRedisLock } from '../../util/redisLock.js';

// -- Types ------------------------------------------------------------

/**
 * Filesystem-agnostic view of a resource. `resolveAncestors()` returns the
 * chain from the resource itself to the direct child of root; empty means
 * root.
 */
export interface ResourceDescriptor {
    path: string;
    resolveAncestors: () => Promise<
        ReadonlyArray<{ uid: string; path: string }>
    >;
}

export type AclMode =
    | 'see'
    | 'list'
    | 'read'
    | 'write'
    | typeof MANAGE_PERM_PREFIX;

/** Duck-typed error shape compatible with APIError consumers (fsv2). */
export interface AclError {
    status: number;
    message: string;
    fields: { code: string };
}

/**
 * How a route words a refusal. The safe 404/403 split is fixed; these are the
 * parts routes have always answered differently.
 */
export interface AclRefusalOptions {
    /** `legacyCode` of a 403. The filesystem routes answer `access_denied`. */
    forbiddenCode?: string;
    /** Message of a 404. */
    notFoundMessage?: string;
    /**
     * Refuse an app actor with the 404 whatever it can see, so another app's or
     * user's files never show up as merely forbidden.
     */
    hideFromApps?: boolean;
}

/** How the filesystem routes word a refusal. */
export const FS_ROUTE_REFUSAL: AclRefusalOptions = {
    forbiddenCode: 'access_denied',
};

/** A descriptor whose chain is read at most once, however many checks share it. */
export const memoizedDescriptor = (
    path: string,
    readChain: () => Promise<ReadonlyArray<{ uid: string; path: string }>>,
): ResourceDescriptor => {
    let chain: Promise<ReadonlyArray<{ uid: string; path: string }>> | null =
        null;
    return { path, resolveAncestors: () => (chain ??= readChain()) };
};

/** The response for a refusal `getSafeAclError` described. */
export const aclRefusal = (
    safe: AclError,
    options: AclRefusalOptions = {},
): HttpError => {
    if (safe.status === 404) {
        return new HttpError(404, options.notFoundMessage ?? safe.message, {
            legacyCode: safe.fields.code,
        });
    }
    return new HttpError(403, safe.message, {
        legacyCode: options.forbiddenCode ?? safe.fields.code,
    });
};

interface StatPermissionsResult {
    [path: string]: string[];
}

/** Who a node grant goes to: one user, or every member of a group. */
interface AclHolder {
    /** Lock key segment after the issuer id. */
    lockKey: string;
    query: (prefix: string) => Promise<string[]>;
    grant: (permission: string) => Promise<unknown>;
    revoke: (permission: string) => Promise<unknown>;
}

const MODES_ABOVE: Record<AclMode, AclMode[]> = {
    see: ['see', 'list', 'read', 'write'],
    list: ['list', 'read', 'write'],
    read: ['read', 'write'],
    write: ['write'],
    [MANAGE_PERM_PREFIX]: [MANAGE_PERM_PREFIX],
};

const PUBLIC_READ_MODES: ReadonlyArray<AclMode> = Object.freeze([
    'read',
    'list',
    'see',
]);

/** Lock bounds for `setUserUser`; past the retry budget a 409 beats waiting. */
const SET_USER_LOCK_TTL_SECONDS = 5;
const SET_USER_LOCK_RETRY_MS = 40;
const SET_USER_LOCK_ATTEMPTS = 25;

// -- ACLService -------------------------------------------------------

/**
 * ACLService enforces filesystem access-control semantics for Puter.
 *
 * Design notes:
 *
 * - **No FSNode dependency.** Callers pass a `ResourceDescriptor` duck type (`{
 *   path, resolveAncestors() }`). This lets ACL live as a service without
 *   pulling in the filesystem layer (which would create a circular
 *   dependency).
 * - **No route registration.** The service is pure; a controller exposes
 *   `/acl/stat-user-user` and `/acl/set-user-user`.
 *
 * Tree-walks are done via `resolveAncestors()`, which returns a pre-resolved
 * ancestor chain from the caller's FS layer.
 */
export class ACLService extends PuterService {
    declare protected services: LayerInstances<typeof puterServices>;

    // -- Public API ---------------------------------------------------

    /**
     * Returns true iff `actor` is allowed to perform `mode` access on
     * `resource`.
     */
    async check(
        actor: Actor,
        resource: ResourceDescriptor,
        mode: AclMode,
    ): Promise<boolean> {
        if (isSystemActor(actor)) return true;

        if (resource.path === '/') {
            return (PUBLIC_READ_MODES as AclMode[]).includes(mode);
        }
        const ancestors = await resource.resolveAncestors();

        const components = resource.path.slice(1).split('/');

        // Short-circuit: users accessing their own home directory.
        if (isPlainUserActor(actor)) {
            const username = actor.user.username;
            if (
                username &&
                (resource.path === `/${username}` ||
                    resource.path.startsWith(`/${username}/`))
            ) {
                return true;
            }
        }

        // Short-circuit: apps accessing their own AppData directory (under
        // any user). Shared-appdata access is handled below via the
        // per-user-permission gate.
        if (isAppActor(actor)) {
            const username = actor.user.username;
            const appUid = actor.effectiveApp!.uid;
            if (username) {
                const appDataPath = `/${username}/AppData/${appUid}`;
                if (
                    resource.path === appDataPath ||
                    resource.path.startsWith(`${appDataPath}/`)
                ) {
                    return true;
                }
            }
            // Closed whatever the app was granted, on the folder or above it.
            // The stored ancestor paths count too, so a case variant of the
            // asked path still names the folder.
            const closed = await closedAppDataOwners(
                this.stores.app,
                [resource.path, ...ancestors.map((a) => a.path)],
                appUid,
            );
            if (closed.size > 0) return false;
        }

        // Public folders: /<user>/Public with read-ish mode, owner must have
        // confirmed email (or be admin).
        if (
            this.config.enable_public_folders &&
            (PUBLIC_READ_MODES as AclMode[]).includes(mode) &&
            components.length > 1 &&
            components[1] === 'Public'
        ) {
            const ownerUsername = components[0];
            const owner = await this.stores.user.getByUsername(ownerUsername);
            if (owner) {
                if (
                    (owner.email_confirmed ?? false) ||
                    owner.username === 'admin'
                ) {
                    return true;
                }
            }
        }

        // Access tokens: authorizer must have the permission, AND the token
        // itself must have it (or inherit it via an ancestor). Any "higher"
        // mode (e.g. `write` covers `read`/`list`/`see`) satisfies the check.
        if (actor.accessToken) {
            const authorizer = actor.accessToken.issuer;
            if (!(await this.check(authorizer, resource, mode))) return false;

            // Full-access tokens inherit every permission the issuer holds,
            // with no per-permission grant required (these are not stored as
            // access_token_permissions rows; the flag lives on the JWT).
            if (actor.accessToken.fullAccess) return true;

            return this.stores.permission.hasAnyAccessTokenPerm(
                actor.accessToken.uid,
                ancestors.flatMap((ancestor) =>
                    this.permissionsFor(ancestor.uid, mode),
                ),
            );
        }

        // App-under-user: underlying user must also hold the permission.
        if (isAppActor(actor)) {
            const userActor: Actor = { user: actor.user, effectiveApp: null };
            if (!(await this.check(userActor, resource, mode))) return false;

            // Shared-appdata rule: an app accessing its AppData under a
            // *different* user is allowed iff that user has access (checked
            // above), i.e. the directory has been explicitly shared.
            if (
                components[0] !== actor.user.username &&
                components[1] === 'AppData' &&
                components[2] === actor.effectiveApp!.uid
            ) {
                return true;
            }
        }

        // Fall back to the permission scan: walk ancestors, any hit wins.
        // Widen the scan to all "higher" modes (`write` covers `read`/`list`/
        // `see`, etc.) so granting a stronger mode implies the weaker ones.
        for (const ancestor of ancestors) {
            const reading = await this.services.permission.scan(
                actor,
                this.permissionsFor(ancestor.uid, mode),
            );
            const options = PermissionUtil.readingToOptions(reading);
            if (options.length > 0) return true;
        }

        // Last: a link share on the node or a folder above it. Nothing in the
        // permission tables stands behind one, so it is read on its own.
        return this.#anyoneWithLinkAllows(actor, ancestors, mode);
    }

    /**
     * "Anyone with the link": the owner switched the node open to every
     * signed-in account, at `read` or `write`. Honoured only while the owner's
     * plan covers link sharing, so a lapsed plan silences the link without
     * anyone having to find and withdraw it; a deployment with no plan gates
     * honours it outright.
     */
    async #anyoneWithLinkAllows(
        actor: Actor,
        ancestors: ReadonlyArray<{ uid: string }>,
        mode: AclMode,
    ): Promise<boolean> {
        // Authority over the node is never handed out this way, and there has
        // to be an account on the other end for "anyone" to mean someone.
        if (mode === MANAGE_PERM_PREFIX) return false;
        if (typeof actor.user?.id !== 'number') return false;
        if (ancestors.length === 0) return false;

        const links = await this.stores.share.listAnyoneReaching(
            ancestors.map((ancestor) => ancestor.uid),
        );
        const covering = links.find((link) =>
            MODES_ABOVE[mode].some((above) => above === link.mode),
        );
        if (!covering) return false;
        return this.#planCoversLinkSharing(covering.ownerUserId);
    }

    /**
     * Whether the owner is on a plan that includes link sharing — the same
     * question `ShareService` asks when the link is made, asked again on each
     * use. Answered from the metering service's per-actor cache, so it costs a
     * map lookup once warm.
     */
    async #planCoversLinkSharing(ownerUserId: number): Promise<boolean> {
        const owner = await this.stores.user.getById(ownerUserId);
        if (!owner) return false;
        return actorHasSubscription(
            this.services.metering,
            makeActor({ user: owner }),
            true,
            this.config,
        );
    }

    /**
     * Permissions on `uid` that satisfy `mode`. `manage` sits above the whole
     * family — it answers any mode, but nothing answers it.
     *
     * Public because it also answers the reverse question: given a grant that
     * was just withdrawn, which stored checks did it hold up?
     */
    permissionsFor(uid: string, mode: AclMode): string[] {
        const manage = PermissionUtil.join(MANAGE_PERM_PREFIX, 'fs', uid);
        if (mode === MANAGE_PERM_PREFIX) return [manage];
        return [
            ...MODES_ABOVE[mode].map((m) => PermissionUtil.join('fs', uid, m)),
            manage,
        ];
    }

    /**
     * When a check fails, return a user-safe error: 404 if the actor can't even
     * `see` the resource (don't leak existence), 403 otherwise.
     */
    async getSafeAclError(
        actor: Actor,
        resource: ResourceDescriptor,
        _mode: AclMode,
    ): Promise<AclError> {
        const canSee = await this.check(actor, resource, 'see');
        if (!canSee) {
            return {
                status: 404,
                message: 'Subject does not exist',
                fields: { code: 'subject_does_not_exist' },
            };
        }
        return {
            status: 403,
            message: 'Forbidden',
            fields: { code: 'forbidden' },
        };
    }

    /** Descriptor for a filesystem path, its chain read from the store. */
    fsDescriptor(path: string): ResourceDescriptor {
        const fsEntry = this.stores.fsEntry;
        return memoizedDescriptor(path, () => fsEntry.getAncestorChain(path));
    }

    /** `check`, throwing the safe refusal (see `refusal`) when it fails. */
    async assertFsAccess(
        actor: Actor,
        resource: string | ResourceDescriptor,
        mode: AclMode,
        options: AclRefusalOptions = {},
    ): Promise<void> {
        const descriptor =
            typeof resource === 'string'
                ? this.fsDescriptor(resource)
                : resource;
        if (await this.check(actor, descriptor, mode)) return;
        throw await this.refusal(actor, descriptor, mode, options);
    }

    /**
     * Creating at `targetPath` takes `write` on the parent, or on the target
     * itself: that is what lets an app create its own
     * `/<user>/AppData/<app_uid>` (the parent is off-limits, the target is its
     * own subtree) and a recipient materialize a share granted on a path that
     * doesn't exist yet. Refused as a parent `write` would be.
     */
    async assertFsCreate(
        actor: Actor,
        targetPath: string,
        options: AclRefusalOptions = {},
    ): Promise<void> {
        const parent = pathPosix.dirname(targetPath);
        const parentDescriptor = this.fsDescriptor(
            parent === '/' ? targetPath : parent,
        );
        if (await this.check(actor, parentDescriptor, 'write')) return;
        if (await this.check(actor, this.fsDescriptor(targetPath), 'write'))
            return;
        throw await this.refusal(actor, parentDescriptor, 'write', options);
    }

    /** The error to answer a failed `check` with. */
    async refusal(
        actor: Actor,
        resource: ResourceDescriptor,
        mode: AclMode,
        options: AclRefusalOptions = {},
    ): Promise<HttpError> {
        if (options.hideFromApps && isAppActor(actor)) {
            return new HttpError(404, 'Subject does not exist', {
                legacyCode: 'subject_does_not_exist',
            });
        }
        return aclRefusal(
            await this.getSafeAclError(actor, resource, mode),
            options,
        );
    }

    /**
     * Stat user-to-user permissions on a resource, walking up the ancestor
     * chain. Returns a map from ancestor path → permissions the issuer has
     * granted the holder on that ancestor.
     */
    async statUserUser(
        issuer: Actor,
        holder: Actor,
        resource: ResourceDescriptor,
    ): Promise<StatPermissionsResult> {
        return this.#stat(this.#userHolder(issuer, holder), resource);
    }

    /** The group analogue of `statUserUser`; no holder actor to validate. */
    async statUserGroup(
        issuer: Actor,
        groupUid: string,
        resource: ResourceDescriptor,
    ): Promise<StatPermissionsResult> {
        return this.#stat(this.#groupHolder(issuer, groupUid), resource);
    }

    /**
     * Grant `mode` on `resource` from `issuer` to `holder`, clearing any
     * existing different-mode grants on the same node. No-op if the same mode
     * (or, with `onlyIfHigher`, a higher mode) is already present.
     *
     * Returns `false` when no write was necessary; `true` when a grant (and
     * possibly revokes) were issued.
     */
    async setUserUser(
        issuer: Actor,
        holder: Actor,
        resource: ResourceDescriptor,
        mode: AclMode,
        options: { onlyIfHigher?: boolean } = {},
    ): Promise<boolean> {
        const userHolder = this.#userHolder(issuer, holder);
        if (!holder.user.username)
            throw new HttpError(400, 'holder is missing username', {
                legacyCode: 'bad_request',
            });
        return this.#set(issuer, userHolder, resource, mode, options);
    }

    /** Same read-modify-write and one-mode-per-node rule as `setUserUser`. */
    async setUserGroup(
        issuer: Actor,
        groupUid: string,
        resource: ResourceDescriptor,
        mode: AclMode,
        options: { onlyIfHigher?: boolean } = {},
    ): Promise<boolean> {
        return this.#set(
            issuer,
            this.#groupHolder(issuer, groupUid),
            resource,
            mode,
            options,
        );
    }

    #userHolder(issuer: Actor, holder: Actor): AclHolder {
        if (!isPlainUserActor(issuer))
            throw new HttpError(403, 'issuer must be a user actor', {
                legacyCode: 'forbidden',
            });
        if (!isPlainUserActor(holder))
            throw new HttpError(403, 'holder must be a user actor', {
                legacyCode: 'forbidden',
            });
        const permission = this.services.permission;
        // Read when a write happens; `setUserUser` has checked it by then.
        const username = () => holder.user.username as string;
        return {
            lockKey: String(holder.user.id),
            query: (prefix) =>
                permission.queryIssuerHolderPermissionsByPrefix(
                    issuer,
                    holder,
                    prefix,
                ),
            grant: (perm) =>
                permission.grantUserUserPermission(issuer, username(), perm),
            revoke: (perm) =>
                permission.revokeUserUserPermission(issuer, username(), perm),
        };
    }

    #groupHolder(issuer: Actor, groupUid: string): AclHolder {
        if (!isPlainUserActor(issuer))
            throw new HttpError(403, 'issuer must be a user actor', {
                legacyCode: 'forbidden',
            });
        const permission = this.services.permission;
        return {
            lockKey: `group:${groupUid}`,
            query: (prefix) =>
                permission.queryIssuerGroupPermissionsByPrefix(
                    issuer,
                    groupUid,
                    prefix,
                ),
            grant: (perm) =>
                permission.grantUserGroupPermission(issuer, groupUid, perm),
            revoke: (perm) =>
                permission.revokeUserGroupPermission(issuer, groupUid, perm),
        };
    }

    async #stat(
        holder: AclHolder,
        resource: ResourceDescriptor,
    ): Promise<StatPermissionsResult> {
        const out: StatPermissionsResult = {};
        const ancestors = await resource.resolveAncestors();
        for (const ancestor of ancestors) {
            // Both namespaces: a `manage:fs:<uid>` grant lives outside the
            // `fs:<uid>` prefix, and `#set` relies on seeing it — otherwise
            // downgrading a manage share to a weaker mode leaves the manage
            // grant in place.
            const prefixes = [
                PermissionUtil.join('fs', ancestor.uid),
                PermissionUtil.join(MANAGE_PERM_PREFIX, 'fs', ancestor.uid),
            ];
            const perms = (
                await Promise.all(
                    prefixes.map((prefix) => holder.query(prefix)),
                )
            ).flat();
            if (perms.length > 0) out[ancestor.path] = perms;
        }
        return out;
    }

    async #set(
        issuer: Actor,
        holder: AclHolder,
        resource: ResourceDescriptor,
        mode: AclMode,
        options: { onlyIfHigher?: boolean },
    ): Promise<boolean> {
        // Resolved up front so the whole read-modify-write runs under one
        // lock. Descriptors cache the chain, so `#stat` reuses this.
        const ancestors = await resource.resolveAncestors();
        const self = ancestors[0];
        if (!self)
            throw new HttpError(
                400,
                'resource has no ancestor chain (is it root?)',
                { legacyCode: 'bad_request' },
            );

        return this.#withNodeLock(
            `${issuer.user.id}:${holder.lockKey}:${self.uid}`,
            () => this.#setLocked(holder, resource, mode, self.uid, options),
        );
    }

    /**
     * Body of {@link setUserUser} / {@link setUserGroup}. Read-modify-write, so
     * it only runs under the lock above: concurrent calls would each act on
     * their own snapshot and both grants would survive.
     */
    async #setLocked(
        holder: AclHolder,
        resource: ResourceDescriptor,
        mode: AclMode,
        uid: string,
        options: { onlyIfHigher?: boolean },
    ): Promise<boolean> {
        const stat = await this.#stat(holder, resource);
        const existing = stat[resource.path] ?? [];

        const modeOf = (perm: string) =>
            PermissionUtil.isManage(perm)
                ? MANAGE_PERM_PREFIX
                : PermissionUtil.split(perm).at(-1);
        const existingModes = existing.map(modeOf);
        const superseded = existing.filter((perm) => modeOf(perm) !== mode);
        const already = existingModes.includes(mode);

        // A half-finished downgrade leaves the higher grant for this to clear.
        if (already && superseded.length === 0) return false;

        if (options.onlyIfHigher) {
            const higher = MODES_ABOVE[mode] ?? [mode];
            if (
                existingModes.some(
                    (m) =>
                        m === MANAGE_PERM_PREFIX ||
                        (m && higher.includes(m as AclMode)),
                )
            ) {
                return false;
            }
        }

        // Unconditional: the read above can be a stale replica.
        const newPerm =
            mode === MANAGE_PERM_PREFIX
                ? PermissionUtil.join(MANAGE_PERM_PREFIX, 'fs', uid)
                : PermissionUtil.join('fs', uid, mode);
        await holder.grant(newPerm);

        // One mode per node per issuer/holder — higher modes supersede lower.
        for (const perm of superseded) {
            await holder.revoke(perm);
        }
        return true;
    }

    /**
     * Serialize writes to one (issuer, holder, node) triple. Fails open on a
     * Redis error — a narrow race beats taking sharing down with the cache.
     */
    #withNodeLock<T>(suffix: string, fn: () => Promise<T>): Promise<T> {
        return withRedisLock(
            this.clients.redis,
            `acl:set-user-user:${suffix}`,
            fn,
            {
                ttlMs: SET_USER_LOCK_TTL_SECONDS * 1000,
                attempts: SET_USER_LOCK_ATTEMPTS,
                retryMs: SET_USER_LOCK_RETRY_MS,
                onUnavailable: 'run',
                onBusy: () => {
                    throw new HttpError(
                        409,
                        'another change to this share is in progress',
                        { legacyCode: 'conflict' },
                    );
                },
            },
        );
    }

    /**
     * The highest mode currently in the ACL hierarchy. Callers that gate on
     * "top-level" access (e.g., share-everything) should use this instead of
     * hardcoding 'write', so additions (e.g., a future 'config' mode) don't
     * require sweeping call-site changes.
     */
    getHighestMode(): AclMode {
        return 'write';
    }

    /** Modes that imply `mode`. */
    higherModes(mode: AclMode): AclMode[] {
        return MODES_ABOVE[mode] ?? [mode];
    }
}
