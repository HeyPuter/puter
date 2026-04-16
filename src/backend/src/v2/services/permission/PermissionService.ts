import { PuterService } from '../types';
import type { Actor, ActorUser } from '../../core/actor';
import { actorUid, isSystemActor, userRelatedActor } from '../../core/actor';
import {
    PermissionUtil,
    readingHasTerminal,
    type ReadingNode,
    type PermissionRewriter,
    type PermissionImplicator,
    type PermissionExploder,
} from './permissionUtil';
import { MANAGE_PERM_PREFIX, PERMISSION_SCAN_CACHE_TTL_SECONDS } from './consts';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — hardcoded-permissions.js is plain JS
import {
    default_implicit_user_app_permissions,
    implicit_user_app_permissions,
    hardcoded_user_group_permissions,
} from '../../data/hardcoded-permissions.js';

// ── Types ────────────────────────────────────────────────────────────

export interface ScanOptions {
    noCache?: boolean;
}

export interface ScanState {
    antiCycleActors: Actor[];
}

export interface GrantMeta {
    reason?: string;
}

/**
 * PermissionService owns the *semantics* side of permissions:
 * - The rule registries (rewriters, implicators, exploders)
 * - The `scan()` algorithm that traverses all the ways an actor might hold a permission
 * - grant/revoke orchestration (rewrite → canManage → store writes → cache invalidation)
 *
 * All persistence is delegated to PermissionStore.
 */
export class PermissionService extends PuterService {
    private readonly rewriters: PermissionRewriter[] = [];
    private readonly implicators: PermissionImplicator[] = [];
    private readonly exploders: PermissionExploder[] = [];
    /**
     * System-issued grants registered at runtime by other services. Keyed by
     * group UID, then by permission string. Merged with the imported
     * `hardcoded_user_group_permissions.system` map during the hc-user-group
     * scan. Replaces v1's `__on_boot.consolidation` + event-bus mutation of
     * the imported module.
     */
    private readonly systemGrantsByGroupUid: Record<string, Record<string, unknown>> = {};

    // ── Extension hooks ──────────────────────────────────────────────
    //
    // Other services contribute domain semantics via these. A controller or
    // driver *could* register too, but typically the owning service for a
    // permission namespace (fs, app, site, ...) is the right place.

    registerRewriter (rewriter: PermissionRewriter): void {
        this.rewriters.push(rewriter);
    }

    registerImplicator (implicator: PermissionImplicator): void {
        this.implicators.push(implicator);
    }

    registerExploder (exploder: PermissionExploder): void {
        this.exploders.push(exploder);
    }

    /**
     * Grant a permission (as issued by `system`) to everyone — members of
     * both the default user group and the default temp group.
     *
     * V2 replacement for v1's `svc_event.emit('create.permissions', event)` +
     * `event.grant_to_everyone(permission)` dance. Call from an owning
     * service's `onServerStart` (or later).
     */
    registerSystemGrantForEveryone (permission: string, data: unknown = {}): void {
        const userGroup = this.config.default_user_group;
        const tempGroup = this.config.default_temp_group;
        if ( userGroup ) this.#addSystemGrant(userGroup, permission, data);
        if ( tempGroup ) this.#addSystemGrant(tempGroup, permission, data);
    }

    /**
     * Grant a permission (as issued by `system`) to non-temp users only —
     * members of the default user group, but not the default temp group.
     *
     * V2 replacement for v1's `event.grant_to_users(permission)`.
     */
    registerSystemGrantForUsers (permission: string, data: unknown = {}): void {
        const userGroup = this.config.default_user_group;
        if ( userGroup ) this.#addSystemGrant(userGroup, permission, data);
    }

    #addSystemGrant (groupUid: string, permission: string, data: unknown): void {
        if ( ! this.systemGrantsByGroupUid[groupUid] ) {
            this.systemGrantsByGroupUid[groupUid] = {};
        }
        this.systemGrantsByGroupUid[groupUid][permission] = data;
    }

    // ── Rewrite / explode (pure-ish helpers) ────────────────────────

    async rewritePermission (permission: string): Promise<string> {
        for ( const rewriter of this.rewriters ) {
            if ( ! rewriter.matches(permission) ) continue;
            permission = await rewriter.rewrite(permission);
        }
        return permission;
    }

    /** Return the given permission plus all parents and their exploder expansions. */
    async getHigherPermissions (permission: string): Promise<string[]> {
        const higher = new Set<string>();
        higher.add(permission);
        for ( const parent of this.getParentPermissions(permission) ) {
            higher.add(parent);
            for ( const exploder of this.exploders ) {
                if ( ! exploder.matches(parent) ) continue;
                const more = await exploder.explode({ permission: parent });
                for ( const p of more ) higher.add(p);
            }
        }
        return [...higher];
    }

    getParentPermissions (permission: string): string[] {
        // Keep components escaped — we match against stored permission strings verbatim.
        const parts = permission.split(':');
        const parents: string[] = [];
        for ( let i = 0; i < parts.length; i++ ) {
            parents.push(parts.slice(0, i + 1).join(':'));
        }
        parents.reverse();
        return parents;
    }

    // ── Public check / scan API ──────────────────────────────────────

    async check (actor: Actor, permissionOptions: string | string[], scanOptions?: ScanOptions): Promise<boolean> {
        const reading = await this.scan(actor, permissionOptions, undefined, scanOptions);
        const options = PermissionUtil.readingToOptions(reading);
        return options.length > 0;
    }

    async canManagePermission (actor: Actor, permission: string): Promise<boolean> {
        const managePerm = PermissionUtil.join(MANAGE_PERM_PREFIX, ...PermissionUtil.split(permission));
        return await this.check(actor, managePerm);
    }

    /**
     * Scan all paths by which `actor` might hold any of the given permission
     * options. Returns a tree-shaped "reading". Use
     * `PermissionUtil.readingToOptions()` to flatten to a yes/no answer.
     *
     * Replaces v1's Sequence-based `scan` and `PERMISSION_SCANNERS` with
     * straight sequential logic.
     */
    async scan (
        actor: Actor,
        permissionOptions: string | string[],
        state?: ScanState,
        scanOptions: ScanOptions = {},
    ): Promise<ReadingNode[]> {
        let options = Array.isArray(permissionOptions) ? [...permissionOptions] : [permissionOptions];
        const reading: ReadingNode[] = [];
        const workingState: ScanState = state ?? { antiCycleActors: [actor] };

        // ── Redis scan cache ──
        const cacheKey = this.stores.permission.buildScanCacheKey(actorUid(actor), options);
        if ( ! scanOptions.noCache ) {
            const cached = await this.stores.permission.getScanCache(cacheKey);
            if ( cached ) return cached as ReadingNode[];
        }

        const startTs = Date.now();

        // ── grant_if_system short-circuit ──
        if ( isSystemActor(actor) ) {
            reading.push({
                $: 'option',
                key: 'sys',
                permission: options[0],
                source: 'implied',
                by: 'system',
                data: {},
            });
            reading.push({ $: 'time', value: Date.now() - startTs });
            await this.#maybeCacheScan(cacheKey, reading);
            return reading;
        }

        // ── rewrite ──
        for ( let i = 0; i < options.length; i++ ) {
            const old = options[i];
            const rewritten = await this.rewritePermission(old);
            if ( rewritten === old ) continue;
            options[i] = rewritten;
            reading.push({ $: 'rewrite', from: old, to: rewritten });
        }

        // ── explode (parents + exploders) ──
        const exploded: string[][] = [];
        for ( let i = 0; i < options.length; i++ ) {
            const perm = options[i];
            const higher = await this.getHigherPermissions(perm);
            exploded[i] = higher;
            if ( higher.length > 1 ) {
                reading.push({ $: 'explode', from: perm, to: higher });
            }
        }
        options = exploded.flat();

        // ── shortcut implicators ──
        let shortCircuit = false;
        for ( const permission of options ) {
            for ( const implicator of this.implicators ) {
                if ( ! implicator.shortcut ) continue;
                if ( ! implicator.matches(permission) ) continue;
                const implied = await implicator.check({ actor, permission });
                if ( ! implied ) continue;
                reading.push({
                    $: 'option',
                    permission,
                    source: 'implied',
                    by: implicator.id,
                    data: implied,
                    ...(actor.user?.username ? { holder_username: actor.user.username } : {}),
                });
                shortCircuit = true;
                break;
            }
            if ( shortCircuit ) break;
        }

        if ( ! shortCircuit ) {
            // ── scanners (formerly PERMISSION_SCANNERS) ──
            await this.#scanNonShortcutImplicators(actor, options, reading);
            await this.#scanAccessToken(actor, options, reading);
            await this.#scanUserUser(actor, options, reading, workingState);
            await this.#scanHcUserGroupUser(actor, options, reading);
            await this.#scanUserGroup(actor, options, reading);
            await this.#scanUserAppImplied(actor, options, reading);
            await this.#scanUserApp(actor, options, reading);
            await this.#scanDevApp(actor, options, reading);
        }

        reading.push({ $: 'time', value: Date.now() - startTs });
        await this.#maybeCacheScan(cacheKey, reading);
        return reading;
    }

    async #maybeCacheScan (cacheKey: string, reading: ReadingNode[]): Promise<void> {
        try {
            await this.stores.permission.setScanCache(cacheKey, reading, PERMISSION_SCAN_CACHE_TTL_SECONDS);
        } catch {
            // cache write failures should never block a permission decision
        }
    }

    // ── Scanners (inlined, no Sequence) ──────────────────────────────

    async #scanNonShortcutImplicators (actor: Actor, options: string[], reading: ReadingNode[]): Promise<void> {
        for ( const permission of options ) {
            for ( const implicator of this.implicators ) {
                if ( implicator.shortcut ) continue;
                if ( ! implicator.matches(permission) ) continue;
                const implied = await implicator.check({ actor, permission });
                if ( ! implied ) continue;
                reading.push({
                    $: 'option',
                    permission,
                    source: 'implied',
                    by: implicator.id,
                    data: implied,
                    ...(actor.user?.username ? { holder_username: actor.user.username } : {}),
                });
            }
        }
    }

    async #scanAccessToken (actor: Actor, options: string[], reading: ReadingNode[]): Promise<void> {
        if ( ! actor.accessToken ) return;
        const issuerActor = actor.accessToken.issuer;
        for ( const permission of options ) {
            const hasTokenPerm = await this.stores.permission.hasAccessTokenPerm(actor.accessToken.uid, permission);
            if ( ! hasTokenPerm ) continue;
            const issuerReading = await this.scan(issuerActor, permission);
            reading.push({
                $: 'path',
                via: 'access-token',
                has_terminal: readingHasTerminal(issuerReading),
                permission,
                reading: issuerReading,
            });
        }
    }

    async #scanUserUser (actor: Actor, options: string[], reading: ReadingNode[], state: ScanState): Promise<void> {
        if ( actor.app || actor.accessToken ) return;
        const subReadings = await this.validateUserPerms({ actor, permissions: options, state });
        reading.push(...subReadings);
    }

    /**
     * Mirrors v1's `hc-user-group-user` scanner. Resolves permissions that
     * a persistent group's members inherit from an issuer (typically
     * `system`) via the hardcoded map in `hardcoded-permissions.js`, merged
     * with any runtime grants registered through
     * `registerSystemGrantForEveryone` / `registerSystemGrantForUsers`.
     */
    async #scanHcUserGroupUser (actor: Actor, options: string[], reading: ReadingNode[]): Promise<void> {
        if ( actor.app || actor.accessToken ) return;
        if ( ! actor.user?.id ) return;

        const memberGroups = await this.stores.group.listGroupsWithMember(actor.user.id);
        if ( memberGroups.length === 0 ) return;

        const groupByUid: Record<string, { id: number; uid: string }> = {};
        for ( const g of memberGroups ) {
            groupByUid[g.uid] = { id: g.id, uid: g.uid };
        }

        // Compose the effective issuer → group → permission → data map by
        // merging the imported hardcoded data with runtime-registered system
        // grants. Runtime grants are always attributed to the `system` issuer.
        const hcMap = hardcoded_user_group_permissions as Record<string, Record<string, Record<string, unknown>>>;
        const hasRuntimeGrants = Object.keys(this.systemGrantsByGroupUid).length > 0;
        const byIssuer: Record<string, Record<string, Record<string, unknown>>> = hasRuntimeGrants
            ? { ...hcMap, system: { ...(hcMap.system ?? {}) } }
            : hcMap;
        if ( hasRuntimeGrants ) {
            for ( const [gUid, perms] of Object.entries(this.systemGrantsByGroupUid) ) {
                byIssuer.system[gUid] = { ...(byIssuer.system[gUid] ?? {}), ...perms };
            }
        }

        for ( const issuerUsername of Object.keys(byIssuer) ) {
            const issuerUser = await this.stores.user.getByUsername(issuerUsername);
            if ( ! issuerUser ) continue;
            const issuerActor = this.#userToActor(issuerUser);
            const issuerGroups = byIssuer[issuerUsername];

            for ( const groupUid of Object.keys(issuerGroups) ) {
                if ( ! groupByUid[groupUid] ) continue;
                const issuerGroupPerms = issuerGroups[groupUid];

                for ( const permission of options ) {
                    if ( ! Object.prototype.hasOwnProperty.call(issuerGroupPerms, permission) ) continue;
                    const issuerReading = await this.scan(issuerActor, permission);
                    reading.push({
                        $: 'path',
                        via: 'hc-user-group',
                        has_terminal: readingHasTerminal(issuerReading),
                        permission,
                        data: issuerGroupPerms[permission],
                        holder_username: actor.user.username,
                        issuer_username: issuerUsername,
                        reading: issuerReading,
                        group_id: groupByUid[groupUid].id,
                    });
                }
            }
        }
    }

    async #scanUserGroup (actor: Actor, options: string[], reading: ReadingNode[]): Promise<void> {
        if ( actor.app || actor.accessToken ) return;
        if ( ! actor.user?.id ) return;

        const rows = await this.stores.permission.readUserGroupPerms(actor.user.id, options);
        for ( const row of rows ) {
            const issuerUser = await this.stores.user.getById(row.user_id);
            if ( ! issuerUser ) continue;
            const issuerActor = this.#userToActor(issuerUser);
            const issuerReading = await this.scan(issuerActor, row.permission);
            reading.push({
                $: 'path',
                via: 'user-group',
                has_terminal: readingHasTerminal(issuerReading),
                permission: row.permission,
                data: row.extra,
                holder_username: actor.user?.username,
                issuer_username: issuerUser.username,
                reading: issuerReading,
                group_id: row.group_id,
            });
        }
    }

    async #scanUserAppImplied (actor: Actor, options: string[], reading: ReadingNode[]): Promise<void> {
        if ( ! actor.app ) return;
        const issuerActor = userRelatedActor(actor);
        const issuerReading = await this.scan(issuerActor, options);
        const hasTerminal = readingHasTerminal(issuerReading);
        const appUid = actor.app.uid;

        for ( const permission of options ) {
            const implied = (default_implicit_user_app_permissions as Record<string, unknown>)[permission];
            if ( implied ) {
                reading.push({
                    $: 'path',
                    permission,
                    has_terminal: hasTerminal,
                    source: 'user-app-implied',
                    by: 'user-app-hc-1',
                    data: implied,
                    issuer_username: actor.user?.username,
                    reading: issuerReading,
                });
            }

            // per-app hardcoded overrides
            const hits: Record<string, unknown> = {};
            for ( const bucket of (implicit_user_app_permissions as Array<{ apps: string[]; permissions: Record<string, unknown> }>) ) {
                if ( bucket.apps.includes(appUid) ) {
                    hits[permission] = bucket.permissions[permission];
                }
            }
            if ( hits[permission] ) {
                reading.push({
                    $: 'path',
                    permission,
                    has_terminal: hasTerminal,
                    source: 'user-app-implied',
                    by: 'user-app-hc-2',
                    data: hits[permission],
                    issuer_username: actor.user?.username,
                    reading: issuerReading,
                });
            }
        }
    }

    async #scanUserApp (actor: Actor, options: string[], reading: ReadingNode[]): Promise<void> {
        if ( !actor.app || !actor.user?.id || !actor.app.id ) return;
        const rows = await this.stores.permission.readUserAppPerms(actor.user.id, actor.app.id, options);
        const row = rows[0];
        if ( ! row ) return;

        const issuerActor = userRelatedActor(actor);
        const issuerReading = await this.scan(issuerActor, row.permission);
        reading.push({
            $: 'path',
            via: 'user-app',
            permission: row.permission,
            has_terminal: readingHasTerminal(issuerReading),
            data: row.extra,
            issuer_username: actor.user?.username,
            reading: issuerReading,
        });
    }

    async #scanDevApp (actor: Actor, options: string[], reading: ReadingNode[]): Promise<void> {
        if ( !actor.app || !actor.app.id ) return;
        const rows = await this.stores.permission.readDevAppPerms(actor.app.id, options);
        const row = rows[0];
        if ( ! row ) return;

        const issuerUser = await this.stores.user.getById(row.user_id);
        if ( ! issuerUser ) return;
        const issuerActor = this.#userToActor(issuerUser);
        const issuerReading = await this.scan(issuerActor, row.permission);
        reading.push({
            $: 'path',
            via: 'dev-app',
            permission: row.permission,
            has_terminal: readingHasTerminal(issuerReading),
            data: row.extra,
            issuer_username: actor.user?.username,
            reading: issuerReading,
        });
    }

    // ── validateUserPerms (flat + linked reads) ──────────────────────

    /**
     * Resolves user-to-user permissions for an actor across the given
     * permission strings. Prefers the "flat" KV view when present; otherwise
     * falls back to a SQL traversal of `user_to_user_permissions` and
     * warms the flat KV cache as a side-effect.
     */
    async validateUserPerms ({ actor, permissions, state }: {
        actor: Actor;
        permissions: string[];
        state?: ScanState;
    }): Promise<ReadingNode[]> {
        if ( ! actor.user?.id ) return [];

        const flatPromise = this.#flatValidateUserPerms(actor, permissions);
        const linkedPromise = this.#linkedValidateUserPerms(
            actor,
            permissions,
            state ?? { antiCycleActors: [actor] },
        );

        const flatReading = await flatPromise;
        if ( flatReading.length > 0 ) {
            return flatReading[0].deleted ? [] : flatReading;
        }

        const linkedReading = await linkedPromise;
        const flatOptions = PermissionUtil.readingToOptions(linkedReading);

        // Warm flat KV cache for future hits (fire-and-forget, don't block result)
        for ( const opt of flatOptions ) {
            if ( ! opt.permission ) continue;
            const data = Array.isArray(opt.data) ? opt.data : [opt.data];
            const issuerUserId = (data[0] as { issuer_user_id?: number })?.issuer_user_id;
            this.stores.permission.setFlatUserPerm(actor.user.id, opt.permission, {
                permission: opt.permission,
                issuer_user_id: issuerUserId,
                data,
            }).catch(() => {
                /* swallow — this is a cache warm */
            });
        }

        return flatReading;
    }

    async #flatValidateUserPerms (actor: Actor, permissions: string[]): Promise<ReadingNode[]> {
        if ( ! actor.user?.id ) return [];
        const values = await this.stores.permission.getFlatUserPerms(actor.user.id, permissions);

        let anyDeleted = false;
        for ( const v of values ) {
            if ( v.deleted ) {
                anyDeleted = true; continue;
            }
            const { permission, issuer_user_id, ...extra } = v;
            if ( ! permission ) continue;
            const issuer = issuer_user_id ? await this.stores.user.getById(issuer_user_id) : null;
            return [{
                $: 'option',
                via: 'user',
                has_terminal: true,
                permission,
                data: extra,
                holder_username: actor.user.username,
                issuer_username: issuer?.username,
                issuer_user_id: issuer?.uuid,
                reading: [],
            }];
        }
        return anyDeleted ? [{ $: 'option', deleted: true }] : [];
    }

    async #linkedValidateUserPerms (actor: Actor, permissions: string[], state: ScanState): Promise<ReadingNode[]> {
        if ( ! actor.user?.id ) return [];
        const rows = await this.stores.permission.readLinkedUserUserPerms(actor.user.id, permissions);

        const out: ReadingNode[] = [];
        for ( const row of rows ) {
            const issuerUser = await this.stores.user.getById(row.issuer_user_id);
            if ( ! issuerUser ) continue;
            const issuerActor = this.#userToActor(issuerUser);

            // anti-cycle
            let skip = false;
            for ( const seen of state.antiCycleActors ) {
                if ( seen.user?.id === issuerActor.user.id ) {
                    skip = true; break;
                }
            }
            if ( skip ) continue;

            const issuerReading = await this.scan(issuerActor, row.permission, {
                antiCycleActors: [...state.antiCycleActors, issuerActor],
            });

            out.push({
                $: 'path',
                via: 'user',
                has_terminal: readingHasTerminal(issuerReading),
                permission: row.permission,
                data: row.extra,
                holder_username: actor.user.username,
                issuer_username: issuerUser.username,
                issuer_user_id: issuerUser.uuid,
                reading: issuerReading,
            });
        }
        return out;
    }

    // ── Grant / revoke orchestration ─────────────────────────────────

    async grantUserUserPermission (actor: Actor, username: string, permission: string, extra: Record<string, unknown> = {}, meta: GrantMeta = {}): Promise<void> {
        permission = await this.rewritePermission(permission);
        const user = await this.stores.user.getByUsername(username);
        if ( ! user ) throw new Error(`user_does_not_exist: ${username}`);
        if ( user.id === actor.user?.id ) throw new Error('cannot grant permissions to yourself');

        if ( ! (await this.canManagePermission(actor, permission)) ) {
            throw new Error(`permission_denied: ${permission}`);
        }
        if ( ! actor.user?.id ) throw new Error('grantUserUserPermission: actor lacks user.id');
        const issuerId = actor.user.id;

        // Flat upsert (awaited so callers see immediate effect)
        await this.stores.permission.setFlatUserPerm(user.id, permission, {
            ...extra,
            issuer_user_id: issuerId,
            permission,
            deleted: false,
        });

        // Linked upsert + audit fire-and-forget (mirrors v1 behavior)
        this.stores.permission.upsertUserUserPerm(user.id, issuerId, permission, extra).catch(() => {
        });
        this.stores.permission.auditUserUserPerm({
            holder_user_id: user.id,
            issuer_user_id: issuerId,
            permission,
            action: 'grant',
            reason: meta.reason ?? 'granted via PermissionService',
        }).catch(() => {
        });
    }

    async revokeUserUserPermission (actor: Actor, username: string, permission: string, meta: GrantMeta = {}): Promise<void> {
        permission = await this.rewritePermission(permission);
        const user = await this.stores.user.getByUsername(username);
        if ( ! user ) throw new Error(`user_does_not_exist: ${username}`);

        if ( ! (await this.canManagePermission(actor, permission)) ) {
            throw new Error(`permission_denied: ${permission}`);
        }
        if ( ! actor.user?.id ) throw new Error('revokeUserUserPermission: actor lacks user.id');
        const issuerId = actor.user.id;

        await this.stores.permission.delFlatUserPerm(user.id, permission);
        this.stores.permission.deleteUserUserPermByHolder(user.id, permission).catch(() => {
        });
        this.stores.permission.auditUserUserPerm({
            holder_user_id: user.id,
            issuer_user_id: issuerId,
            permission,
            action: 'revoke',
            reason: meta.reason ?? 'revoked via PermissionService',
        }).catch(() => {
        });
    }

    async grantUserAppPermission (actor: Actor, appIdentifier: string, permission: string, extra: Record<string, unknown> = {}, meta: GrantMeta = {}): Promise<void> {
        permission = await this.rewritePermission(permission);
        const app = await this.stores.app.resolveApp(appIdentifier);
        if ( ! app ) throw new Error(`entity_not_found: app:${appIdentifier}`);
        if ( ! actor.user?.id ) throw new Error('grantUserAppPermission: actor lacks user.id');

        // Skip redundant upserts (saves db roundtrip + cache invalidation)
        if ( await this.stores.permission.hasUserAppPerm(actor.user.id, app.id, permission) ) return;

        await this.stores.permission.upsertUserAppPerm(actor.user.id, app.id, permission, extra);
        this.stores.permission.auditUserAppPerm({
            user_id: actor.user.id,
            app_id: app.id,
            permission,
            action: 'grant',
            reason: meta.reason ?? 'granted via PermissionService',
        }).catch(() => {
        });

        // Invalidate app-under-user scan cache so the grant takes effect immediately
        await this.invalidatePermissionScanCacheForAppUnderUser(actor.user.uuid, app.uid, permission);
    }

    async revokeUserAppPermission (actor: Actor, appIdentifier: string, permission: string, meta: GrantMeta = {}): Promise<void> {
        permission = await this.rewritePermission(permission);
        if ( actor.app ) throw new Error('actor must be a user');
        const app = await this.stores.app.resolveApp(appIdentifier);
        if ( ! app ) throw new Error(`entity_not_found: app${appIdentifier}`);
        if ( ! actor.user?.id ) throw new Error('revokeUserAppPermission: actor lacks user.id');

        await this.stores.permission.deleteUserAppPerm(actor.user.id, app.id, permission);
        this.stores.permission.auditUserAppPerm({
            user_id: actor.user.id,
            app_id: app.id,
            permission,
            action: 'revoke',
            reason: meta.reason ?? 'revoked via PermissionService',
        }).catch(() => {
        });
    }

    async revokeUserAppAll (actor: Actor, appIdentifier: string, meta: GrantMeta = {}): Promise<void> {
        if ( actor.app ) throw new Error('actor must be a user');
        const app = await this.stores.app.resolveApp(appIdentifier);
        if ( ! app ) throw new Error(`entity_not_found: app${appIdentifier}`);
        if ( ! actor.user?.id ) throw new Error('revokeUserAppAll: actor lacks user.id');

        await this.stores.permission.deleteUserAppAll(actor.user.id, app.id);
        this.stores.permission.auditUserAppPerm({
            user_id: actor.user.id,
            app_id: app.id,
            permission: '*',
            action: 'revoke',
            reason: meta.reason ?? 'revoked all via PermissionService',
        }).catch(() => {
        });
    }

    async grantDevAppPermission (actor: Actor, appIdentifier: string, permission: string, extra: Record<string, unknown> = {}, meta: GrantMeta = {}): Promise<void> {
        permission = await this.rewritePermission(permission);
        const app = await this.stores.app.resolveApp(appIdentifier);
        if ( ! app ) throw new Error(`entity_not_found: app:${appIdentifier}`);
        if ( ! (await this.canManagePermission(actor, permission)) ) throw new Error(`permission_denied: ${permission}`);
        if ( ! actor.user?.id ) throw new Error('grantDevAppPermission: actor lacks user.id');

        await this.stores.permission.upsertDevAppPerm(actor.user.id, app.id, permission, extra);
        this.stores.permission.auditDevAppPerm({
            user_id: actor.user.id,
            app_id: app.id,
            permission,
            action: 'grant',
            reason: meta.reason ?? 'granted via PermissionService',
        }).catch(() => {
        });
    }

    async revokeDevAppPermission (actor: Actor, appIdentifier: string, permission: string, meta: GrantMeta = {}): Promise<void> {
        permission = await this.rewritePermission(permission);
        if ( actor.app ) throw new Error('actor must be a user');
        const app = await this.stores.app.resolveApp(appIdentifier);
        if ( ! app ) throw new Error(`entity_not_found: app${appIdentifier}`);
        if ( ! actor.user?.id ) throw new Error('revokeDevAppPermission: actor lacks user.id');

        await this.stores.permission.deleteDevAppPerm(actor.user.id, app.id, permission);
        this.stores.permission.auditDevAppPerm({
            user_id: actor.user.id,
            app_id: app.id,
            permission,
            action: 'revoke',
            reason: meta.reason ?? 'revoked via PermissionService',
        }).catch(() => {
        });
    }

    async revokeDevAppAll (actor: Actor, appIdentifier: string, meta: GrantMeta = {}): Promise<void> {
        if ( actor.app ) throw new Error('actor must be a user');
        const app = await this.stores.app.resolveApp(appIdentifier);
        if ( ! app ) throw new Error(`entity_not_found: app${appIdentifier}`);
        if ( ! actor.user?.id ) throw new Error('revokeDevAppAll: actor lacks user.id');

        await this.stores.permission.deleteDevAppAll(actor.user.id, app.id);
        this.stores.permission.auditDevAppPerm({
            user_id: actor.user.id,
            app_id: app.id,
            permission: '*',
            action: 'revoke',
            reason: meta.reason ?? 'revoked all via PermissionService',
        }).catch(() => {
        });
    }

    async grantUserGroupPermission (actor: Actor, group: { id: number; uid: string }, permission: string, extra: Record<string, unknown> = {}, meta: GrantMeta = {}): Promise<void> {
        permission = await this.rewritePermission(permission);
        if ( ! (await this.canManagePermission(actor, permission)) ) throw new Error(`permission_denied: ${permission}`);
        if ( ! actor.user?.id ) throw new Error('grantUserGroupPermission: actor lacks user.id');

        await this.stores.permission.upsertUserGroupPerm(actor.user.id, group.id, permission, extra);
        this.stores.permission.auditUserGroupPerm({
            user_id: actor.user.id,
            group_id: group.id,
            permission,
            action: 'grant',
            reason: meta.reason ?? 'granted via PermissionService',
        }).catch(() => {
        });
    }

    async revokeUserGroupPermission (actor: Actor, group: { id: number; uid: string }, permission: string, meta: GrantMeta = {}): Promise<void> {
        permission = await this.rewritePermission(permission);
        if ( ! actor.user?.id ) throw new Error('revokeUserGroupPermission: actor lacks user.id');

        await this.stores.permission.deleteUserGroupPerm(actor.user.id, group.id, permission);
        this.stores.permission.auditUserGroupPerm({
            user_id: actor.user.id,
            group_id: group.id,
            permission,
            action: 'revoke',
            reason: meta.reason ?? 'revoked via PermissionService',
        }).catch(() => {
        });
    }

    // ── Issuer queries (share discovery et al) ───────────────────────

    async listUserPermissionIssuers (user: { id: number }): Promise<Array<UserRowSummary | null>> {
        const ids = await this.stores.permission.listUserPermissionIssuerIds(user.id);
        const users: Array<UserRowSummary | null> = [];
        for ( const id of ids ) {
            const u = await this.stores.user.getById(id);
            users.push(u ? { id: u.id, uuid: u.uuid, username: u.username, email: u.email } : null);
        }
        return users;
    }

    async queryIssuerPermissionsByPrefix (issuer: { id: number }, prefix: string): Promise<{
        users: Array<{ user: UserRowSummary | null; permission: string }>;
        apps: Array<{ app: { id: number; uid: string; name?: string } | null; permission: string }>;
    }> {
        const [userRows, appRows] = await Promise.all([
            this.stores.permission.queryIssuerUserPermsByPrefix(issuer.id, prefix),
            this.stores.permission.queryIssuerAppPermsByPrefix(issuer.id, prefix),
        ]);
        const users = await Promise.all(userRows.map(async r => {
            const u = await this.stores.user.getById(r.holder_user_id);
            return { user: u ? { id: u.id, uuid: u.uuid, username: u.username, email: u.email } : null, permission: r.permission };
        }));
        const apps = await Promise.all(appRows.map(async r => {
            const a = await this.stores.app.getById(r.app_id);
            return { app: a ? { id: a.id, uid: a.uid, name: a.name } : null, permission: r.permission };
        })) as Array<{ app: { id: number; uid: string; name?: string } | null; permission: string }>;;
        return { users, apps };
    }

    async queryIssuerHolderPermissionsByPrefix (issuer: Actor, holder: Actor, prefix: string): Promise<string[]> {
        if ( !issuer.user?.id || !holder.user?.id ) return [];
        return this.stores.permission.queryIssuerHolderPermsByPrefix(issuer.user.id, holder.user.id, prefix);
    }

    // ── Cache invalidation ───────────────────────────────────────────

    async invalidatePermissionScanCacheForAppUnderUser (userUuid: string, appUid: string, permission: string): Promise<void> {
        const actorUid = `app-under-user:${userUuid}:${appUid}`;
        const cacheKey = this.stores.permission.buildScanCacheKey(actorUid, [permission]);
        await this.stores.permission.invalidateScanCache(cacheKey);
    }

    // ── Internals ────────────────────────────────────────────────────

    #userToActor (user: { id: number; uuid: string; username: string; email?: string | null }): Actor {
        const actorUser: ActorUser = {
            uuid: user.uuid,
            id: user.id,
            username: user.username,
            email: user.email ?? null,
        };
        return { user: actorUser };
    }
}

// Minimal structural summary of a user row used in public return types.
interface UserRowSummary {
    id: number;
    uuid: string;
    username: string;
    email?: string | null;
}
