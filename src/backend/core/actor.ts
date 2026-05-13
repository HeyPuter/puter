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

import { UserRow } from '../stores/user/UserStore';

export interface ActorApp {
    uid: string;
    id?: number;
}

/**
 * Access-token wrapper. When set, this actor is acting *through* an access
 * token issued by `issuer`. The token's row in `access_token_permissions`
 * gates which permissions of the issuer it can exercise.
 */
export interface ActorAccessToken {
    uid: string;
    issuer: Actor;
    authorized?: Actor | null;
}

export interface Actor {
    user: Partial<UserRow>;
    app?: ActorApp | null;
    /** True for the system actor; skips metering / quota tracking. */
    system?: boolean;
    accessToken?: ActorAccessToken | null;
    /**
     * Session reference when authenticated via a session token (user actors)
     * or an app-under-user token that carries a session. Absent for system,
     * raw-app, and pure access-token actors. Used for session introspection
     * and targeted logout.
     */
    session?: { uid: string } | null;
}

/** UUID of the baked-in system user (see 0025 seed migration). */
export const SYSTEM_ACTOR_UUID = '5d4adce0-a381-4982-9c02-6e2540026238';

/** The default system actor used when no actor is supplied. */
export const SYSTEM_ACTOR: Actor = {
    user: { uuid: SYSTEM_ACTOR_UUID, username: 'system' },
    system: true,
};

export const isSystemActor = (actor: Actor | undefined | null): boolean => {
    return !!actor?.system || actor?.user?.uuid === SYSTEM_ACTOR_UUID;
};

export const isAppActor = (actor: Actor | undefined | null): boolean => {
    return !!actor?.app && !isAccessTokenActor(actor);
};

export const isAccessTokenActor = (
    actor: Actor | undefined | null,
): boolean => {
    return !!actor?.accessToken;
};

/**
 * Stable identifier for an actor.
 * Used as a cache key (e.g., permission scan cache) and for cycle detection.
 */
export const actorUid = (actor: Actor): string => {
    if (actor.accessToken) {
        const authorizedUid = actor.accessToken.authorized
            ? actorUid(actor.accessToken.authorized)
            : '<none>';
        return `access-token:${actorUid(actor.accessToken.issuer)}:${authorizedUid}:${actor.accessToken.uid}`;
    }
    if (isSystemActor(actor)) return 'system';
    if (actor.app) return `app-under-user:${actor.user.uuid}:${actor.app.uid}`;
    return `user:${actor.user.uuid}`;
};

/**
 * Return a user-only actor for any app-under-user actor. For non-app actors,
 * returns the actor unchanged.
 */
export const userRelatedActor = (actor: Actor): Actor => {
    if (!actor.app && !actor.accessToken) return actor;
    return { user: actor.user };
};
