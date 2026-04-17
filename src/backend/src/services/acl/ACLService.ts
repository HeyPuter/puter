import type { LayerInstances } from '../../types';
import type { puterServices } from '../index';
import { PuterService } from '../types';
import type { Actor } from '../../core/actor';
import { isSystemActor } from '../../core/actor';
import { PermissionUtil } from '../permission/permissionUtil';
import { MANAGE_PERM_PREFIX } from '../permission/consts';

// ── Types ────────────────────────────────────────────────────────────

/**
 * Thin, filesystem-agnostic view of a resource for ACL checks.
 *
 * Callers construct a descriptor from whatever entry metadata they already
 * have; ACL does not depend on the filesystem layer. FSController does
 * exactly this (see its `resourceDescriptor` in `#assertWriteAccess`).
 *
 * `resolveAncestors()` MUST return the chain starting with the resource
 * itself and ending at the direct child of root. Empty means "root".
 */
export interface ResourceDescriptor {
    path: string;
    resolveAncestors: () => Promise<ReadonlyArray<{ uid: string; path: string }>>;
}

export type AclMode = 'see' | 'list' | 'read' | 'write' | typeof MANAGE_PERM_PREFIX;

/** Duck-typed error shape compatible with APIError consumers (fsv2). */
export interface AclError {
    status: number;
    message: string;
    fields: { code: string };
}

interface StatPermissionsResult {
    [path: string]: string[];
}

const MODES_ABOVE: Record<AclMode, AclMode[]> = {
    see: ['see', 'list', 'read', 'write'],
    list: ['list', 'read', 'write'],
    read: ['read', 'write'],
    write: ['write'],
    [MANAGE_PERM_PREFIX]: [MANAGE_PERM_PREFIX],
};

const PUBLIC_READ_MODES: ReadonlyArray<AclMode> = Object.freeze(['read', 'list', 'see']);

// ── ACLService ───────────────────────────────────────────────────────

/**
 * ACLService enforces filesystem access-control semantics for Puter.
 *
 * Design notes:
 *
 * - **No FSNode dependency.** Callers pass a `ResourceDescriptor` duck type
 *   (`{ path, resolveAncestors() }`). This lets ACL live as a service
 *   without pulling in the filesystem layer (which would create a circular
 *   dependency).
 * - **No route registration.** The service is pure; a controller exposes
 *   `/acl/stat-user-user` and `/acl/set-user-user`.
 *
 * Tree-walks are done via `resolveAncestors()`, which returns a
 * pre-resolved ancestor chain from the caller's FS layer.
 */
export class ACLService extends PuterService {
    declare protected services: LayerInstances<typeof puterServices>;

    // ── Public API ───────────────────────────────────────────────────

    /**
     * Returns true iff `actor` is allowed to perform `mode` access on `resource`.
     */
    async check (actor: Actor, resource: ResourceDescriptor, mode: AclMode): Promise<boolean> {
        if ( isSystemActor(actor) ) return true;

        if ( resource.path === '/' ) {
            return (PUBLIC_READ_MODES as AclMode[]).includes(mode);
        }

        const components = resource.path.slice(1).split('/');

        // Short-circuit: users accessing their own home directory.
        if ( ! actor.app && ! actor.accessToken ) {
            const username = actor.user.username;
            if ( username && (resource.path === `/${username}` || resource.path.startsWith(`/${username}/`)) ) {
                return true;
            }
        }

        // Short-circuit: apps accessing their own AppData directory (under
        // any user). Shared-appdata access is handled below via the
        // per-user-permission gate.
        if ( actor.app && ! actor.accessToken ) {
            const username = actor.user.username;
            const appUid = actor.app.uid;
            if ( username ) {
                const appDataPath = `/${username}/AppData/${appUid}`;
                if ( resource.path === appDataPath || resource.path.startsWith(`${appDataPath}/`) ) {
                    return true;
                }
            }
        }

        // Public folders: /<user>/Public with read-ish mode, owner must have
        // confirmed email (or be admin).
        if ( this.config.enable_public_folders
            && (PUBLIC_READ_MODES as AclMode[]).includes(mode)
            && components.length > 1
            && components[1] === 'Public'
        ) {
            const ownerUsername = components[0];
            const owner = await this.stores.user.getByUsername(ownerUsername);
            if ( owner ) {
                if ( (owner.email_confirmed ?? false) || owner.username === 'admin' ) {
                    return true;
                }
            }
        }

        // Access tokens: authorizer must have the permission, AND the token
        // itself must have it (or inherit it via an ancestor).
        if ( actor.accessToken ) {
            const authorizer = actor.accessToken.issuer;
            if ( ! await this.check(authorizer, resource, mode) ) return false;

            const ancestors = await resource.resolveAncestors();
            for ( const ancestor of ancestors ) {
                const permission = mode === MANAGE_PERM_PREFIX
                    ? PermissionUtil.join(MANAGE_PERM_PREFIX, 'fs', ancestor.uid)
                    : PermissionUtil.join('fs', ancestor.uid, mode);
                if ( await this.stores.permission.hasAccessTokenPerm(actor.accessToken.uid, permission) ) {
                    return true;
                }
            }
            return false;
        }

        // App-under-user: underlying user must also hold the permission.
        if ( actor.app ) {
            const userActor: Actor = { user: actor.user };
            if ( ! await this.check(userActor, resource, mode) ) return false;

            // Shared-appdata rule: an app accessing its AppData under a
            // *different* user is allowed iff that user has access (checked
            // above), i.e. the directory has been explicitly shared.
            if ( components[0] !== actor.user.username
                && components[1] === 'AppData'
                && components[2] === actor.app.uid
            ) {
                return true;
            }
        }

        // Fall back to the permission scan: walk ancestors, any hit wins.
        const ancestors = await resource.resolveAncestors();
        for ( const ancestor of ancestors ) {
            const permission = mode === MANAGE_PERM_PREFIX
                ? PermissionUtil.join(MANAGE_PERM_PREFIX, 'fs', ancestor.uid)
                : PermissionUtil.join('fs', ancestor.uid, mode);
            const reading = await this.services.permission.scan(actor, [permission]);
            const options = PermissionUtil.readingToOptions(reading);
            if ( options.length > 0 ) return true;
        }

        return false;
    }

    /**
     * When a check fails, return a user-safe error: 404 if the actor can't
     * even `see` the resource (don't leak existence), 403 otherwise.
     */
    async getSafeAclError (actor: Actor, resource: ResourceDescriptor, _mode: AclMode): Promise<AclError> {
        const canSee = await this.check(actor, resource, 'see');
        if ( ! canSee ) {
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

    /**
     * Stat user-to-user permissions on a resource, walking up the ancestor
     * chain. Returns a map from ancestor path → permissions the issuer has
     * granted the holder on that ancestor.
     *
     * Caller (controller) validates that both actors are user-type.
     */
    async statUserUser (
        issuer: Actor,
        holder: Actor,
        resource: ResourceDescriptor,
    ): Promise<StatPermissionsResult> {
        if ( issuer.app || issuer.accessToken ) throw new Error('issuer must be a user actor');
        if ( holder.app || holder.accessToken ) throw new Error('holder must be a user actor');

        const out: StatPermissionsResult = {};
        const ancestors = await resource.resolveAncestors();
        for ( const ancestor of ancestors ) {
            const prefix = PermissionUtil.join('fs', ancestor.uid);
            const perms = await this.services.permission.queryIssuerHolderPermissionsByPrefix(issuer, holder, prefix);
            if ( perms.length > 0 ) out[ancestor.path] = perms;
        }
        return out;
    }

    /**
     * Grant `mode` on `resource` from `issuer` to `holder`, clearing any
     * existing different-mode grants on the same node. No-op if the same
     * mode (or, with `onlyIfHigher`, a higher mode) is already present.
     *
     * Returns `false` when no write was necessary; `true` when a grant
     * (and possibly revokes) were issued.
     */
    async setUserUser (
        issuer: Actor,
        holder: Actor,
        resource: ResourceDescriptor,
        mode: AclMode,
        options: { onlyIfHigher?: boolean } = {},
    ): Promise<boolean> {
        if ( issuer.app || issuer.accessToken ) throw new Error('issuer must be a user actor');
        if ( holder.app || holder.accessToken ) throw new Error('holder must be a user actor');
        if ( ! holder.user.username ) throw new Error('holder is missing username');

        const stat = await this.statUserUser(issuer, holder, resource);
        const existing = stat[resource.path] ?? [];

        const existingModes = existing.map(p =>
            PermissionUtil.isManage(p) ? MANAGE_PERM_PREFIX : PermissionUtil.split(p).at(-1));

        if ( existingModes.includes(mode) ) return false;

        if ( options.onlyIfHigher ) {
            const higher = MODES_ABOVE[mode] ?? [mode];
            if ( existingModes.some(m => m === MANAGE_PERM_PREFIX || (m && higher.includes(m as AclMode))) ) {
                return false;
            }
        }

        // Resolve the resource's own uid — first element of the ancestor
        // chain is the resource itself (see ResourceDescriptor docstring).
        const ancestors = await resource.resolveAncestors();
        const self = ancestors[0];
        if ( ! self ) throw new Error('resource has no ancestor chain (is it root?)');
        const uid = self.uid;

        const newPerm = mode === MANAGE_PERM_PREFIX
            ? PermissionUtil.join(MANAGE_PERM_PREFIX, 'fs', uid)
            : PermissionUtil.join('fs', uid, mode);
        await this.services.permission.grantUserUserPermission(issuer, holder.user.username, newPerm);

        // Revoke any other modes on the same node (ACL enforces one mode per
        // node per issuer/holder — higher modes supersede lower).
        for ( const perm of existing ) {
            const existingMode = PermissionUtil.isManage(perm)
                ? MANAGE_PERM_PREFIX
                : PermissionUtil.split(perm).at(-1);
            if ( existingMode === mode ) continue;
            await this.services.permission.revokeUserUserPermission(issuer, holder.user.username, perm);
        }
        return true;
    }

    /**
     * The highest mode currently in the ACL hierarchy. Callers that gate on
     * "top-level" access (e.g., share-everything) should use this instead of
     * hardcoding 'write', so additions (e.g., a future 'config' mode) don't
     * require sweeping call-site changes.
     */
    getHighestMode (): AclMode {
        return 'write';
    }

    /** Modes that imply `mode`. */
    higherModes (mode: AclMode): AclMode[] {
        return MODES_ABOVE[mode] ?? [mode];
    }
}
