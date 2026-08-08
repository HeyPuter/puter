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

import { UserRow } from '../stores/user/UserStore';

export interface ActorApp {
    uid: string;
    id?: number;
}

/**
 * Access-token wrapper. When set, this actor is acting _through_ an access
 * token issued by `issuer`. The token's row in `access_token_permissions` gates
 * which permissions of the issuer it can exercise.
 */
export interface ActorAccessToken {
    uid: string;
    issuer: Actor;
    authorized?: Actor | null;
    /**
     * Full-API-access ("personal access token") flag, set from the signed
     * `full_access` JWT claim. Such a token may exercise everything its issuing
     * user can do via the API and is admitted past `requireNonAccessTokenGate`
     * — but is still rejected by `requireUserActor` / web-session gates, so it
     * can never manage the account. Normal (scoped) access tokens leave this
     * false and remain blocked from non-`allowAccessToken` routes.
     */
    fullAccess?: boolean;
}

export interface Actor {
    user: Partial<UserRow>;
    app?: ActorApp | null;
    /**
     * The app this actor ultimately acts as: its own `app`, or failing that the
     * app of whoever issued its access token.
     *
     * Read this — not `app` — in any gate asking "which app is doing this?". An
     * access-token actor carries no `app` of its own, so `app` alone reads as
     * "no app" even for a token an app minted, and a gate keyed off it fails
     * open exactly where it must not.
     *
     * `null` and `undefined` are not the same thing here:
     *
     * - `null` — resolved, and this actor is not acting as any app.
     * - Absent — never resolved, because the actor skipped `makeActor`.
     *
     * A gate must not read the second as the first: that is the fail-open this
     * field exists to prevent. Optional only so an actor literal that predates
     * the field still compiles; `assertResolvedActor` is what keeps the request
     * path honest, and `makeActor` is the one place the derivation lives.
     */
    effectiveApp?: ActorApp | null;
    /** True for the system actor; skips metering / quota tracking. */
    system?: boolean;
    accessToken?: ActorAccessToken | null;
    /**
     * Session reference when authenticated via a session token (user actors) or
     * an app-under-user token that carries a session. Absent for system,
     * raw-app, and pure access-token actors. Used for session introspection and
     * targeted logout. `kind` mirrors the session row's kind (e.g. 'web',
     * 'app', 'worker') so callers can gate on how the credential was minted
     * without an extra session lookup.
     */
    session?: { uid: string; kind?: string | null } | null;
}

/** UUID of the baked-in system user (see 0025 seed migration). */
export const SYSTEM_ACTOR_UUID = '5d4adce0-a381-4982-9c02-6e2540026238';

/** The default system actor used when no actor is supplied. */
export const SYSTEM_ACTOR: Actor = {
    user: { uuid: SYSTEM_ACTOR_UUID, username: 'system' },
    effectiveApp: null,
    system: true,
};

/**
 * Build an actor, deriving `effectiveApp` from its own app and, failing that,
 * from the app of whoever issued its access token.
 *
 * The issuer was itself built here, so its chain is already collapsed — one hop
 * is enough, and no caller has to walk anything.
 */
export const makeActor = (actor: Omit<Actor, 'effectiveApp'>): Actor => ({
    ...actor,
    effectiveApp: actor.app ?? actor.accessToken?.issuer.effectiveApp ?? null,
});

/**
 * Fail closed on an actor whose `effectiveApp` was never derived.
 *
 * Every actor on the request path is built by `AuthService` through
 * `makeActor`, so this cannot fire in production — which is the point. It turns
 * a future actor literal that skips the builder into a loud 500 at the edge
 * rather than a silent bypass deep inside a gate that read `undefined` as "no
 * app". Call it once, where the request actor is established.
 */
export const assertResolvedActor = (actor: Actor): Actor => {
    if (actor.effectiveApp === undefined) {
        throw new Error(
            'actor was built without `makeActor`: `effectiveApp` is unresolved, ' +
                'and app-scoped gates would read that as "no app"',
        );
    }
    return actor;
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
 * Stable identifier for an actor. Used as a cache key (e.g., permission scan
 * cache) and for cycle detection.
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
    return { user: actor.user, effectiveApp: null };
};
