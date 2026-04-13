/**
 * Minimal actor shape used by v2 stores and services.
 *
 * A full v2 auth layer will land later; for now stores/services that key data
 * on "who's acting" just need the user/app identity, plus a `system` flag for
 * internal operations that should bypass quotas and metering.
 */

export interface ActorUser {
    uuid: string;
    id?: number;
    username?: string;
    email?: string | null;
}

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
    user: ActorUser;
    app?: ActorApp | null;
    /** True for the system actor; skips metering / quota tracking. */
    system?: boolean;
    accessToken?: ActorAccessToken | null;
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
    return !!actor?.app && !actor?.accessToken;
};

export const isAccessTokenActor = (actor: Actor | undefined | null): boolean => {
    return !!actor?.accessToken;
};

/**
 * Stable identifier for an actor, matching v1's `actor.uid` semantics.
 * Used as a cache key (e.g., permission scan cache) and for cycle detection.
 */
export const actorUid = (actor: Actor): string => {
    if ( actor.accessToken ) {
        const authorizedUid = actor.accessToken.authorized ? actorUid(actor.accessToken.authorized) : '<none>';
        return `access-token:${actorUid(actor.accessToken.issuer)}:${authorizedUid}:${actor.accessToken.uid}`;
    }
    if ( isSystemActor(actor) ) return 'system';
    if ( actor.app ) return `app-under-user:${actor.user.uuid}:${actor.app.uid}`;
    return `user:${actor.user.uuid}`;
};

/**
 * Return a UserActorType-equivalent actor for any app-under-user actor,
 * matching v1's `actor.get_related_actor(UserActorType)` behavior.
 * For non-app actors, returns the actor unchanged.
 */
export const userRelatedActor = (actor: Actor): Actor => {
    if ( ! actor.app && ! actor.accessToken ) return actor;
    return { user: actor.user };
};
