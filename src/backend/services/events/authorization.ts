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

import { actorUid, makeActor, type Actor } from '../../core/actor.js';
import { HttpError } from '../../core/http/HttpError.js';
import type { UserRow } from '../../stores/user/UserStore.js';
import type {
    SubscriptionPermission,
    SubscriptionTarget,
} from '../../stores/events/types.js';
import type {
    AclError,
    AclMode,
    ResourceDescriptor,
} from '../acl/ACLService.js';
import {
    appDataPermission,
    appDataSharingAllowed,
} from '../permission/appDataScopes.js';

/**
 * Who may subscribe to an anchor, who may still be delivered from it, and which
 * of their rows an actor is allowed to see.
 *
 * Subscribing is the same check as reading the resource, at mode `list` — `see`
 * is not enough, because a subscription reports the names of things appearing
 * under the anchor. The mode the check passed under is stored on the row and
 * re-run per event, against the node the event is about rather than the anchor:
 * that is what keeps a match filter from reaching anything the holder could not
 * have subscribed to directly, and what makes a revoked share stop delivering
 * without anyone having to find and delete the row. The answer is cached by the
 * permission cache's own generation (`deliveryAuthCache`), so a grant or a
 * revoke is what re-opens the question.
 *
 * The failure is a `getSafeAclError` failure, not a bare 403: a node the caller
 * cannot even `see` is answered as absent, because a distinguishable
 * "forbidden" turns subscribe into a way to ask whether a path exists.
 */

/** Minimum ACL mode a subscription needs on its anchor. */
export const SUBSCRIBE_MODE: AclMode = 'list';

/** A node an authorization decision is about. */
export interface AuthorizedNode {
    uid: string;
    path: string;
}

/** What a stored subscription carries about the grant it was made under. */
export interface SubscriptionGrant {
    holderUserId: number;
    appUid: string | null;
    permission: SubscriptionPermission;
}

export interface EventAclDeps {
    acl: {
        check: (
            actor: Actor,
            resource: ResourceDescriptor,
            mode: AclMode,
        ) => Promise<boolean>;
        getSafeAclError: (
            actor: Actor,
            resource: ResourceDescriptor,
            mode: AclMode,
        ) => Promise<AclError>;
    };
    /** Existing ancestors of a path, deepest first. */
    getAncestorChain: (
        path: string,
    ) => Promise<ReadonlyArray<{ uid: string; path: string }>>;
    getUser: (userId: number) => Promise<UserRow | null>;
    getApp: (uid: string) => Promise<{ id?: number } | null>;
    /** `PermissionStore.getCacheGeneration`, for the re-check cache's key. */
    getCacheGeneration: (actorUid: string) => Promise<number>;
}

/**
 * Descriptor for one node, walking the tree at most once however many
 * subscriptions ask about it. The chain must start with the node itself, which
 * the store no longer returns once the node is gone — a removal is exactly the
 * event whose own grant may live on the node being removed.
 */
export const nodeDescriptor = (
    node: AuthorizedNode,
    deps: Pick<EventAclDeps, 'getAncestorChain'>,
): ResourceDescriptor => {
    let ancestors: Promise<
        ReadonlyArray<{ uid: string; path: string }>
    > | null = null;
    return {
        path: node.path,
        resolveAncestors: () => {
            ancestors ??= deps
                .getAncestorChain(node.path)
                .then((chain) =>
                    chain[0]?.uid === node.uid
                        ? chain
                        : [{ uid: node.uid, path: node.path }, ...chain],
                );
            return ancestors;
        },
    };
};

/**
 * The identity a stored subscription acts as when its access is re-checked. An
 * app's row is re-checked as that app, not as the user who launched it — and
 * the app is resolved rather than taken from the row, because a grant to an app
 * is stored against its numeric id and is invisible to an actor without one.
 */
export const resolveGrantActor = async (
    grant: SubscriptionGrant,
    deps: EventAclDeps,
): Promise<Actor | null> => {
    const user = await deps.getUser(grant.holderUserId);
    if (!user) return null;
    if (!grant.appUid) return makeActor({ user, app: null });
    const app = await deps.getApp(grant.appUid);
    if (!app) return null;
    return makeActor({ user, app: { uid: grant.appUid, id: app.id } });
};

/**
 * The permission-cache counters this identity's readings hang on, read as one
 * value. An app acts through its user, so either counter moving has to change
 * the answer — the same pair the permission cache folds into its own keys.
 *
 * Joined rather than summed: two counter states must never collide on one tag.
 */
export const deliveryGenerationTag = async (
    actor: Actor,
    deps: Pick<EventAclDeps, 'getCacheGeneration'>,
): Promise<string> => {
    const keys = [actorUid(actor)];
    if (actor.app && actor.user?.uuid) keys.push(`user:${actor.user.uuid}`);
    const generations = await Promise.all(
        keys.map((key) => deps.getCacheGeneration(key)),
    );
    return generations.join('.');
};

/**
 * Authorize a subscribe. Returns the mode the check succeeded under, which the
 * row stores; throws the safe error otherwise.
 */
export const assertSubscribeAuthorized = async (
    actor: Actor,
    anchor: AuthorizedNode,
    subject: string,
    deps: EventAclDeps,
): Promise<AclMode> => {
    const resource = nodeDescriptor(anchor, deps);
    if (await deps.acl.check(actor, resource, SUBSCRIBE_MODE))
        return SUBSCRIBE_MODE;

    const safe = await deps.acl.getSafeAclError(
        actor,
        resource,
        SUBSCRIBE_MODE,
    );
    if (safe.status === 404)
        throw new HttpError(404, `No such entry: ${subject}`, {
            legacyCode: 'subject_does_not_exist',
        });
    throw new HttpError(403, safe.message, {
        legacyCode: safe.fields.code,
    });
};

/**
 * Whether a stored subscription may still be delivered an event about `node`.
 * Anything that cannot be decided is a no: a delivery is not worth failing a
 * write over, and silence is the safe direction.
 *
 * Takes the resolved identity rather than the row, because the caller has to
 * resolve it first anyway to know which generation the answer is keyed by.
 */
export const checkDeliveryAuthorized = async (
    actor: Actor,
    permission: AclMode,
    node: ResourceDescriptor,
    deps: Pick<EventAclDeps, 'acl'>,
): Promise<boolean> => {
    try {
        return await deps.acl.check(actor, node, permission);
    } catch {
        return false;
    }
};

// -- Background delivery ----------------------------------------------

/**
 * Consent to run an app's handler with nobody present.
 *
 * Delivering to a connected client is the app doing what the user opened it to
 * do; invoking its handler hours later, on their account and their bill, is a
 * different thing to agree to — so it is a per-app grant of its own, asked for
 * through the same flow as every other one and revocable in the same place.
 */
export const EVENTS_BACKGROUND_PERMISSION = 'events:background';

/** Whether a row's transports include one that runs code with nobody there. */
export const needsBackgroundConsent = (
    targets: readonly SubscriptionTarget[],
): boolean => targets.includes('worker');

export const backgroundConsentRequired = (): HttpError =>
    new HttpError(
        403,
        'Background delivery needs this app’s `events:background` permission',
        { legacyCode: 'events_background_consent_required' },
    );

// -- Cross-user KV -----------------------------------------------------

/**
 * Whether this actor may still watch a shared key-value region.
 *
 * The permission row is the source of truth and the handle is an address for
 * it: a subscription is authorized by holding the grant, never by being named
 * on the handle. That is what makes a handle passed on to a delegate work the
 * same way it does for the person it was minted for, and what makes revoking
 * the grant the one thing that stops it.
 */
export interface KvSharedRegionDeps {
    /** Whether share handles are available on this install at all. */
    enabled: boolean;
    checkPermission: (actor: Actor, permission: string) => Promise<boolean>;
}

export const kvShareHandleDisabled = (): HttpError =>
    new HttpError(403, 'kv: share handles are not available', {
        legacyCode: 'events_kv_handles_disabled',
    });

/**
 * A handle that is unknown, retired, or not the caller's to use reads the same
 * way: absent. Distinguishing them would turn subscribe into a way to ask
 * whether a handle exists and who holds it.
 */
export const unknownKvShareHandle = (handle: string): HttpError =>
    new HttpError(404, `No such handle: ${handle}`, {
        legacyCode: 'subject_does_not_exist',
    });

export const kvSharedRegionAuthorized = async (
    actor: Actor,
    permission: string,
    deps: KvSharedRegionDeps,
): Promise<boolean> => {
    if (!deps.enabled) return false;
    try {
        return await deps.checkPermission(actor, permission);
    } catch {
        return false;
    }
};

// -- Cross-app KV ------------------------------------------------------

/**
 * Watching another app's KV namespace is the cross-app KV read, and takes the
 * same three answers: the app is there, it has not opted out of sharing, and
 * the caller holds a read grant on it. Checked at subscribe and again at every
 * delivery — a standing push outlives the moment consent was given, which a
 * one-shot read does not.
 *
 * `read` rather than the op that produced the event: a subscriber is told what
 * changed, never allowed to change it.
 */
export const CROSS_APP_KV_CLASS = 'read';

export interface CrossAppKvDeps {
    /** Whether cross-app KV subjects are available on this install at all. */
    enabled: boolean;
    getApp: (uid: string) => Promise<{ metadata?: unknown } | null>;
    checkPermission: (actor: Actor, permission: string) => Promise<boolean>;
}

export type CrossAppKvDenial =
    | 'disabled'
    | 'unknown_app'
    | 'sharing_off'
    | 'not_granted';

/** Why this actor may not watch `targetAppUid`, or `null` when it may. */
export const crossAppKvDenial = async (
    actor: Actor,
    targetAppUid: string,
    deps: CrossAppKvDeps,
): Promise<CrossAppKvDenial | null> => {
    if (!deps.enabled) return 'disabled';

    const target = await deps.getApp(targetAppUid);
    if (!target) return 'unknown_app';
    if (!appDataSharingAllowed(target)) return 'sharing_off';

    const granted = await deps.checkPermission(
        actor,
        appDataPermission(targetAppUid, 'kv', CROSS_APP_KV_CLASS),
    );
    return granted ? null : 'not_granted';
};

/** The grants that, withdrawn, put a cross-app KV subscription in question. */
export const crossAppKvPermissions = (targetAppUid: string): string[] => [
    appDataPermission(targetAppUid),
    appDataPermission(targetAppUid, 'kv'),
    appDataPermission(targetAppUid, 'kv', CROSS_APP_KV_CLASS),
];

/** Subscribe-time form. Codes match the ones a cross-app KV read answers with. */
export const assertCrossAppKvAuthorized = async (
    actor: Actor,
    targetAppUid: string,
    deps: CrossAppKvDeps,
): Promise<void> => {
    const denial = await crossAppKvDenial(actor, targetAppUid, deps);
    if (denial === null) return;
    if (denial === 'disabled')
        throw new HttpError(
            403,
            'kv: subscribing to another app’s data is not available',
            { legacyCode: 'events_cross_app_disabled' },
        );
    if (denial === 'unknown_app')
        throw new HttpError(404, `entity_not_found: app:${targetAppUid}`, {
            legacyCode: 'subject_does_not_exist',
        });
    if (denial === 'sharing_off')
        throw new HttpError(
            403,
            'kv: this app does not share its data with other apps',
            { legacyCode: 'forbidden' },
        );
    throw new HttpError(403, 'Permission denied', { legacyCode: 'forbidden' });
};

/**
 * Whether a row is inside what this actor may see and remove. An app-context
 * actor — an app token, or an access token an app issued — is confined to the
 * rows its own app created; a user-context one sees everything of theirs across
 * apps, which is what makes the account the revoke surface.
 */
export const rowInActorScope = (
    actor: Actor,
    row: { appUid: string | null },
): boolean => {
    const app = actor.effectiveApp;
    // Unresolved is not "no app": reading it that way is what would hand an
    // app the account-wide view.
    if (app === undefined) return false;
    return app === null || row.appUid === app.uid;
};
