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

import { makeActor, type Actor } from '../../core/actor.js';
import { HttpError } from '../../core/http/HttpError.js';
import type { UserRow } from '../../stores/user/UserStore.js';
import type {
    AclError,
    AclMode,
    ResourceDescriptor,
} from '../acl/ACLService.js';

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
 * without anyone having to find and delete the row.
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
    permission: AclMode;
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
const grantActor = async (
    grant: SubscriptionGrant,
    user: UserRow,
    deps: EventAclDeps,
): Promise<Actor | null> => {
    if (!grant.appUid) return makeActor({ user, app: null });
    const app = await deps.getApp(grant.appUid);
    if (!app) return null;
    return makeActor({ user, app: { uid: grant.appUid, id: app.id } });
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
 */
export const checkDeliveryAuthorized = async (
    grant: SubscriptionGrant,
    node: ResourceDescriptor,
    deps: EventAclDeps,
): Promise<boolean> => {
    try {
        const user = await deps.getUser(grant.holderUserId);
        if (!user) return false;
        const actor = await grantActor(grant, user, deps);
        if (!actor) return false;
        return await deps.acl.check(actor, node, grant.permission);
    } catch {
        return false;
    }
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
