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
 * Set when the actor acts through an access token issued by `issuer`; the
 * token's `access_token_permissions` rows gate which of the issuer's
 * permissions it may exercise.
 */
export interface ActorAccessToken {
    uid: string;
    issuer: Actor;
    authorized?: Actor | null;
    /**
     * Personal access token (signed `full_access` claim): full API reach, but
     * still rejected by `requireUserActor`, so never account management.
     */
    fullAccess?: boolean;
}

export interface Actor {
    user: Partial<UserRow>;
    /**
     * The app this actor carries _directly_, empty on an access token an app
     * issued. Answers "is this an app acting as itself" — `isAppActor` is
     * usually the clearer way to ask — and never "which app is acting", which
     * reads as "no app" for a token and falls open.
     */
    app?: ActorApp | null;
    /**
     * The app this actor ultimately acts as: its own `app`, else the app of its
     * access token's issuer. Gates asking "which app" must read this, not
     * `app`. `null` means resolved to no app; `undefined` means the actor
     * skipped `makeActor` and must not be read as "no app".
     */
    effectiveApp?: ActorApp | null;
    /** True for the system actor; skips metering / quota tracking. */
    system?: boolean;
    accessToken?: ActorAccessToken | null;
    /**
     * Set when authenticated by a session token or an app-under-user token
     * carrying one. `kind` mirrors the session row (`web`, `app`, `worker`).
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
 * Build an actor with `effectiveApp` derived; the issuer is already collapsed,
 * so one hop suffices.
 */
export const makeActor = (actor: Omit<Actor, 'effectiveApp'>): Actor => ({
    ...actor,
    effectiveApp: actor.app ?? actor.accessToken?.issuer.effectiveApp ?? null,
});

/**
 * Fail closed on an actor that skipped `makeActor`, at the edge rather than
 * inside a gate reading `undefined` as "no app".
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

/**
 * The account acting as itself, through nothing: no app and no token of any
 * kind. Narrower than `isAccountContext`, which also admits a full-access token
 * — use this where the distinction is "a browser session" rather than "the
 * account's own reach".
 */
export const isPlainUserActor = (
    actor: Pick<Actor, 'app' | 'accessToken'> | undefined | null,
): boolean => !!actor && !actor.app && !actor.accessToken;

export const isAccessTokenActor = (
    actor: Actor | undefined | null,
): boolean => {
    return !!actor?.accessToken;
};

/**
 * Whether the actor holds the account's own reach: a plain session or a
 * full-access token. Use this, not `effectiveApp === null`, which would also
 * admit scoped access tokens. Unresolved actors answer no.
 */
export const isAccountContext = (actor: Actor | undefined | null): boolean => {
    if (!actor || actor.effectiveApp !== null) return false;
    return !actor.accessToken || actor.accessToken.fullAccess === true;
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
