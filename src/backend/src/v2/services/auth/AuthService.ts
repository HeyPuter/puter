import type { puterClients } from '../../clients';
import type { Actor } from '../../core/actor';
import type { puterStores } from '../../stores';
import type { AppRow, PermissionStore } from '../../stores/permission/PermissionStore';
import type { SessionStore } from '../../stores/session/SessionStore';
import type { UserRow, UserStore } from '../../stores/user/UserStore';
import type { IConfig, LayerInstances, WithLifecycle } from '../../types';
import { PuterService } from '../types';
import type { TokenService } from './TokenService';
import type {
    AnyTokenPayload,
    AppUnderUserTokenPayload,
    AccessTokenPayload,
    SessionRow,
    SessionTokenPayload,
} from './types';

type Stores = LayerInstances<typeof puterStores> & {
    permission?: PermissionStore;
    session?: SessionStore;
    user?: UserStore;
};

type Services = Partial<Record<string, WithLifecycle>> & {
    token?: TokenService;
};

/**
 * Authentication service for v2.
 *
 * Scope is deliberately narrow at this stage — just `authenticateFromToken`,
 * the one method the auth-probe middleware needs. Session creation, logout,
 * token rotation, 2FA, and the rest of v1's sprawling AuthService will land
 * when we port the auth controller (which will own mint / rotate / revoke).
 *
 * Token verification is wire-compatible with v1: same JWT secret, same
 * compression tables, same FPE key for session-uuid obfuscation in
 * app-under-user tokens. That means a v1-minted token authenticates on v2
 * during the transition.
 */
export class AuthService extends PuterService {
    protected override stores: Stores;
    protected override services: Services;

    constructor (
        config: IConfig,
        clients: LayerInstances<typeof puterClients>,
        stores: LayerInstances<typeof puterStores>,
        services: Services = {},
    ) {
        super(config, clients, stores, services);
        this.stores = stores as Stores;
        this.services = services;
    }

    // ── Lookup helpers (typed peer access) ──────────────────────────

    private get tokenService (): TokenService {
        const s = this.services.token;
        if ( ! s ) throw new Error('AuthService requires the `token` service to be registered');
        return s;
    }

    private get permStore (): PermissionStore {
        const s = this.stores.permission;
        if ( ! s ) throw new Error('AuthService requires the `permission` store to be registered');
        return s;
    }

    private get userStore (): UserStore {
        const s = this.stores.user;
        if ( ! s ) throw new Error('AuthService requires the `user` store to be registered');
        return s;
    }

    private get sessionStore (): SessionStore {
        const s = this.stores.session;
        if ( ! s ) throw new Error('AuthService requires the `session` store to be registered');
        return s;
    }

    // ── Public API ──────────────────────────────────────────────────

    /**
     * Resolve an auth token to a v2 Actor.
     *
     * Returns `null` for *any* failure — invalid signature, malformed payload,
     * legacy token shape, missing session, missing user, missing app. The
     * caller (auth probe) never differentiates: it either attaches an actor
     * or leaves `req.actor` undefined for per-route gates to reject.
     *
     * Ports v1 `AuthService.authenticate_from_token` logic branch-for-branch,
     * minus the legacy-token migration path (which runs in v1 until the v2
     * auth controller ships).
     */
    async authenticateFromToken (token: string): Promise<Actor | null> {
        let decoded: AnyTokenPayload;
        try {
            decoded = this.tokenService.verify<AnyTokenPayload>('auth', token);
        } catch {
            return null;
        }

        // Legacy v1 tokens (pre-`type` field) aren't supported on v2 — v1
        // still handles those via its `/whoami` migration path.
        if ( ! decoded.type ) return null;

        switch ( decoded.type ) {
            case 'session':
            case 'gui':
                return this.#actorFromSessionToken(decoded);
            case 'app-under-user':
                return this.#actorFromAppUnderUserToken(decoded);
            case 'access-token':
                return this.#actorFromAccessTokenToken(decoded);
            default:
                return null;
        }
    }

    // ── Session lifecycle ────────────────────────────────────────────

    /**
     * Create a session and sign a session JWT + GUI JWT for the user.
     *
     * `meta` is enriched with request metadata (IP, user-agent, etc.)
     * when a request context is available.
     */
    async createSessionToken (
        user: UserRow,
        meta: Record<string, unknown> = {},
    ): Promise<{ session: Record<string, unknown>; token: string; gui_token: string }> {
        const session = await this.sessionStore.create(user.id, meta);

        const token = this.tokenService.sign('auth', {
            type: 'session',
            version: '0.0.0',
            uuid: session.uuid,
            user_uid: user.uuid,
        });

        const gui_token = this.tokenService.sign('auth', {
            type: 'gui',
            version: '0.0.0',
            uuid: session.uuid,
            user_uid: user.uuid,
        });

        return { session, token, gui_token };
    }

    /** Sign a GUI token for an existing session. */
    createGuiToken (user: UserRow, sessionUuid: string): string {
        return this.tokenService.sign('auth', {
            type: 'gui',
            version: '0.0.0',
            uuid: sessionUuid,
            user_uid: user.uuid,
        });
    }

    /** Sign a session token for an existing session (upgrade from GUI token). */
    createSessionTokenForSession (user: UserRow, sessionUuid: string): string {
        return this.tokenService.sign('auth', {
            type: 'session',
            version: '0.0.0',
            uuid: sessionUuid,
            user_uid: user.uuid,
        });
    }

    /** Remove the session referenced by a session/GUI JWT. */
    async removeSessionByToken (token: string): Promise<void> {
        let decoded: AnyTokenPayload;
        try {
            decoded = this.tokenService.verify<AnyTokenPayload>('auth', token);
        } catch {
            return;
        }
        if ( decoded.type !== 'session' && decoded.type !== 'gui' ) return;
        await this.sessionStore.removeByUuid((decoded as SessionTokenPayload).uuid);
    }

    /** List all sessions for an actor's user. */
    async listSessions (actor: Actor): Promise<Array<Record<string, unknown>>> {
        if ( ! actor.user?.id ) return [];

        const rows = await this.sessionStore.getByUserId(actor.user.id);

        return rows.map((row: Record<string, unknown>) => {
            const meta = (typeof row.meta === 'string' ? JSON.parse(row.meta as string) : row.meta) ?? {};
            const isCurrent = actor.session?.uid === row.uuid;
            return {
                uuid: row.uuid,
                created_at: row.created_at,
                last_activity: row.last_activity,
                current: isCurrent,
                ...meta,
            };
        });
    }

    /** Revoke a specific session by uuid. */
    async revokeSession (uuid: string): Promise<void> {
        await this.sessionStore.removeByUuid(uuid);
    }

    // ── Internals ───────────────────────────────────────────────────

    async #actorFromSessionToken (decoded: SessionTokenPayload): Promise<Actor | null> {
        const session = await this.sessionStore.getByUuid(decoded.uuid);
        if ( ! session ) return null;

        const user = await this.userStore.getByUuid(decoded.user_uid);
        if ( ! user ) return null;

        return this.#buildUserActor(user, session);
    }

    async #actorFromAppUnderUserToken (decoded: AppUnderUserTokenPayload): Promise<Actor | null> {
        // App tokens may or may not carry a session reference. If present,
        // the token is bound to that session — log out invalidates it.
        let session: SessionRow | null = null;
        if ( decoded.session ) {
            session = await this.sessionStore.getByUuid(decoded.session);
            if ( ! session ) return null;
        }

        const user = await this.userStore.getByUuid(decoded.user_uid);
        if ( ! user ) return null;

        const app = await this.permStore.getAppByUid(decoded.app_uid);
        if ( ! app ) return null;

        return this.#buildAppUnderUserActor(user, app, session);
    }

    async #actorFromAccessTokenToken (decoded: AccessTokenPayload): Promise<Actor | null> {
        if ( ! decoded.token_uid || ! decoded.user_uid ) return null;

        const user = await this.userStore.getByUuid(decoded.user_uid);
        if ( ! user ) return null;

        // The authorizer is the identity whose permissions the access token
        // can exercise — either a plain user or an app-under-user.
        let authorizer: Actor;
        if ( decoded.app_uid ) {
            const app = await this.permStore.getAppByUid(decoded.app_uid);
            if ( ! app ) return null;
            authorizer = this.#buildAppUnderUserActor(user, app, null);
        } else {
            authorizer = this.#buildUserActor(user, null);
        }

        return {
            user: this.#actorUserFromRow(user),
            accessToken: {
                uid: decoded.token_uid,
                issuer: authorizer,
                authorized: null,
            },
        };
    }

    // ── Actor builders ──────────────────────────────────────────────

    #actorUserFromRow (user: UserRow) {
        return {
            uuid: user.uuid,
            id: user.id,
            username: user.username,
            email: user.email ?? null,
            suspended: user.suspended ?? false,
            email_confirmed: user.email_confirmed ?? false,
            requires_email_confirmation: user.requires_email_confirmation ?? false,
        };
    }

    #buildUserActor (user: UserRow, session: SessionRow | null): Actor {
        return {
            user: this.#actorUserFromRow(user),
            session: session ? { uid: session.uuid } : null,
        };
    }

    #buildAppUnderUserActor (user: UserRow, app: AppRow, session: SessionRow | null): Actor {
        return {
            user: this.#actorUserFromRow(user),
            app: {
                uid: app.uid,
                id: app.id,
            },
            session: session ? { uid: session.uuid } : null,
        };
    }
}
