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

import {
    EVENTS_KV_HANDLE_LIMIT,
    EVENTS_KV_HANDLES_PER_APP,
    EVENTS_KV_HANDLES_PER_USER,
    KV_SHARE_NOTICE_LIMIT,
    limitFor,
    type TieredQuota,
} from '../../controllers/events/limits.js';
import {
    isAccessTokenActor,
    isAccountContext,
    makeActor,
    userRelatedActor,
    type Actor,
} from '../../core/actor.js';
import { HttpError } from '../../core/http/HttpError.js';
import { checkRateLimit } from '../../core/http/middleware/rateLimit.js';
import {
    KV_HANDLE_RETIRE_BATCH,
    type HeldKvShareHandle,
    type KvShareHandle,
    type KvShareHandleListOptions,
    type KvShareRevokedBy,
} from '../../stores/events/KvShareHandleStore.js';
import { KV_GLOBAL_APP_KEY } from '../../stores/systemKv/SystemKVStore.js';
import type { UserRow } from '../../stores/user/UserStore.js';
import { runWithConcurrencyLimit } from '../../util/concurrency.js';
import type { PageResult } from '../../util/pagination.js';
import { withRedisLock } from '../../util/redisLock.js';
import {
    kvShareHandleDisabled,
    unknownKvShareHandle,
} from '../events/authorization.js';
import { actorPlanId } from '../metering/enforcement.js';
import {
    recipientNotAcceptingShares,
    refusesSharesFrom,
} from '../share/shareBlocks.js';
import { PuterService } from '../types.js';
import {
    assertBoundedManageGrant,
    assertNewShareSegments,
    assertPrefixFitsAccess,
    assertShareableAppUid,
    assertShareablePrefix,
    invalidAppUid,
    keyPrefixSegments,
    KV_SHARE_ACCESS_LEVELS,
    kvShareAccessOf,
    kvHandlesDisabled,
    kvShareAppDelegateImplicator,
    kvShareGrantAtEveryLevel,
    kvShareGrantCovers,
    kvShareLevelsExploder,
    kvShareManageNamespaceRoots,
    kvShareManagePermission,
    kvShareOwnerImplicator,
    kvSharePrefixCaseConflict,
    parseKvShareAccess,
    parseKvShareLabel,
    type KvShareAccess,
    type KvShareRecipient,
} from './kvShares.js';

/**
 * Sharing a region of one account's key-value data with another account. The
 * actor gates live here, not at the edge, because every route that reaches a
 * handle needs the same ones.
 */

// -- Wire shapes ------------------------------------------------------

/** A share request, with the recipient already read off the route's body. */
export interface KvShareRequest {
    prefix?: unknown;
    recipient: KvShareRecipient;
    access?: unknown;
    appUid?: unknown;
    /** `undefined` keeps the stored label, `null` clears it. */
    label?: unknown;
}

/** A share as its owner is told about it right after making or changing it. */
export interface KvShareView {
    handle: string;
    prefix: string;
    access: KvShareAccess;
    appUid: string;
    holderUsername: string;
    label: string | null;
    createdAt: number;
}

/**
 * One share as its owner's listing reports it, retired ones included — they are
 * the record of what was shared and when it stopped.
 */
export interface KvShareOwnerView extends Omit<KvShareView, 'holderUsername'> {
    holderUsername: string | null;
    revokedAt: number | null;
    revokedBy: KvShareRevokedBy | null;
}

/** What revoking or unsharing reports: the handle and when it stopped. */
export interface RetiredKvShare {
    handle: string;
    revokedAt: number;
}

// -- Errors -----------------------------------------------------------

const disabled = (): HttpError =>
    new HttpError(503, 'Events are not enabled on this server', {
        legacyCode: 'events_disabled',
    });

const tooManyCalls = (): HttpError =>
    new HttpError(429, 'Too many subscription changes', {
        legacyCode: 'too_many_requests',
    });

const badRequest = (message: string, code: string): HttpError =>
    new HttpError(400, message, { legacyCode: code });

/**
 * Listing and revoking are the owner's, and an app's only where the handle is
 * the app's own: its namespace, its user, and a delegation it still holds.
 * Anything else — another app, a token an app issued, a handle outside the
 * namespace — reads as somebody else's surface.
 */
const handleOwnerOnly = (): HttpError =>
    new HttpError(
        403,
        'Only the account, or the app whose namespace this is, may manage share handles',
        { legacyCode: 'events_kv_handle_owner_only' },
    );

/**
 * An app minting is delegation, and the `manage:` grant on the region is the
 * consent for it. Without one there is nothing authorizing the app to dispose
 * of its user's data, whatever the user themselves could do here.
 */
const handleNotDelegated = (): HttpError =>
    new HttpError(
        403,
        'This app has not been given permission to share this data',
        { legacyCode: 'events_kv_handle_not_delegated' },
    );

/**
 * A delegation is the app's to hold, not to pass on: a token it minted may
 * carry the `manage:` permission and still not mint through it. The user's own
 * token is not this case — it acts for the user, who needs no delegation.
 */
const handleAccessTokenForbidden = (): HttpError =>
    new HttpError(403, 'An access token may not mint a share handle', {
        legacyCode: 'forbidden',
    });

/**
 * An app addresses exactly one key-value namespace — its own, under its user —
 * so that is the only one it can hand a region of out.
 */
const handleOutsideNamespace = (): HttpError =>
    new HttpError(403, 'An app may only share its own key-value data', {
        legacyCode: 'events_kv_handle_outside_namespace',
    });

/**
 * A temporary account holds no share handles: the grant outlives the session
 * that made it, and there is no account left behind it to take one back.
 */
const kvHandleNeedsAccount = (): HttpError =>
    new HttpError(403, 'A temporary account may not share its key-value data', {
        legacyCode: 'events_kv_handle_requires_account',
    });

/**
 * Past a handle ceiling. One code for both of them — the remedy is the same,
 * revoke something — with the message saying which one it was.
 */
const handleQuotaReached = (
    limit: number,
    scope: 'account' | 'app',
): HttpError =>
    new HttpError(
        409,
        scope === 'app'
            ? `An app may hold out ${limit} share handles for one account`
            : `An account may hold out ${limit} share handles at a time`,
        { legacyCode: 'events_kv_handle_limit_reached' },
    );

/** An app uid a user session names, for a surface with no app of its own. */
const parseAppUid = (value: unknown): string | null => {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string')
        throw badRequest('appUid must be a string', 'bad_request');
    return value;
};

/** Retire announcements settled at once; each is one holder-index read. */
const RETIRE_SETTLE_CONCURRENCY = 8;

const levelRank = (permission: string): number =>
    KV_SHARE_ACCESS_LEVELS.indexOf(kvShareAccessOf(permission) ?? 'watch');

/** Whether a mint finding this live row changes its level or label. */
const shareChanges = (
    row: KvShareHandle,
    wanted: { permission: string; label: string | null | undefined },
): boolean =>
    row.permission !== wanted.permission ||
    (wanted.label !== undefined && wanted.label !== row.label);

/** A share change's lock: its lifetime, and how long another change waits. */
const SHARE_CHANGE_LOCK_MS = 10_000;
const SHARE_CHANGE_LOCK_ATTEMPTS = 20;
const SHARE_CHANGE_LOCK_RETRY_MS = 50;

/** Passes one app deletion takes, so a huge namespace cannot pin a node. */
const APP_RETIRE_MAX_PASSES = 200;

/** Deleted apps whose handles one query looks up. */
const APP_RETIRE_UID_CHUNK = 200;

const ownerView = (
    row: KvShareHandle,
    holderUsername: string | null,
): KvShareOwnerView => ({
    handle: row.handle,
    prefix: row.keyPrefix,
    access: kvShareAccessOf(row.permission) ?? 'watch',
    appUid: row.appUid,
    holderUsername,
    label: row.label,
    createdAt: row.createdAt,
    revokedAt: row.revokedAt,
    revokedBy: row.revokedBy,
});

export class KvShareService extends PuterService {
    override onServerStart(): void {
        // A check at one level is answered by a grant at any level above it.
        this.services.permission.registerExploder(kvShareLevelsExploder());

        // Owning a key-value namespace is holding every share grant over it,
        // which is what lets its owner mint a handle on their own data.
        this.services.permission.registerImplicator(kvShareOwnerImplicator());

        // Lets an app-under-user actor exercise a share grant its user holds,
        // scoped to the app the grant's namespace names.
        this.services.permission.registerImplicator(
            kvShareAppDelegateImplicator({
                userHolds: (actor, permission) =>
                    this.services.permission.check(actor, permission),
            }),
        );

        // An origin-derived app uid comes back verbatim when the app is
        // registered again, so a handle must not outlive its app and reattach
        // to whoever controls the origin next.
        this.clients.event.on('app.changed', async (_key, data) => {
            const { app_uid: appUid, action } = (data ?? {}) as {
                app_uid?: string;
                action?: string;
            };
            if (action !== 'deleted' || !appUid) return;
            try {
                await this.retireForDeletedApps([appUid]);
            } catch (err) {
                console.warn('[kvShare] deleted-app retire failed', err);
            }
        });

        // A developer's apps go with their account, without `app.changed`.
        this.clients.event.on('user.delete', async (_key, data) => {
            if (!data?.appUids?.length) return;
            try {
                await this.retireForDeletedApps(data.appUids);
            } catch (err) {
                console.warn('[kvShare] deleted-account retire failed', err);
            }
        });
    }

    /** Whether the level a mint asks for is available on this server. */
    #assertAccessEnabled(access: KvShareAccess): void {
        if (access === 'watch') {
            if (this.config.events?.enabled !== true) throw disabled();
            if (this.config.events?.kvHandles !== true)
                throw kvShareHandleDisabled();
            return;
        }
        if (this.config.kv?.shareHandles !== true) throw kvHandlesDisabled();
    }

    /**
     * Hand another user a region of this account's key-value data, to watch,
     * read or write.
     *
     * Two writes, in this order: the grant, which is the authorization and
     * carries its own `manage:` check and its own refusal to grant to yourself,
     * and then the handle, which is only a name for it. A handle whose grant
     * never landed would be a name for nothing; a grant whose handle never
     * landed is unaddressable, since a handle is the only thing that can name
     * this family.
     *
     * An app may mint too, bounded the way sharing bounds an app handing out
     * its user's files: authority is the user's, asked of the user behind the
     * actor and never of the app, and reach is what the credential itself
     * holds. Here reach is structural — an app addresses one namespace — so it
     * is asserted rather than worked out, and the app's own consent to delegate
     * is a `manage:` grant on the region.
     */
    async mintKvHandle(
        actor: Actor,
        request: KvShareRequest,
        options: {
            defaultAccess: KvShareAccess;
            /** A request naming no level leaves an existing share's level. */
            keepLevelUnlessNamed?: boolean;
        },
    ): Promise<KvShareView> {
        const access = parseKvShareAccess(
            request.access,
            options.defaultAccess,
        );
        this.#assertAccessEnabled(access);

        const owner = actor.user;
        if (!owner?.uuid || owner.id === undefined) throw handleOwnerOnly();
        // `undefined` is an app that could not be resolved, not the absence of
        // one — reading it as an account session is what would hand an app a
        // surface bounded on the app it is acting as.
        const app = actor.effectiveApp;
        if (app === undefined) throw handleOwnerOnly();
        // An account's surface is the account's, and a token scoped to less
        // than its issuer holds is not the account. A token an app issued is
        // refused by the delegation check below, which has its own answer.
        if (app === null && !isAccountContext(actor)) throw handleOwnerOnly();

        // The budget is the user's, so an app spends its user's slots rather
        // than a machine-rate allowance of its own.
        await this.#spendHandleBudget(owner.id);

        const keyPrefix = assertShareablePrefix(request.prefix);
        const label = parseKvShareLabel(request.label);
        const appUid = await this.#mintNamespace(app, request);
        const permission = assertPrefixFitsAccess(
            owner.uuid,
            appUid,
            keyPrefix,
            access,
        );
        // Before the recipient lookup and the idempotent answer below, so an
        // app without the consent learns neither whether a username exists nor
        // a handle it may no longer hand out.
        if (app) await this.#assertKvShareDelegated(actor, permission);
        const grantee = await this.#resolveGrantee(request.recipient);

        // Resolved before the idempotent answer below, so a plan that holds
        // none is refused whatever it asks for. Kept behind the delegation
        // check above: an app with no delegation must not learn anything
        // about the account's plan.
        const quota = await this.#handleQuota(actor);

        // The same region minted again for the same grantee is the same
        // capability, not a second one — handing back what already exists is
        // what keeps two handles from ever sharing one permission row. A
        // different level or label changes it in place. The ceiling counts
        // slots, and this takes none, so it is not asked.
        const region = {
            ownerUserId: owner.id,
            granteeUserId: grantee.id,
            appUid,
            keyPrefix,
        };
        const existing = await this.stores.kvShareHandle.findLive(region);
        if (existing) {
            const keepLevel =
                options.keepLevelUnlessNamed &&
                (request.access === undefined || request.access === null);
            const changed = await this.#changeShare(actor, existing, grantee, {
                permission: keepLevel ? existing.permission : permission,
                label,
            });
            return this.#view(changed, grantee.username);
        }

        // New shares only, so ones made before these rules or before a block
        // can still be narrowed or taken back. Behind the delegation check,
        // so they are no probe for who blocked whom.
        assertNewShareSegments(keyPrefixSegments(keyPrefix));
        if (await this.stores.kvShareHandle.hasLiveCaseVariant(region))
            throw kvSharePrefixCaseConflict();
        if (await refusesSharesFrom(this.stores.userBlock, grantee, owner.id))
            throw recipientNotAcceptingShares();

        await this.#assertHandleCeiling(owner.id, appUid, quota);

        // The user behind the app, so the authority checked is theirs and the
        // issuer recorded is them. Which app acted is carried separately: it
        // belongs on the audit row, not in the grant's authority.
        const authority = userRelatedActor(actor);
        const meta = { reason: 'kv share handle', appUid: app?.uid };
        // No live handle names this region, so a grant on exactly it at
        // another level is left over from a retired one and must not answer
        // for the new share. Looked up first, since there rarely is one.
        const stale = kvShareGrantAtEveryLevel(permission).filter(
            (other) => other !== permission,
        );
        if (
            await this.services.permission.hasUserUserGrant(
                grantee.id,
                owner.id,
                stale,
            )
        )
            await this.services.permission.revokeUserUserPermissions(
                authority,
                grantee.username,
                stale,
                meta,
            );
        await this.services.permission.grantUserUserPermission(
            authority,
            grantee.username,
            permission,
            {},
            meta,
        );

        const row = await this.stores.kvShareHandle.mint({
            ownerUserId: owner.id,
            granteeUserId: grantee.id,
            appUid,
            keyPrefix,
            permission,
            label: label ?? null,
        });
        await this.#notifyReceived(row);
        return this.#view(row, grantee.username);
    }

    /**
     * Tell the holder, in the app whose data it is, that a share arrived, never
     * naming the owner. Best-effort and bounded per owner and holder: the share
     * stands either way.
     */
    async #notifyReceived(row: KvShareHandle): Promise<void> {
        if (row.appUid === KV_GLOBAL_APP_KEY) return;
        try {
            const allowed = await checkRateLimit(
                `${KV_SHARE_NOTICE_LIMIT.scope}:${row.ownerUserId}:${row.granteeUserId}`,
                KV_SHARE_NOTICE_LIMIT.limit,
                KV_SHARE_NOTICE_LIMIT.window,
            );
            if (!allowed) return;
            await this.services.notification.notify(
                [row.granteeUserId],
                {
                    handle: row.handle,
                    access: kvShareAccessOf(row.permission) ?? 'watch',
                    label: row.label,
                    createdAt: row.createdAt,
                },
                { type: 'kv.share.received', appUid: row.appUid },
            );
        } catch (err) {
            console.warn('[kvShare] share notification failed', err);
        }
    }

    /**
     * A level or label change on a live handle, keeping its id. One change per
     * handle at a time, applied to the row as it then stands, so two racing
     * changes can't leave a grant the row doesn't name.
     */
    async #changeShare(
        actor: Actor,
        existing: KvShareHandle,
        holder: UserRow & { id: number; username: string },
        wanted: { permission: string; label: string | null | undefined },
    ): Promise<KvShareHandle> {
        if (!shareChanges(existing, wanted)) return existing;
        return withRedisLock(
            this.clients.redis,
            `kvShare:change:${existing.handle}`,
            async () => {
                const current = await this.stores.kvShareHandle.getByHandle(
                    existing.handle,
                );
                if (!current || current.revokedAt !== null)
                    throw unknownKvShareHandle(existing.handle);
                return this.#applyShareChange(actor, current, holder, wanted);
            },
            {
                ttlMs: SHARE_CHANGE_LOCK_MS,
                attempts: SHARE_CHANGE_LOCK_ATTEMPTS,
                retryMs: SHARE_CHANGE_LOCK_RETRY_MS,
                onUnavailable: 'run',
                onBusy: () => {
                    throw tooManyCalls();
                },
            },
        );
    }

    /**
     * {@link #changeShare} under its lock. The new grant lands before the old
     * one goes (exactly, so narrower handles keep theirs), and every step is
     * safe to retry.
     */
    async #applyShareChange(
        actor: Actor,
        existing: KvShareHandle,
        holder: UserRow & { id: number; username: string },
        wanted: { permission: string; label: string | null | undefined },
    ): Promise<KvShareHandle> {
        const levelChanges = existing.permission !== wanted.permission;
        const labelChanges =
            wanted.label !== undefined && wanted.label !== existing.label;
        if (!levelChanges && !labelChanges) return existing;

        // An app also needs the consent the share stands on, as it would to
        // revoke it.
        if (actor.effectiveApp)
            await this.#assertKvShareDelegated(actor, existing.permission);

        // A holder who now refuses this owner's shares can still be narrowed
        // or have the label cleared, and nothing more.
        const raises =
            levelChanges &&
            levelRank(wanted.permission) > levelRank(existing.permission);
        const relabels = labelChanges && wanted.label !== null;
        if (
            (raises || relabels) &&
            (await refusesSharesFrom(
                this.stores.userBlock,
                holder,
                existing.ownerUserId,
            ))
        )
            throw recipientNotAcceptingShares();

        const authority = userRelatedActor(actor);
        const meta = {
            reason: 'kv share handle level changed',
            appUid: actor.effectiveApp?.uid,
        };
        if (levelChanges) {
            await this.services.permission.grantUserUserPermission(
                authority,
                holder.username,
                wanted.permission,
                {},
                meta,
            );
            await this.services.permission.revokeUserUserPermission(
                authority,
                holder.username,
                existing.permission,
                meta,
            );
        }
        const updated = await this.stores.kvShareHandle.update(
            existing.handle,
            existing.ownerUserId,
            {
                ...(levelChanges ? { permission: wanted.permission } : {}),
                ...(labelChanges ? { label: wanted.label } : {}),
            },
        );
        if (updated && updated.revokedAt === null) return updated;
        // Retired meanwhile: the retire withdrew the region before the grant
        // above landed, so that grant is withdrawn here.
        if (levelChanges)
            await this.services.permission.revokeUserUserPermission(
                authority,
                holder.username,
                wanted.permission,
                meta,
            );
        throw unknownKvShareHandle(existing.handle);
    }

    #view(row: KvShareHandle, holderUsername: string): KvShareView {
        return {
            handle: row.handle,
            prefix: row.keyPrefix,
            access: kvShareAccessOf(row.permission) ?? 'watch',
            appUid: row.appUid,
            holderUsername,
            label: row.label,
            createdAt: row.createdAt,
        };
    }

    /**
     * Which namespace a mint may name. An app reaches `v1:<user>:<its own app>`
     * and nothing else, so a request naming another one is refused rather than
     * quietly minted somewhere the app cannot even write. An account names an
     * app that exists, since the share notifies its holder inside that app.
     */
    async #mintNamespace(
        app: Actor['effectiveApp'],
        request: KvShareRequest,
    ): Promise<string> {
        const named = parseAppUid(request.appUid);
        if (app) {
            if (named !== null && named !== app.uid)
                throw handleOutsideNamespace();
            return app.uid;
        }
        const appUid = assertShareableAppUid(named ?? KV_GLOBAL_APP_KEY);
        if (
            appUid !== KV_GLOBAL_APP_KEY &&
            !(await this.stores.app.getByUid(appUid))
        )
            throw invalidAppUid('`appUid` does not name a namespace');
        return appUid;
    }

    /**
     * Whether this app was given the region to hand out. The `manage:` grant is
     * the user's consent, and prefix implication makes one taken on a region
     * cover the keys beneath it — so a handle deeper than the consent is still
     * inside it, and one above it is not.
     */
    async #assertKvShareDelegated(
        actor: Actor,
        permission: string,
    ): Promise<void> {
        // Consequential enough to require the app's own session, whatever a
        // token it minted happens to carry.
        if (isAccessTokenActor(actor)) throw handleAccessTokenForbidden();
        // The consent surface refuses a namespace-root delegation because no
        // prompt can describe it; refused here too, so a row written any other
        // way cannot authorize a mint.
        assertBoundedManageGrant(kvShareManagePermission(permission));
        const delegated = await this.services.permission.canManagePermission(
            actor,
            permission,
        );
        if (!delegated) throw handleNotDelegated();
        // `canManagePermission` walks ancestors, so a namespace-root grant
        // written by any path other than the consent surface would otherwise
        // authorize a mint anywhere in the namespace, bounded region or not.
        // Asked at every level, whatever level this mint is at.
        const unbounded = await this.services.permission.check(
            actor,
            kvShareManageNamespaceRoots(permission),
        );
        if (unbounded) throw handleNotDelegated();
    }

    /**
     * Take a shared region back, as its owner. The alias route's revoke: a
     * handle this account did not mint reads as absent, whoever holds it.
     *
     * Not gated on any feature flag. Withdrawing access only ever narrows, and
     * an install that turned sharing off must still be able to retire what it
     * has.
     */
    async revokeKvHandle(
        actor: Actor,
        handle: unknown,
    ): Promise<RetiredKvShare> {
        const owner = actor.user;
        if (owner?.id === undefined) throw handleOwnerOnly();
        this.#assertOwnerSurface(actor);

        await this.#spendHandleBudget(owner.id);

        const named = typeof handle === 'string' ? handle : '';
        const share = await this.stores.kvShareHandle.getByHandle(named);
        // Unknown and somebody else's read the same way, so revoking cannot be
        // used to find out that a handle exists.
        if (!share || share.ownerUserId !== owner.id)
            throw unknownKvShareHandle(named);
        return this.#revokeAsOwner(actor, share);
    }

    /**
     * Stop a share from either side, the role read off the row: its owner
     * revokes it, its holder gives it up, and anyone else is told it is not
     * there.
     */
    async removeKvShare(
        actor: Actor,
        handle: unknown,
    ): Promise<RetiredKvShare> {
        const named = typeof handle === 'string' ? handle : '';
        const userId = actor.user?.id;
        if (userId === undefined) throw unknownKvShareHandle(named);

        await this.#spendHandleBudget(userId);

        const share = await this.stores.kvShareHandle.getByHandle(named);
        if (share?.ownerUserId === userId) {
            this.#assertOwnerSurface(actor);
            return this.#revokeAsOwner(actor, share);
        }
        if (
            share?.granteeUserId === userId &&
            this.#holderSurface(actor, share)
        )
            return this.#unshareAsHolder(actor, share);
        throw unknownKvShareHandle(named);
    }

    /**
     * The account, or an app acting for it. An unresolved app (`undefined`) and
     * a token an app issued are neither.
     */
    #assertOwnerSurface(actor: Actor): void {
        if (actor.effectiveApp === undefined) throw handleOwnerOnly();
        if (isAccessTokenActor(actor) && !isAccountContext(actor))
            throw handleOwnerOnly();
    }

    /**
     * Whether this actor may give up a share its user holds: the account, or
     * the app whose namespace the share is in. Any other app of the same user
     * gets the answer a stranger gets.
     */
    #holderSurface(actor: Actor, share: KvShareHandle): boolean {
        const app = actor.effectiveApp;
        if (app === undefined) return false;
        if (isAccessTokenActor(actor) && !isAccountContext(actor)) return false;
        return app === null || share.appUid === app.uid;
    }

    /**
     * The grant goes first, at every level with its subtree, then the handle is
     * retired, so a failure anywhere is a retry. Then the grant goes again: a
     * level change that landed between the two still saw a live row.
     */
    async #revokeAsOwner(
        actor: Actor,
        share: KvShareHandle,
    ): Promise<RetiredKvShare> {
        const app = actor.effectiveApp;
        // An app reaches one namespace, so a handle outside it is not its to
        // take back — checked after the owner test, which must answer first.
        if (app && share.appUid !== app.uid) throw handleOwnerOnly();
        // The same consent the mint took: a withdrawn delegation withdraws the
        // app's surface on the region with it.
        if (app) await this.#assertKvShareDelegated(actor, share.permission);
        // Revoking again would withdraw the region from a newer share of it.
        if (share.revokedAt !== null)
            return { handle: share.handle, revokedAt: share.revokedAt };

        const granteeName = (
            await this.stores.user.getById(share.granteeUserId)
        )?.username;
        if (!granteeName)
            throw new HttpError(500, 'The grantee of this handle is gone', {
                legacyCode: 'internal_error',
            });
        const withdraw = () =>
            this.services.permission.revokeUserUserPermissionSubtree(
                userRelatedActor(actor),
                granteeName,
                kvShareGrantAtEveryLevel(share.permission),
                { reason: 'kv share handle revoked', appUid: app?.uid },
            );
        await withdraw();

        const revoked = await this.stores.kvShareHandle.retire(
            share.handle,
            share.ownerUserId,
        );
        if (!revoked?.revokedAt) throw unknownKvShareHandle(share.handle);

        // A narrower handle to the same grantee sits inside this one's
        // subtree, which the revoke above just withdrew at every level — so
        // its grant is already gone even though its own row still reads live.
        const covered = await this.#retireCoveredHandles(revoked);
        await withdraw();
        await this.#announceRetired([revoked, ...covered]);

        return { handle: revoked.handle, revokedAt: revoked.revokedAt };
    }

    /**
     * Every other live handle to this grantee that the just-withdrawn grant
     * covered, at any level, retired in one statement. Coverage runs on the
     * permission string, whose namespace app uid sits below the root, so a
     * covered handle is always inside the same namespace.
     */
    async #retireCoveredHandles(
        revoked: KvShareHandle,
    ): Promise<KvShareHandle[]> {
        const covered = (
            await this.stores.kvShareHandle.listLiveForOwnerAndGrantee(
                revoked.ownerUserId,
                revoked.granteeUserId,
            )
        ).filter(
            (row) =>
                row.handle !== revoked.handle &&
                kvShareGrantCovers(revoked.permission, row.permission),
        );
        await this.stores.kvShareHandle.retireMany(
            covered.map((row) => row.handle),
            'owner',
            { ownerUserId: revoked.ownerUserId },
        );
        return covered;
    }

    /**
     * A holder giving up a share and every narrower one of theirs from the same
     * owner inside it, since they can't see prefixes. Exact revokes at every
     * level, so their other handles keep working; revoked again after the
     * retire for a level change that landed in between.
     */
    async #unshareAsHolder(
        actor: Actor,
        share: KvShareHandle,
    ): Promise<RetiredKvShare> {
        if (share.revokedAt !== null)
            return { handle: share.handle, revokedAt: share.revokedAt };

        const holderName = (await this.stores.user.getById(share.granteeUserId))
            ?.username;
        if (!holderName) throw unknownKvShareHandle(share.handle);

        const siblings =
            await this.stores.kvShareHandle.listLiveForOwnerAndGrantee(
                share.ownerUserId,
                share.granteeUserId,
            );
        const nested = siblings.filter(
            (row) =>
                row.handle !== share.handle &&
                kvShareGrantCovers(share.permission, row.permission),
        );
        const withdraw = () =>
            this.services.permission.revokeUserUserPermissions(
                userRelatedActor(actor),
                holderName,
                [share, ...nested].flatMap((row) =>
                    kvShareGrantAtEveryLevel(row.permission),
                ),
                {
                    reason: 'kv share handle unshared',
                    appUid: actor.effectiveApp?.uid,
                },
                { issuerUserId: share.ownerUserId },
            );
        await withdraw();

        // The nested ones first: a handle that reads as retired is how a
        // retry knows the whole unshare finished.
        await this.stores.kvShareHandle.retireMany(
            nested.map((row) => row.handle),
            'holder',
            { granteeUserId: share.granteeUserId },
        );
        const retired = await this.stores.kvShareHandle.retireAsHolder(
            share.handle,
            share.granteeUserId,
        );
        if (!retired?.revokedAt) throw unknownKvShareHandle(share.handle);
        await withdraw();
        await this.#announceRetired([retired, ...nested]);
        return { handle: retired.handle, revokedAt: retired.revokedAt };
    }

    /**
     * Retire every live handle in deleted apps' namespaces as the platform's,
     * in bounded passes. Grants go before handles, so a retry after a failure
     * still finds them, and a later share of the same region can't inherit
     * them.
     */
    async retireForDeletedApps(appUids: readonly string[]): Promise<number> {
        const uids = [...new Set(appUids)].filter(
            (uid) => uid !== KV_GLOBAL_APP_KEY,
        );
        let retired = 0;
        for (let at = 0; at < uids.length; at += APP_RETIRE_UID_CHUNK) {
            const chunk = uids.slice(at, at + APP_RETIRE_UID_CHUNK);
            for (let pass = 0; pass < APP_RETIRE_MAX_PASSES; pass++) {
                const batch =
                    await this.stores.kvShareHandle.listLiveForApps(chunk);
                await this.#withdrawRetiredGrants(batch);
                await this.stores.kvShareHandle.retireMany(
                    batch.map((row) => row.handle),
                    'system',
                );
                await this.#announceRetired(batch);
                retired += batch.length;
                if (batch.length < KV_HANDLE_RETIRE_BATCH) break;
            }
        }
        return retired;
    }

    /**
     * Each handle's region, at every level and beneath, withdrawn in one revoke
     * per owner, holder and app.
     */
    async #withdrawRetiredGrants(
        rows: readonly KvShareHandle[],
    ): Promise<void> {
        const groups = new Map<string, KvShareHandle[]>();
        for (const row of rows) {
            const key = `${row.ownerUserId}:${row.granteeUserId}:${row.appUid}`;
            groups.set(key, [...(groups.get(key) ?? []), row]);
        }
        if (groups.size === 0) return;
        const users = await this.stores.user.getByIds([
            ...new Set(
                rows.flatMap((row) => [row.ownerUserId, row.granteeUserId]),
            ),
        ]);
        await runWithConcurrencyLimit(
            [...groups.values()],
            RETIRE_SETTLE_CONCURRENCY,
            async (group) => {
                const owner = users.get(group[0].ownerUserId);
                const holder = users.get(group[0].granteeUserId);
                // A deleted account's grants went with it.
                if (!owner?.uuid || !holder?.username) return;
                await this.services.permission.revokeUserUserPermissionSubtree(
                    makeActor({ user: owner }),
                    holder.username,
                    group.flatMap((row) =>
                        kvShareGrantAtEveryLevel(row.permission),
                    ),
                    { reason: 'kv share app deleted', appUid: group[0].appUid },
                );
            },
        );
    }

    /**
     * Tell listeners which handles stopped being addresses, one event per user
     * who could have subscribed through them (owner and holder alike), and wait
     * for them: what was made through a handle ends with it.
     */
    async #announceRetired(rows: readonly KvShareHandle[]): Promise<void> {
        const byUser = new Map<number, Set<string>>();
        for (const row of rows)
            for (const userId of [row.granteeUserId, row.ownerUserId])
                byUser.set(
                    userId,
                    (byUser.get(userId) ?? new Set()).add(row.handle),
                );
        await runWithConcurrencyLimit(
            [...byUser],
            RETIRE_SETTLE_CONCURRENCY,
            ([userId, handles]) =>
                this.clients.event.emitAndWait(
                    'kv.share.retired',
                    { handles: [...handles], userId },
                    {},
                ),
        );
    }

    /**
     * What this account has shared out of its key-value data, retired handles
     * included: they are the only record of what was shared and when it
     * stopped.
     */
    async listKvHandles(
        actor: Actor,
        options: KvShareHandleListOptions = {},
    ): Promise<PageResult<KvShareOwnerView>> {
        const owner = actor.user;
        if (owner?.id === undefined) throw handleOwnerOnly();
        this.#assertOwnerSurface(actor);
        const app = actor.effectiveApp;

        // An app sees its own namespace and nothing else; an account session
        // sees across apps, which is what makes the account the surface for a
        // row whose app is long gone. Listing disposes of nothing, so the gate
        // is app-ness and the namespace rather than the region's delegation.
        const page = await this.stores.kvShareHandle.listForOwner(owner.id, {
            limit: options.limit,
            cursor: options.cursor,
            includeTotal: options.includeTotal,
            appUid: app?.uid ?? null,
        });
        const holders = await this.stores.user.getByIds([
            ...new Set(page.items.map((row) => row.granteeUserId)),
        ]);

        return {
            ...page,
            items: page.items.map((row) =>
                ownerView(
                    row,
                    holders.get(row.granteeUserId)?.username ?? null,
                ),
            ),
        };
    }

    /**
     * Live shares held by this account, by handle, level, app and label only.
     * An app sees its own namespace; an unresolved app or a scoped token sees
     * nothing.
     */
    async listKvSharesWithMe(
        actor: Actor,
        options: KvShareHandleListOptions = {},
    ): Promise<PageResult<HeldKvShareHandle>> {
        const holderId = actor.user?.id;
        const app = actor.effectiveApp;
        if (holderId === undefined || app === undefined) return { items: [] };
        if (isAccessTokenActor(actor) && !isAccountContext(actor))
            return { items: [] };

        return this.stores.kvShareHandle.listLiveForGrantee(holderId, {
            limit: options.limit,
            cursor: options.cursor,
            includeTotal: options.includeTotal,
            appUid: app?.uid ?? null,
        });
    }

    /** Who a mint is for. Named by username or uuid; unknown reads as absent. */
    async #resolveGrantee(
        recipient: KvShareRecipient,
    ): Promise<UserRow & { id: number; username: string }> {
        const username =
            typeof recipient?.username === 'string'
                ? recipient.username.trim()
                : '';
        const uid =
            typeof recipient?.uid === 'string' ? recipient.uid.trim() : '';
        if (!username && !uid)
            throw badRequest(
                'Name the recipient by username or user uid',
                'bad_request',
            );

        const user = username
            ? await this.stores.user.getByUsername(username)
            : await this.stores.user.getByUuid(uid);
        if (!user?.username || user.id === undefined)
            throw new HttpError(404, 'user_does_not_exist', {
                legacyCode: 'subject_does_not_exist',
            });
        return { ...user, id: user.id, username: user.username };
    }

    /**
     * How many handles this caller's plan lets the account hold out, in total
     * and in one namespace. Resolved before the idempotent answer on the mint
     * path, so a plan that may hold none is refused whatever it asks for.
     *
     * A deployment with no metering has no plans to read, and is held to the
     * paid caps.
     */
    async #handleQuota(actor: Actor): Promise<TieredQuota> {
        const plan = await actorPlanId(this.services.metering, actor);
        if (plan !== null && limitFor(EVENTS_KV_HANDLES_PER_USER, plan) === 0)
            throw kvHandleNeedsAccount();
        return {
            perUser: limitFor(EVENTS_KV_HANDLES_PER_USER, plan),
            perApp: limitFor(EVENTS_KV_HANDLES_PER_APP, plan),
        };
    }

    /**
     * Whether this account may hold out another share handle, in total and in
     * the namespace this mint names. Retired ones do not count: the row stays
     * as the record of what was shared, not as a slot. Check-then-act: two
     * mints racing past it can both proceed, which the mint budget bounds well
     * enough for an abuse backstop.
     */
    async #assertHandleCeiling(
        userId: number,
        appUid: string,
        quota: TieredQuota,
    ): Promise<void> {
        const live = await this.stores.kvShareHandle.countLiveForOwner(
            userId,
            appUid,
        );
        if (live.total >= quota.perUser)
            throw handleQuotaReached(quota.perUser, 'account');
        // The global namespace is the account's own shelf rather than an
        // app's, so the account cap is its only bound — which is also what
        // keeps that cap reachable without naming a namespace.
        if (appUid !== KV_GLOBAL_APP_KEY && live.forApp >= quota.perApp)
            throw handleQuotaReached(quota.perApp, 'app');
    }

    async #spendHandleBudget(userId: number): Promise<void> {
        const ok = await checkRateLimit(
            `${EVENTS_KV_HANDLE_LIMIT.scope}:${userId}`,
            EVENTS_KV_HANDLE_LIMIT.limit,
            EVENTS_KV_HANDLE_LIMIT.window,
        );
        if (!ok) throw tooManyCalls();
    }
}
