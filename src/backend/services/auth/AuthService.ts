import { v4 as uuidv4, v5 as uuidv5 } from 'uuid';
import type { Actor } from '../../core/actor';
import { HttpError } from '../../core/http/HttpError.js';
import type { UserRow } from '../../stores/user/UserStore';
import type { LayerInstances } from '../../types';
import type { puterServices } from '../index';
import { PuterService } from '../types';
import type {
    AccessTokenPayload,
    AnyTokenPayload,
    AppUnderUserTokenPayload,
    SessionRow,
    SessionTokenPayload,
} from './types';

const APP_ORIGIN_UUID_NAMESPACE = '33de3768-8ee0-43e9-9e73-db192b97a5d8';

/**
 * Authentication service.
 *
 * Scope is currently narrow — just `authenticateFromToken`, the one method
 * the auth-probe middleware needs. Session creation, logout, token
 * rotation, 2FA, and the rest of the auth surface will land when the auth
 * controller is wired up (it will own mint / rotate / revoke).
 */
export class AuthService extends PuterService {
    declare protected services: LayerInstances<typeof puterServices>;

    override onServerStart(): void {
        // Users implicitly hold read access to their own email — needed for
        // any permission-gated path that asks for `user:<uuid>:email:read`
        // (puter-js's `user:<uuid>:email:read` permission request flows
        // through the scan even though the v2 whoami extension inlines the
        // email field directly and skips the check).
        this.services.permission.registerImplicator({
            id: 'user-set-own',
            shortcut: true,
            matches: (permission: string) => permission.startsWith('user:'),
            check: async ({ actor, permission }): Promise<unknown> => {
                if (actor.app || actor.accessToken) return undefined;
                if (!actor.user?.uuid) return undefined;
                if (permission === `user:${actor.user.uuid}:email:read`) {
                    return {};
                }
                return undefined;
            },
        });
    }

    // ── Public API ──────────────────────────────────────────────────

    /**
     * Resolve an auth token to a v2 Actor.
     *
     * Returns `null` for *any* failure — invalid signature, malformed payload,
     * legacy token shape, missing session, missing user, missing app. The
     * caller (auth probe) never differentiates: it either attaches an actor
     * or leaves `req.actor` undefined for per-route gates to reject.
     */
    async authenticateFromToken(token: string): Promise<Actor | null> {
        let decoded: AnyTokenPayload;
        try {
            decoded = this.services.token.verify<AnyTokenPayload>(
                'auth',
                token,
            );
        } catch {
            return null;
        }

        // Legacy tokens (pre-`type` field) aren't supported.
        if (!decoded.type) return null;

        switch (decoded.type) {
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
    async createSessionToken(
        user: UserRow,
        meta: Record<string, unknown> = {},
    ): Promise<{
        session: Record<string, unknown>;
        token: string;
        gui_token: string;
    }> {
        const session = await this.stores.session.create(user.id, meta);

        const token = this.services.token.sign('auth', {
            type: 'session',
            version: '0.0.0',
            uuid: session.uuid,
            user_uid: user.uuid,
        });

        const gui_token = this.services.token.sign('auth', {
            type: 'gui',
            version: '0.0.0',
            uuid: session.uuid,
            user_uid: user.uuid,
        });

        return { session, token, gui_token };
    }

    /** Sign a GUI token for an existing session. */
    createGuiToken(user: UserRow, sessionUuid: string): string {
        return this.services.token.sign('auth', {
            type: 'gui',
            version: '0.0.0',
            uuid: sessionUuid,
            user_uid: user.uuid,
        });
    }

    /** Sign a session token for an existing session (upgrade from GUI token). */
    createSessionTokenForSession(user: UserRow, sessionUuid: string): string {
        return this.services.token.sign('auth', {
            type: 'session',
            version: '0.0.0',
            uuid: sessionUuid,
            user_uid: user.uuid,
        });
    }

    /** Remove the session referenced by a session/GUI JWT. */
    async removeSessionByToken(token: string): Promise<void> {
        let decoded: AnyTokenPayload;
        try {
            decoded = this.services.token.verify<AnyTokenPayload>(
                'auth',
                token,
            );
        } catch {
            return;
        }
        if (decoded.type !== 'session' && decoded.type !== 'gui') return;
        await this.stores.session.removeByUuid(
            (decoded as SessionTokenPayload).uuid,
        );
    }

    /** List all sessions for an actor's user. */
    async listSessions(actor: Actor): Promise<Array<Record<string, unknown>>> {
        if (!actor.user?.id) return [];

        const rows = await this.stores.session.getByUserId(actor.user.id);

        return rows.map((row: Record<string, unknown>) => {
            const meta =
                (typeof row.meta === 'string'
                    ? JSON.parse(row.meta as string)
                    : row.meta) ?? {};
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
    async revokeSession(uuid: string): Promise<void> {
        await this.stores.session.removeByUuid(uuid);
    }

    // ── App / origin resolution ─────────────────────────────────────

    /**
     * Resolve an origin URL to an app UID.
     *
     * Fires `app.from-origin` before hashing so listeners can rewrite the
     * origin (e.g. polotno maps `polotno.com` → `studio.polotno.com` so both
     * surfaces resolve to the same app row).
     *
     * Lookup order:
     *   1. **Canonical DB match.** If any app in the DB has an `index_url`
     *      that normalizes to this origin (across every configured hosting
     *      variant — `puter.site`, `puter.app`, etc.), return that app's
     *      real UID. Required for private apps: their `/auth/get-user-app-token`
     *      tokens must reference the real app row so the app-under-user
     *      verification path can load them.
     *   2. **UUIDv5 deterministic fallback.** Origins that don't match any
     *      app (third-party sites, apps not yet in the DB) get a deterministic
     *      namespaced UUID
     */
    async appUidFromOrigin(origin: string): Promise<string> {
        const parsed = this.#originFromUrl(origin);
        if (!parsed) {
            console.error('[auth] failed to parse origin URL', { origin });
            throw new HttpError(400, 'Invalid origin URL', {
                legacyCode: 'no_origin_for_app',
            });
        }
        const event = { origin: parsed };
        await this.clients.event?.emitAndWait('app.from-origin', event, {});

        const canonicalUid = await this.#findCanonicalAppUidForOrigin(
            event.origin,
        );
        if (canonicalUid) return canonicalUid;

        const uid = uuidv5(event.origin, APP_ORIGIN_UUID_NAMESPACE);
        return `app-${uid}`;
    }

    /**
     * Find the real app row whose `index_url` canonically matches `origin`.
     *
     * Build candidate URLs from the origin's subdomain crossed with every
     * configured hosting domain (static + private, with and without ports).
     * Prefer the oldest matching app for deterministic tie-breaking across
     * historically-duplicated rows.
     */
    async #findCanonicalAppUidForOrigin(
        origin: string,
    ): Promise<string | null> {
        let parsed: URL;
        try {
            parsed = new URL(origin);
        } catch {
            return null;
        }

        const config = this.config as {
            static_hosting_domain?: string;
            static_hosting_domain_alt?: string;
            private_app_hosting_domain?: string;
            private_app_hosting_domain_alt?: string;
            protocol?: string;
        };

        const normalizeDomainValue = (v: unknown): string | null => {
            if (typeof v !== 'string') return null;
            const trimmed = v.trim().toLowerCase().replace(/^\./, '');
            return trimmed || null;
        };
        const stripPort = (v: string): string => v.split(':')[0] || v;

        const hostingDomainsRaw = [
            normalizeDomainValue(config.static_hosting_domain),
            normalizeDomainValue(config.static_hosting_domain_alt),
            normalizeDomainValue(config.private_app_hosting_domain),
            normalizeDomainValue(config.private_app_hosting_domain_alt),
        ].filter((d): d is string => !!d);
        const hostingDomainsStripped = hostingDomainsRaw.map(stripPort);
        const hostingDomains = [
            ...new Set([...hostingDomainsRaw, ...hostingDomainsStripped]),
        ];

        const hostRaw = parsed.host.toLowerCase();
        const hostStripped = parsed.hostname.toLowerCase();

        // Extract the subdomain label under the longest matching hosting
        // domain — longest-first avoids matching `puter.app` before
        // `foo.puter.app`.
        let subdomain: string | null = null;
        const sortedHostingDomains = [...hostingDomains].sort(
            (a, b) => b.length - a.length,
        );
        for (const d of sortedHostingDomains) {
            const suffix = `.${d}`;
            if (hostRaw === d || hostStripped === d) {
                subdomain = null;
                break;
            }
            if (hostRaw.endsWith(suffix)) {
                subdomain = hostRaw.slice(0, hostRaw.length - suffix.length);
                subdomain = subdomain.split('.')[0] || null;
                break;
            }
            if (hostStripped.endsWith(suffix)) {
                subdomain = hostStripped.slice(
                    0,
                    hostStripped.length - suffix.length,
                );
                subdomain = subdomain.split('.')[0] || null;
                break;
            }
        }

        const hostCandidates = new Set<string>([hostRaw, hostStripped]);
        if (subdomain) {
            for (const d of hostingDomains) {
                hostCandidates.add(`${subdomain}.${d}`);
            }
        }

        const protocolCandidates = new Set<string>([
            parsed.protocol.replace(/:$/, ''),
            (config.protocol ?? '').trim().replace(/:$/, '') || 'https',
            'https',
            'http',
        ]);

        const urlCandidates: string[] = [];
        for (const hc of hostCandidates) {
            if (!hc) continue;
            for (const protocol of protocolCandidates) {
                if (!protocol) continue;
                const base = `${protocol}://${hc}`;
                urlCandidates.push(base, `${base}/`, `${base}/index.html`);
            }
        }
        const uniqueCandidates = [...new Set(urlCandidates)];
        if (uniqueCandidates.length === 0) return null;

        const placeholders = uniqueCandidates.map(() => '?').join(', ');
        const rows = (await this.clients.db.read(
            `SELECT \`uid\` FROM \`apps\` WHERE \`index_url\` IN (${placeholders}) ORDER BY \`id\` ASC LIMIT 1`,
            uniqueCandidates,
        )) as Array<{ uid?: string }>;
        const uid = rows[0]?.uid;
        return typeof uid === 'string' && uid ? uid : null;
    }

    /**
     * Sign an app-under-user token for the given app UID.
     * Requires a user actor in the provided actor.
     */
    getUserAppToken(actor: Actor, appUid: string): string {
        if (!actor.user) throw new Error('Actor must be a user');
        return this.services.token.sign('auth', {
            type: 'app-under-user',
            version: '0.0.0',
            user_uid: actor.user.uuid,
            app_uid: appUid,
            ...(actor.session ? { session: actor.session.uid } : {}),
        });
    }

    // ── Private / public hosted asset cookies ───────────────────────
    //
    // Ported from v1's `createPrivateAssetToken` / `createPublicHostedActor
    // Token`. These are sticky cookies set by the puter-site middleware
    // after a visitor successfully passes the private-app access gate
    // (or is resolved as an actor on a public hosted app). Subsequent
    // requests read the cookie and skip the full entitlement lookup.
    //
    // Claims are kept narrow — userUid + sessionUuid + appUid + subdomain
    // + privateHost — so a cookie minted for one app/subdomain cannot be
    // replayed against another. `verify*Token` enforces those expectations.

    /** Cookie name that carries the sticky private-asset token. */
    getPrivateAssetCookieName(): string {
        return 'puter.private.asset.token';
    }

    /** Cookie name that carries the public hosted-actor token. */
    getPublicHostedActorCookieName(): string {
        return 'puter.public.hosted.actor.token';
    }

    /** Shared cookie options for both sticky-auth cookies. */
    getPrivateAssetCookieOptions(
        opts: {
            requestHostname?: string;
        } = {},
    ): Record<string, unknown> {
        return this.#hostedAssetCookieOptions(opts.requestHostname);
    }

    /** Alias — matching v1's naming. Same options used by both cookies. */
    getPublicHostedActorCookieOptions(
        opts: {
            requestHostname?: string;
        } = {},
    ): Record<string, unknown> {
        return this.#hostedAssetCookieOptions(opts.requestHostname);
    }

    createPrivateAssetToken(claims: {
        appUid: string;
        userUid: string;
        sessionUuid?: string;
        subdomain?: string;
        privateHost?: string;
    }): string {
        return this.services.token.sign('hosted-asset', {
            kind: 'private',
            version: '0.0.0',
            user_uid: claims.userUid,
            app_uid: claims.appUid,
            ...(claims.sessionUuid ? { session_uuid: claims.sessionUuid } : {}),
            ...(claims.subdomain ? { subdomain: claims.subdomain } : {}),
            ...(claims.privateHost ? { host: claims.privateHost } : {}),
        });
    }

    createPublicHostedActorToken(claims: {
        appUid: string;
        userUid: string;
        sessionUuid?: string;
        subdomain?: string;
        host?: string;
    }): string {
        return this.services.token.sign('hosted-asset', {
            kind: 'public',
            version: '0.0.0',
            user_uid: claims.userUid,
            app_uid: claims.appUid,
            ...(claims.sessionUuid ? { session_uuid: claims.sessionUuid } : {}),
            ...(claims.subdomain ? { subdomain: claims.subdomain } : {}),
            ...(claims.host ? { host: claims.host } : {}),
        });
    }

    verifyPrivateAssetToken(
        token: string,
        expected: {
            expectedAppUid?: string;
            expectedSubdomain?: string;
            expectedPrivateHost?: string;
        } = {},
    ): {
        userUid: string;
        sessionUuid?: string;
        appUid?: string;
        subdomain?: string;
        privateHost?: string;
    } {
        const decoded = this.#verifyHostedAssetToken(token, 'private');
        this.#assertExpected(
            decoded,
            'app_uid',
            expected.expectedAppUid,
            'expectedAppUid',
        );
        this.#assertExpected(
            decoded,
            'subdomain',
            expected.expectedSubdomain,
            'expectedSubdomain',
        );
        this.#assertExpected(
            decoded,
            'host',
            expected.expectedPrivateHost,
            'expectedPrivateHost',
        );
        return {
            userUid: decoded.user_uid as string,
            sessionUuid: decoded.session_uuid as string | undefined,
            appUid: decoded.app_uid as string | undefined,
            subdomain: decoded.subdomain as string | undefined,
            privateHost: decoded.host as string | undefined,
        };
    }

    verifyPublicHostedActorToken(
        token: string,
        expected: {
            expectedAppUid?: string;
            expectedSubdomain?: string;
            expectedHost?: string;
        } = {},
    ): {
        userUid: string;
        sessionUuid?: string;
        appUid?: string;
        subdomain?: string;
        host?: string;
    } {
        const decoded = this.#verifyHostedAssetToken(token, 'public');
        this.#assertExpected(
            decoded,
            'app_uid',
            expected.expectedAppUid,
            'expectedAppUid',
        );
        this.#assertExpected(
            decoded,
            'subdomain',
            expected.expectedSubdomain,
            'expectedSubdomain',
        );
        this.#assertExpected(
            decoded,
            'host',
            expected.expectedHost,
            'expectedHost',
        );
        return {
            userUid: decoded.user_uid as string,
            sessionUuid: decoded.session_uuid as string | undefined,
            appUid: decoded.app_uid as string | undefined,
            subdomain: decoded.subdomain as string | undefined,
            host: decoded.host as string | undefined,
        };
    }

    #verifyHostedAssetToken(
        token: string,
        expectedKind: 'private' | 'public',
    ): Record<string, unknown> {
        const decoded = this.services.token.verify<Record<string, unknown>>(
            'hosted-asset',
            token,
        );
        if (decoded.kind !== expectedKind) {
            throw new Error(`hosted-asset token is not ${expectedKind}`);
        }
        if (typeof decoded.user_uid !== 'string' || !decoded.user_uid) {
            throw new Error('hosted-asset token missing user_uid');
        }
        return decoded;
    }

    #assertExpected(
        decoded: Record<string, unknown>,
        field: string,
        expected: string | undefined,
        label: string,
    ): void {
        if (expected === undefined) return;
        if (decoded[field] !== expected) {
            throw new Error(`hosted-asset token ${label} mismatch`);
        }
    }

    #hostedAssetCookieOptions(
        requestHostname?: string,
    ): Record<string, unknown> {
        // Scope the cookie to the request host only. Not using `domain`
        // so the browser doesn't share it across unrelated private-app
        // subdomains — each app sees only its own cookie.
        const options: Record<string, unknown> = {
            httpOnly: true,
            secure: true,
            sameSite: 'none',
            maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
            path: '/',
        };
        if (requestHostname) {
            // Not strictly necessary (browsers default to the response
            // origin when `domain` is absent), but included for clarity
            // in server logs.
            options.hostname = requestHostname;
        }
        return options;
    }

    // ── Access tokens ───────────────────────────────────────────────

    /**
     * Create an access token with the given permissions.
     *
     * Each permission spec is `[permissionString, extraObject?]`.
     * The token is stored in `access_token_permissions` and a JWT is
     * returned.
     */
    async createAccessToken(
        actor: Actor,
        permissions: Array<[string, Record<string, unknown>?]>,
        options: { expiresIn?: string } = {},
    ): Promise<string> {
        if (!actor.user) throw new Error('Actor must have a user');
        if (actor.accessToken) {
            throw new HttpError(
                403,
                'Access tokens may not create access tokens',
                {
                    legacyCode: 'forbidden',
                },
            );
        }

        const tokenUid = uuidv4();
        const jwtPayload: Record<string, unknown> = {
            type: 'access-token',
            version: '0.0.0',
            token_uid: tokenUid,
            user_uid: actor.user.uuid,
        };
        if (actor.app) {
            jwtPayload.app_uid = actor.app.uid;
        }

        const jwt = this.services.token.sign('auth', jwtPayload, options);

        // Store each permission grant
        const db = this.stores.permission as unknown as {
            clients: {
                db: { write: (q: string, p: unknown[]) => Promise<void> };
            };
        };
        for (const spec of permissions) {
            const [permission, extra] = spec;
            await (db.clients?.db ?? this.clients.db).write(
                'INSERT INTO `access_token_permissions` (`token_uid`, `authorizer_user_id`, `authorizer_app_id`, `permission`, `extra`) VALUES (?, ?, ?, ?, ?)',
                [
                    tokenUid,
                    actor.user.id ?? null,
                    actor.app?.id ?? null,
                    permission,
                    extra ? JSON.stringify(extra) : '{}',
                ],
            );
        }
        await this.stores.permission.invalidateAccessTokenPerms(tokenUid);

        return jwt;
    }

    /**
     * Revoke an access token by JWT or token UUID.
     *
     * Caller must be a user actor (gated at the route). Ownership is verified
     * before deletion so one user cannot revoke another user's token by
     * guessing/leaking the token_uid.
     */
    async revokeAccessToken(actor: Actor, tokenOrUuid: string): Promise<void> {
        if (!actor.user) throw new Error('Actor must have a user');

        let tokenUid: string;
        let issuerUuidFromJwt: string | undefined;
        const isJwt = /^[\w-]+\.[\w-]+\.[\w-]+$/.test(tokenOrUuid.trim());
        if (isJwt) {
            const decoded = this.services.token.verify<AccessTokenPayload>(
                'auth',
                tokenOrUuid,
            );
            if (decoded.type !== 'access-token' || !decoded.token_uid) {
                throw new HttpError(400, 'Invalid access token');
            }
            tokenUid = decoded.token_uid;
            issuerUuidFromJwt = decoded.user_uid;
        } else {
            tokenUid = tokenOrUuid;
        }

        // A signature-verified JWT is itself proof of who issued the token —
        // the body's `user_uid` was set by createAccessToken at mint time.
        // For raw-uuid input we fall back to the persisted authorizer.
        if (issuerUuidFromJwt !== undefined) {
            if (issuerUuidFromJwt !== actor.user.uuid) {
                throw new HttpError(404, 'Access token not found');
            }
        } else {
            const rows = (await this.clients.db.read(
                'SELECT `authorizer_user_id` FROM `access_token_permissions` WHERE `token_uid` = ? LIMIT 1',
                [tokenUid],
            )) as Array<{ authorizer_user_id?: number | null }>;
            const ownerId = rows[0]?.authorizer_user_id ?? null;
            if (ownerId === null || ownerId !== actor.user.id) {
                throw new HttpError(404, 'Access token not found');
            }
        }

        await this.clients.db.write(
            'DELETE FROM `access_token_permissions` WHERE `token_uid` = ?',
            [tokenUid],
        );
        await this.stores.permission.invalidateAccessTokenPerms(tokenUid);
    }

    // ── Internals ───────────────────────────────────────────────────

    #originFromUrl(url: string): string | null {
        try {
            const parsed = new URL(url);
            return `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ''}`;
        } catch {
            return null;
        }
    }

    async #actorFromSessionToken(
        decoded: SessionTokenPayload,
    ): Promise<Actor | null> {
        const session = await this.stores.session.getByUuid(decoded.uuid);
        if (!session) return null;

        const user = await this.stores.user.getByUuid(decoded.user_uid);
        if (!user) return null;

        return this.#buildUserActor(user, session);
    }

    async #actorFromAppUnderUserToken(
        decoded: AppUnderUserTokenPayload,
    ): Promise<Actor | null> {
        // App tokens may or may not carry a session reference. If present,
        // the token is bound to that session — log out invalidates it.
        let session: SessionRow | null = null;
        if (decoded.session) {
            session = await this.stores.session.getByUuid(decoded.session);
            if (!session) return null;
        }

        const user = await this.stores.user.getByUuid(decoded.user_uid);
        if (!user) return null;

        const app = await this.stores.app.getByUid(decoded.app_uid);
        if (!app) return null;

        return this.#buildAppUnderUserActor(user, app, session);
    }

    async #actorFromAccessTokenToken(
        decoded: AccessTokenPayload,
    ): Promise<Actor | null> {
        if (!decoded.token_uid || !decoded.user_uid) return null;

        const user = await this.stores.user.getByUuid(decoded.user_uid);
        if (!user) return null;

        // The authorizer is the identity whose permissions the access token
        // can exercise — either a plain user or an app-under-user.
        let authorizer: Actor;
        if (decoded.app_uid) {
            const app = await this.stores.app.getByUid(decoded.app_uid);
            if (!app) return null;
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

    #actorUserFromRow(user: UserRow) {
        return {
            uuid: user.uuid,
            id: user.id,
            username: user.username,
            email: user.email ?? null,
            suspended: user.suspended ?? false,
            email_confirmed: user.email_confirmed ?? false,
            requires_email_confirmation:
                user.requires_email_confirmation ?? false,
        };
    }

    #buildUserActor(user: UserRow, session: SessionRow | null): Actor {
        return {
            user: this.#actorUserFromRow(user),
            session: session ? { uid: session.uuid } : null,
        };
    }

    #buildAppUnderUserActor(
        user: UserRow,
        app: { uid: string; id: number },
        session: SessionRow | null,
    ): Actor {
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
