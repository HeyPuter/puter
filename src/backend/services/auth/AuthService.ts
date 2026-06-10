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

import { v4 as uuidv4, v5 as uuidv5 } from 'uuid';
import type { Actor } from '../../core/actor';
import { HttpError } from '../../core/http/HttpError.js';
import { checkRateLimit } from '../../core/http/middleware/rateLimit.js';
import {
    ASSET_WINDOW_SECONDS,
    WEB_WINDOW_SECONDS,
} from '../../stores/session/SessionStore.js';
import type { UserRow } from '../../stores/user/UserStore';
import type { LayerInstances } from '../../types';
import { sessionCookieFlags } from '../../util/cookieFlags.js';
import type { puterServices } from '../index';
import { PuterService } from '../types';
import { FULL_API_ACCESS } from '../permission/consts';
import { V1TokensDisabledError } from './TokenService';
import type {
    AccessTokenPayload,
    AnyTokenPayload,
    AppUnderUserTokenPayload,
    SessionRow,
    SessionTokenPayload,
} from './types';

const APP_ORIGIN_UUID_NAMESPACE = '33de3768-8ee0-43e9-9e73-db192b97a5d8';

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

export type ReauthReason = 'token_v1' | 'session_revoked' | 'session_expired';

export interface AuthResult {
    actor?: Actor;
    reauth?: { reason: ReauthReason; auth_id?: string };
    invalid?: true;
}

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

    // -- Public API --------------------------------------------------

    async authenticateFromToken(token: string): Promise<Actor | null> {
        const result = await this.authenticate(token);
        return result.actor ?? null;
    }

    /**
     * Mint a short-lived, server-signed JWT that proves the bearer was
     * previously identified as `authId` by a real session (the one that
     * just rejected with reauth-required). The 401 response embeds this
     * token; the GUI echoes it back on /login or /signup so the controller
     * can re-attach the new session to the same user row.
     *
     * Signing here — rather than letting the client present the raw
     * `auth_id` UUID — means a leaked UUID alone is not enough to attach
     * a session to an existing temp account; the attacker would also
     * have to have intercepted a live 401 from that user. The token's
     * 10-minute TTL bounds that intercept window.
     */
    signReauthToken(authId: string): string {
        return this.services.token.sign(
            'otp',
            { auth_id: authId, purpose: 'reauth' },
            { expiresIn: '10m' },
        );
    }

    /**
     * Verify a reauth token and return its `auth_id` claim. Throws an
     * HttpError on signature failure, expiry, or wrong purpose.
     */
    verifyReauthToken(token: string): { authId: string } {
        let decoded: { auth_id?: string; purpose?: string };
        try {
            decoded = this.services.token.verify<{
                auth_id?: string;
                purpose?: string;
            }>('otp', token);
        } catch {
            throw new HttpError(401, 'Invalid reauth token', {
                legacyCode: 'token_invalid',
            });
        }
        if (decoded.purpose !== 'reauth' || !decoded.auth_id) {
            throw new HttpError(401, 'Invalid reauth token', {
                legacyCode: 'token_invalid',
            });
        }
        return { authId: decoded.auth_id };
    }

    async authenticate(
        token: string,
        ctx: { ip?: string; userAgent?: string } = {},
    ): Promise<AuthResult> {
        let decoded: AnyTokenPayload;
        try {
            decoded = this.services.token.verify<AnyTokenPayload>(
                'auth',
                token,
            );
        } catch (err) {
            // v1 tokens disabled — surface a `reauth_required` signal
            // with an advisory `auth_id` hint so stragglers on cached
            // old bundles see the re-login modal instead of a bare 401.
            // The hint is read from the *unverified* payload; it's only
            // used to label the response, never to grant access.
            if (err instanceof V1TokensDisabledError) {
                const hint = err.payload;
                const auth_id =
                    (hint.auth_id as string | undefined) ??
                    (hint.user_uid as string | undefined);
                return { reauth: { reason: 'token_v1', auth_id } };
            }
            return { invalid: true };
        }

        // Legacy tokens (pre-`type` field) aren't supported.
        if (!decoded.type) return { invalid: true };

        let result: AuthResult;
        switch (decoded.type) {
            case 'session':
            case 'gui':
                result = await this.#actorFromSessionToken(decoded, ctx);
                break;
            case 'app-under-user':
                result = await this.#actorFromAppUnderUserToken(decoded, ctx);
                break;
            case 'access-token':
                result = await this.#actorFromAccessTokenToken(decoded, ctx);
                break;
            default:
                return { invalid: true };
        }

        if (decoded.legacy && !result.reauth) {
            const authId =
                (decoded.auth_id as string | undefined) ??
                result.actor?.user?.uuid;
            result.reauth = { reason: 'token_v1', auth_id: authId };
        }

        return result;
    }

    // -- Session lifecycle --------------------------------------------

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
        const auth_id = this.#authIdFor(user);
        const session = await this.stores.session.create(user.id, {
            meta,
            kind: 'web',
            last_ip: (meta.ip as string | undefined) ?? null,
            last_user_agent: (meta.user_agent as string | undefined) ?? null,
            expires_at: nowSeconds() + WEB_WINDOW_SECONDS,
            auth_id,
        });

        const token = this.#signSessionTypeToken(
            'session',
            user,
            session.uuid,
            auth_id,
        );
        const gui_token = this.#signSessionTypeToken(
            'gui',
            user,
            session.uuid,
            auth_id,
        );

        return { session, token, gui_token };
    }

    /** Sign a GUI token for an existing session. */
    createGuiToken(user: UserRow, sessionUuid: string): string {
        return this.#signSessionTypeToken(
            'gui',
            user,
            sessionUuid,
            this.#authIdFor(user),
        );
    }

    /** Sign a session token for an existing session (upgrade from GUI token). */
    createSessionTokenForSession(user: UserRow, sessionUuid: string): string {
        return this.#signSessionTypeToken(
            'session',
            user,
            sessionUuid,
            this.#authIdFor(user),
        );
    }

    /** Shared signer for session/gui tokens — keeps the v2 claim shape consistent. */
    #signSessionTypeToken(
        type: 'session' | 'gui',
        user: UserRow,
        sessionUuid: string,
        authId: string,
        opts: { worker?: boolean; workerName?: string } = {},
    ): string {
        const claims: Record<string, unknown> = {
            type,
            version: '2',
            // `uuid` retained alongside `session_uid` so any legacy reader
            // (e.g. middleware that hasn't been updated to v2 claims yet)
            // still finds the session id where it expects.
            uuid: sessionUuid,
            session_uid: sessionUuid,
            user_uid: user.uuid,
            auth_id: authId,
        };
        if (opts.worker) claims.worker = true;
        if (opts.workerName) claims.worker_name = opts.workerName;
        return this.services.token.sign('auth', claims);
    }

    /**
     * Worker variant of `createSessionToken` for user-scoped workers
     * (not bound to any specific app). Idempotent on
     * (user_id, worker_name) via the `kind='worker'` partial unique
     * index — redeploying the same worker reuses the row and returns
     * the same stable token. Expires after `WORKER_WINDOW_SECONDS`
     * (effectively infinite). The emitted JWT carries `worker: true`
     * and `worker_name` so downstream code can tell a worker session
     * from a user-driven one without a DB round-trip.
     */
    async createWorkerSessionToken(
        user: UserRow,
        workerName: string,
        meta: Record<string, unknown> = {},
    ): Promise<{
        session: Record<string, unknown>;
        token: string;
        gui_token: string;
    }> {
        if (!workerName) {
            throw new HttpError(400, 'Missing `workerName`', {
                legacyCode: 'bad_request',
            });
        }
        const auth_id = this.#authIdFor(user);
        const session = await this.stores.session.getOrCreateWorker(user.id, {
            appUid: null,
            workerName,
            meta,
            last_ip: (meta.ip as string | undefined) ?? null,
            last_user_agent: (meta.user_agent as string | undefined) ?? null,
            auth_id,
        });
        if (!session) {
            throw new HttpError(500, 'Worker session create failed', {
                legacyCode: 'internal_error',
            });
        }

        const token = this.#signSessionTypeToken(
            'session',
            user,
            session.uuid as string,
            auth_id,
            { worker: true, workerName },
        );
        const gui_token = this.#signSessionTypeToken(
            'gui',
            user,
            session.uuid as string,
            auth_id,
            { worker: true, workerName },
        );

        return { session, token, gui_token };
    }

    /**
     * Worker variant of `getUserAppToken` for app-scoped workers.
     * Idempotent on (user_id, app_uid, worker_name) via the
     * `kind='worker'` partial unique index — the same app can host
     * many workers distinguished by name, each getting its own
     * stable long-lived token. Coexists with an interactive
     * `kind='app'` session for the same (user, app) because the
     * uniqueness keys don't overlap.
     */
    async createWorkerAppToken(
        actor: Actor,
        appUid: string,
        workerName: string,
    ): Promise<string> {
        if (!actor.user) {
            throw new HttpError(403, 'Actor must be a user', {
                legacyCode: 'forbidden',
            });
        }
        if (!workerName) {
            throw new HttpError(400, 'Missing `workerName`', {
                legacyCode: 'bad_request',
            });
        }
        this.#assertAppDelegationAllowed(actor, appUid);
        const auth_id = this.#authIdFor(actor.user as UserRow);
        const session = await this.stores.session.getOrCreateWorker(
            actor.user.id,
            { appUid, workerName, auth_id },
        );
        if (!session) {
            throw new HttpError(500, 'Worker session create failed', {
                legacyCode: 'internal_error',
            });
        }

        return this.services.token.sign('auth', {
            type: 'app-under-user',
            version: '2',
            user_uid: actor.user.uuid,
            app_uid: appUid,
            session_uid: session.uuid,
            auth_id,
            worker: true,
            worker_name: workerName,
        });
    }

    #authIdFor(user: UserRow): string {
        return user.uuid;
    }

    /**
     * Scope app token delegation by actor kind. An app-under-user or
     * access-token actor is bound to a single app and may only mint a token
     * for that same app; only a root user session may request a token for an
     * arbitrary app (the GUI's app-launch delegation).
     */
    #assertAppDelegationAllowed(actor: Actor, appUid: string): void {
        if ((actor.app || actor.accessToken) && actor.app?.uid !== appUid) {
            throw new HttpError(
                403,
                'Actor cannot mint a token for another app',
                { legacyCode: 'forbidden' },
            );
        }
    }

    /**
     * Convert a jsonwebtoken-style `expiresIn` (seconds, or `'1h'`/`'30d'`)
     * into an absolute unix-seconds timestamp for the session row. Returns
     * `null` when no expiry is requested (caller passed `undefined`).
     * Mirrors `jsonwebtoken`'s allowed unit suffixes (s/m/h/d/w/y).
     */
    #hardExpiryFromExpiresIn(
        expiresIn: string | number | undefined,
    ): number | null {
        if (expiresIn === undefined) return null;
        const now = nowSeconds();
        if (typeof expiresIn === 'number') return now + Math.floor(expiresIn);
        const match = /^(\d+)\s*([smhdwy])?$/.exec(expiresIn.trim());
        if (!match) return null;
        const value = parseInt(match[1], 10);
        const unit = match[2] ?? 's';
        const multiplier: Record<string, number> = {
            s: 1,
            m: 60,
            h: 60 * 60,
            d: 24 * 60 * 60,
            w: 7 * 24 * 60 * 60,
            y: 365 * 24 * 60 * 60,
        };
        const seconds = value * (multiplier[unit] ?? 1);
        return now + seconds;
    }

    async removeSessionByToken(token: string): Promise<void> {
        // Try the signed path first. If verify fails (typically because
        // the JWT expired between authProbe and this logout call —
        // `req.token` was valid at probe time but the user took a while
        // before clicking logout), fall back to an *unverified* decode
        // (with the same decompression as the verified path) just to
        // recover the `session_uid` so the row still gets soft-revoked.
        // The recovered uuid is only used as a `revokeCascade` pointer;
        // a forged uuid (worst case for an unverified read) can't
        // escalate — `revokeCascade` is a no-op against unknown rows
        // and only flips `revoked_at` on existing ones.
        let decoded: AnyTokenPayload | null = null;
        try {
            decoded = this.services.token.verify<AnyTokenPayload>(
                'auth',
                token,
            );
        } catch {
            decoded = this.services.token.decodeWithoutVerify<AnyTokenPayload>(
                'auth',
                token,
            );
        }
        if (!decoded) return;
        if (decoded.type !== 'session' && decoded.type !== 'gui') return;
        const sessionPayload = decoded as SessionTokenPayload;
        const sessionUuid =
            (sessionPayload.session_uid as string | undefined) ??
            sessionPayload.uuid;
        if (!sessionUuid) return;
        await this.stores.session.revokeCascade(sessionUuid);
    }

    /**
     * List sessions surfaced to the manage-sessions UI. Excludes `asset`
     * rows (per-cookie children of `web` rows, revoked transitively via
     * cascade — surfacing them as standalone entries would be confusing).
     * App rows are joined to the apps table so the UI can render the
     * authorizing app's title and icon without a second round trip.
     */
    async listSessions(actor: Actor): Promise<Array<Record<string, unknown>>> {
        if (!actor.user?.id) return [];

        const rows = (await this.stores.session.getByUserId(
            actor.user.id,
        )) as Array<Record<string, unknown>>;

        const visible = rows.filter((row) => row.kind !== 'asset');

        const appUids = [
            ...new Set(
                visible
                    .map((row) => row.app_uid)
                    .filter(
                        (uid): uid is string =>
                            typeof uid === 'string' && uid.length > 0,
                    ),
            ),
        ];
        const apps = new Map<string, Record<string, unknown>>();
        await Promise.all(
            appUids.map(async (uid) => {
                try {
                    const app = await this.stores.app.getByUid(uid);
                    if (app) apps.set(uid, app);
                } catch {
                    // App lookup failures fall back to app_uid only.
                }
            }),
        );

        const enriched = visible.map((row) => {
            const meta =
                (typeof row.meta === 'string'
                    ? JSON.parse(row.meta as string)
                    : row.meta) ?? {};
            const isCurrent = actor.session?.uid === row.uuid;
            const appUid = typeof row.app_uid === 'string' ? row.app_uid : null;
            const app = appUid ? (apps.get(appUid) ?? null) : null;
            return {
                ...meta,
                uuid: row.uuid,
                kind: row.kind,
                current: isCurrent,
                label: row.label ?? null,
                parent_session_id: row.parent_session_id ?? null,
                created_at: row.created_at,
                last_activity: row.last_activity,
                expires_at: row.expires_at ?? null,
                last_ip: row.last_ip ?? null,
                last_user_agent: row.last_user_agent ?? null,
                created_via: row.created_via ?? null,
                app_uid: appUid,
                app: app
                    ? {
                          uid: app.uid,
                          name: app.name,
                          title: app.title,
                          icon: app.icon,
                      }
                    : null,
            };
        });

        // Sort: current session first, then most-recently-active. The
        // manage-sessions UI relies on this so the "you are here" row
        // anchors the top of the list.
        enriched.sort((a, b) => {
            if (a.current !== b.current) return a.current ? -1 : 1;
            const al = Number(a.last_activity ?? 0);
            const bl = Number(b.last_activity ?? 0);
            return bl - al;
        });

        return enriched;
    }

    /**
     * Revoke a session by uuid, cascading to any rows whose
     * `parent_session_id` points at it. Used by the manage-sessions UI
     * and by `removeSessionByToken` — semantics are identical.
     */
    async revokeSession(uuid: string): Promise<void> {
        await this.stores.session.revokeCascade(uuid);
    }

    /**
     * Rename a session's user-visible label. Throws 404 when the row
     * doesn't exist or belongs to another user — ownership is enforced
     * inside `SessionStore.setLabel` via the (uuid, user_id) WHERE
     * clause, so the 404 vs 403 distinction is collapsed (a user can't
     * tell from this endpoint whether a uuid exists under another
     * account).
     */
    async setSessionLabel(
        actor: Actor,
        uuid: string,
        label: string | null,
    ): Promise<void> {
        if (!actor.user) {
            throw new HttpError(403, 'Actor must be a user', {
                legacyCode: 'forbidden',
            });
        }
        const trimmed =
            typeof label === 'string' ? label.trim().slice(0, 64) : null;
        const ok = await this.stores.session.setLabel(
            uuid,
            actor.user.id as number,
            trimmed && trimmed.length > 0 ? trimmed : null,
        );
        if (!ok) {
            throw new HttpError(404, 'Session not found', {
                legacyCode: 'not_found',
            });
        }
    }

    /**
     * Admin-driven cascade: revoke EVERY session row for the given user
     * (web, app, access_token, asset, worker). No actor context — this
     * is the "suspension / forced sign-out" path, where workers
     * deliberately go too (a suspended user shouldn't keep long-lived
     * worker credentials calling back into the backend). Distinct from
     * `revokeAllSessions` which is the user-driven UI flow and exempts
     * workers + standalone access tokens by design.
     *
     * Iterates each top-level row through `revokeCascade` so derived
     * rows (asset under web, app-issued access tokens under their app
     * session) follow via the parent_session_id link.
     */
    async revokeAllSessionsForUserId(userId: number): Promise<void> {
        if (!userId) return;
        const rows = await this.stores.session.getByUserId(userId);
        for (const row of rows) {
            await this.stores.session.revokeCascade(row.uuid as string);
        }
    }

    /**
     * Password-reset cascade: revoke every interactive (web/app) session
     * for the user, so a hijacked session doesn't outlive a password
     * reset. No actor context — the recovery flow has no authenticated
     * caller. Leaves workers and standalone access tokens alone: those
     * are managed credentials rather than sign-ins, and a routine
     * forgot-password reset shouldn't break deployments.
     */
    async revokeInteractiveSessionsForUserId(userId: number): Promise<void> {
        if (!userId) return;
        const rows = await this.stores.session.getByUserId(userId);
        for (const row of rows) {
            if (row.kind === 'web' || row.kind === 'app') {
                await this.stores.session.revokeCascade(row.uuid as string);
            }
        }
    }

    async revokeAllSessions(
        actor: Actor,
        opts: { includeCurrent?: boolean; includeApps?: boolean } = {},
    ): Promise<void> {
        if (!actor.user) {
            throw new HttpError(403, 'Actor must be a user', {
                legacyCode: 'forbidden',
            });
        }
        const currentUuid = actor.session?.uid;
        const rows = await this.stores.session.getByUserId(
            actor.user.id as number,
        );
        for (const row of rows) {
            if (row.kind === 'web') {
                if (!opts.includeCurrent && row.uuid === currentUuid) continue;
                await this.stores.session.revokeCascade(row.uuid as string);
            } else if (row.kind === 'app' && opts.includeApps) {
                await this.stores.session.revokeCascade(row.uuid as string);
            }
        }
    }

    async migrateLegacyToken(
        v1Token: string,
        _ctx: { ip?: string; userAgent?: string } = {},
    ): Promise<{
        token: string;
        session_uid: string;
        auth_id: string;
        kind: 'access_token' | 'app';
    }> {
        // 1. Verify under v1 secret. `TokenService.verify` tags v1
        // results with `legacy: true`; anything else is either a v2
        // token (nothing to migrate) or invalid.
        let decoded: AnyTokenPayload;
        try {
            decoded = this.services.token.verify<AnyTokenPayload>(
                'auth',
                v1Token,
            );
        } catch {
            throw new HttpError(401, 'Invalid token', {
                legacyCode: 'token_invalid',
            });
        }
        if (!decoded.legacy) {
            throw new HttpError(401, 'Token is not v1', {
                legacyCode: 'token_invalid',
            });
        }
        if (!decoded.type) {
            throw new HttpError(401, 'Invalid token type', {
                legacyCode: 'token_invalid',
            });
        }

        // 2. Web tokens never migrate silently — they go through the
        // interactive reauth flow. The `code` field is what puter.js /
        // GUI clients key on; `legacyCode` keeps the body shape valid
        // for legacy error readers.
        if (decoded.type === 'session' || decoded.type === 'gui') {
            throw new HttpError(409, 'Reauthentication required', {
                legacyCode: 'unauthorized',
                code: 'reauth_required',
            });
        }

        // 3. Branch by kind.
        if (decoded.type === 'access-token') {
            return this.#migrateAccessToken(decoded as AccessTokenPayload);
        }
        if (decoded.type === 'app-under-user') {
            // App-token migration is the kind that ultimately retires
            // — flag-gated independently from the top-level
            // `allow_v1_tokens` so access-token migration can stay on
            // indefinitely.
            const allowAppMigration =
                (this.config as { allow_v1_app_migration?: boolean })
                    .allow_v1_app_migration !== false;
            if (!allowAppMigration) {
                throw new HttpError(410, 'App-token migration disabled', {
                    legacyCode: 'unauthorized',
                    code: 'app_migration_disabled',
                });
            }
            return this.#migrateAppToken(decoded as AppUnderUserTokenPayload);
        }

        throw new HttpError(401, 'Unsupported token type', {
            legacyCode: 'token_invalid',
        });
    }

    async #migrateAccessToken(decoded: AccessTokenPayload): Promise<{
        token: string;
        session_uid: string;
        auth_id: string;
        kind: 'access_token';
    }> {
        if (!decoded.token_uid || !decoded.user_uid) {
            throw new HttpError(401, 'Invalid token claims', {
                legacyCode: 'token_invalid',
            });
        }
        const user = (await this.stores.user.getByUuid(
            decoded.user_uid,
        )) as UserRow | null;
        if (!user) {
            throw new HttpError(401, 'User not found', {
                legacyCode: 'unauthorized',
            });
        }
        const auth_id = this.#authIdFor(user);

        // Per-auth_id rate limit — second axis beyond the route-level
        // per-IP limit. Catches an attacker who has both the token and
        // a rotating IP pool.
        await this.#enforceMigrateAuthIdLimit(auth_id);

        const session = await this.stores.session.findOrCreateLegacyAccessToken(
            decoded.token_uid,
            { userId: user.id, auth_id },
        );
        if (!session) {
            throw new HttpError(500, 'Session backfill failed', {
                legacyCode: 'internal_error',
            });
        }

        // Mint v2 access token. token_uid is preserved so the existing
        // `access_token_permissions` rows (keyed by token_uid) keep
        // applying — only the JWT envelope and session-row binding
        // change.
        const jwtPayload: Record<string, unknown> = {
            type: 'access-token',
            version: '2',
            token_uid: decoded.token_uid,
            user_uid: user.uuid,
            session_uid: session.uuid as string,
            auth_id,
        };
        if (decoded.app_uid) jwtPayload.app_uid = decoded.app_uid;
        const token = this.services.token.sign('auth', jwtPayload);

        return {
            token,
            session_uid: session.uuid as string,
            auth_id,
            kind: 'access_token',
        };
    }

    async #migrateAppToken(decoded: AppUnderUserTokenPayload): Promise<{
        token: string;
        session_uid: string;
        auth_id: string;
        kind: 'app';
    }> {
        if (!decoded.user_uid || !decoded.app_uid) {
            throw new HttpError(401, 'Invalid token claims', {
                legacyCode: 'token_invalid',
            });
        }
        const user = (await this.stores.user.getByUuid(
            decoded.user_uid,
        )) as UserRow | null;
        if (!user) {
            throw new HttpError(401, 'User not found', {
                legacyCode: 'unauthorized',
            });
        }
        const auth_id = this.#authIdFor(user);

        await this.#enforceMigrateAuthIdLimit(auth_id);

        // Idempotent on `(user_id, app_uid)` via the partial unique
        const session = await this.stores.session.getOrCreateApp(
            user.id,
            decoded.app_uid,
            { auth_id },
        );
        if (!session) {
            throw new HttpError(500, 'Session backfill failed', {
                legacyCode: 'internal_error',
            });
        }

        const jwtPayload: Record<string, unknown> = {
            type: 'app-under-user',
            version: '2',
            user_uid: user.uuid,
            app_uid: decoded.app_uid,
            session_uid: session.uuid as string,
            auth_id,
        };
        const token = this.services.token.sign('auth', jwtPayload);

        return {
            token,
            session_uid: session.uuid as string,
            auth_id,
            kind: 'app',
        };
    }

    /**
     * Per-`auth_id` rate limit for migrate-token. Keyed on the stable
     * v2 identity so an attacker rotating IPs but holding one user's
     * v1 token still hits a ceiling.
     */
    async #enforceMigrateAuthIdLimit(auth_id: string): Promise<void> {
        // 20 migrations per 15min per identity matches the per-IP
        // route limit — either axis trips first depending on the
        // attack shape. Generous enough that a healthy client (one
        // app open per device) never sees it.
        const ok = await checkRateLimit(
            `migrate-token-auth:${auth_id}`,
            20,
            15 * 60_000,
        );
        if (!ok) {
            throw new HttpError(429, 'Too many migration attempts', {
                legacyCode: 'too_many_requests',
                fields: { 'retry-after': 900 },
            });
        }
    }

    // -- App / origin resolution -------------------------------------

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
                legacyCode: 'bad_request',
            });
        }
        // Aliased hosts collapse to a single canonical representative so the
        // event listeners and the UUIDv5 fallback resolve to the same value
        // for every member of an alias group.
        const aliased = this.#canonicalizeAliasedOrigin(parsed) ?? parsed;
        const event = { origin: aliased };
        await this.clients.event?.emitAndWait('app.from-origin', event, {});

        const canonicalUid = await this.#findCanonicalAppUidForOrigin(
            event.origin,
        );
        if (canonicalUid) return canonicalUid;

        const uid = uuidv5(event.origin, APP_ORIGIN_UUID_NAMESPACE);
        return `app-${uid}`;
    }

    /**
     * Read `app_origin_aliases` from config and return normalized groups —
     * each group is a deduped list of lowercased, trimmed host strings.
     * Malformed entries are skipped silently so a bad config row doesn't
     * brick UID resolution for everyone else.
     */
    #getOriginAliasGroups(): string[][] {
        const config = this.config as { app_origin_aliases?: unknown };
        const raw = config.app_origin_aliases;
        if (!Array.isArray(raw)) return [];

        const groups: string[][] = [];
        for (const group of raw) {
            if (!Array.isArray(group)) continue;
            const normalized = [
                ...new Set(
                    group
                        .filter((h): h is string => typeof h === 'string')
                        .map((h) => h.trim().toLowerCase())
                        .filter((h) => h.length > 0),
                ),
            ];
            if (normalized.length > 0) groups.push(normalized);
        }
        return groups;
    }

    /**
     * Find the alias group containing `host` (case-insensitive). Returns the
     * normalized group, or null when no group claims this host.
     */
    #findOriginAliasGroup(host: string): string[] | null {
        const lower = host.trim().toLowerCase();
        if (!lower) return null;
        for (const group of this.#getOriginAliasGroups()) {
            if (group.includes(lower)) return group;
        }
        return null;
    }

    /**
     * If the origin's host belongs to an alias group, swap it for the group's
     * canonical representative (alphabetically first member — chosen for
     * order-independence so config reordering doesn't shift UUIDs). Returns
     * null when the host isn't in any group, so the caller keeps the original.
     */
    #canonicalizeAliasedOrigin(origin: string): string | null {
        let parsed: URL;
        try {
            parsed = new URL(origin);
        } catch {
            return null;
        }
        const hostRaw = parsed.host.toLowerCase();
        const hostStripped = parsed.hostname.toLowerCase();
        const group =
            this.#findOriginAliasGroup(hostRaw) ??
            this.#findOriginAliasGroup(hostStripped);
        if (!group) return null;

        const canonical = [...group].sort()[0];
        if (!canonical || canonical === hostRaw || canonical === hostStripped) {
            return null;
        }
        parsed.host = canonical;
        return parsed.toString();
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
        // Origin alias group expansion: every host listed alongside the
        // request's host in `app_origin_aliases` becomes a lookup candidate,
        // so any one of the group's hosts being registered as an `index_url`
        // resolves the whole group to that row's UID.
        const aliasGroup =
            this.#findOriginAliasGroup(hostRaw) ??
            this.#findOriginAliasGroup(hostStripped);
        if (aliasGroup) {
            for (const h of aliasGroup) hostCandidates.add(h);
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

    async getUserAppToken(actor: Actor, appUid: string): Promise<string> {
        if (!actor.user)
            throw new HttpError(403, 'Actor must be a user', {
                legacyCode: 'forbidden',
            });
        this.#assertAppDelegationAllowed(actor, appUid);

        // Request-context (IP / UA) isn't available on the Actor shape —
        // the app row's `last_ip` / `last_user_agent` start NULL and get
        // populated later via `SessionStore.touch` on the first verified
        // request that carries those headers.
        const appSession = await this.stores.session.getOrCreateApp(
            actor.user.id,
            appUid,
            { auth_id: this.#authIdFor(actor.user as UserRow) },
        );

        return this.services.token.sign('auth', {
            type: 'app-under-user',
            version: '2',
            user_uid: actor.user.uuid,
            app_uid: appUid,
            session_uid: appSession?.uuid,
            auth_id: this.#authIdFor(actor.user as UserRow),
        });
    }

    // -- Private / public hosted asset cookies -----------------------
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

    /**
     * Cookie name that carries the sticky private-asset token. Legacy
     * dot-style name kept readable through the v2 deprecation window —
     * `resolvePrivateIdentity` still reads it as a fallback.
     */
    getPrivateAssetCookieName(): string {
        return 'puter.private.asset.token';
    }

    /** Cookie name that carries the public hosted-actor token (legacy). */
    getPublicHostedActorCookieName(): string {
        return 'puter.public.hosted.actor.token';
    }

    /** v2 cookie name for the sticky private-asset token. */
    getPrivateAssetCookieNameV2(): string {
        return 'puter_private_asset_token_v2';
    }

    /** v2 cookie name for the public hosted-actor token. */
    getPublicHostedActorCookieNameV2(): string {
        return 'puter_public_hosted_actor_token_v2';
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

    async createPrivateAssetToken(claims: {
        appUid: string;
        userUid: string;
        sessionUuid?: string;
        subdomain?: string;
        privateHost?: string;
    }): Promise<string> {
        const { assetSessionUuid, authId } =
            await this.#mintAssetSessionContext(claims.sessionUuid);
        return this.services.token.sign('hosted-asset', {
            kind: 'private',
            version: '2',
            user_uid: claims.userUid,
            app_uid: claims.appUid,
            ...(assetSessionUuid
                ? { session_uuid: assetSessionUuid }
                : claims.sessionUuid
                  ? { session_uuid: claims.sessionUuid }
                  : {}),
            ...(authId ? { auth_id: authId } : {}),
            ...(claims.subdomain ? { subdomain: claims.subdomain } : {}),
            ...(claims.privateHost ? { host: claims.privateHost } : {}),
        });
    }

    async createPublicHostedActorToken(claims: {
        appUid: string;
        userUid: string;
        sessionUuid?: string;
        subdomain?: string;
        host?: string;
    }): Promise<string> {
        const { assetSessionUuid, authId } =
            await this.#mintAssetSessionContext(claims.sessionUuid);
        return this.services.token.sign('hosted-asset', {
            kind: 'public',
            version: '2',
            user_uid: claims.userUid,
            app_uid: claims.appUid,
            ...(assetSessionUuid
                ? { session_uuid: assetSessionUuid }
                : claims.sessionUuid
                  ? { session_uuid: claims.sessionUuid }
                  : {}),
            ...(authId ? { auth_id: authId } : {}),
            ...(claims.subdomain ? { subdomain: claims.subdomain } : {}),
            ...(claims.host ? { host: claims.host } : {}),
        });
    }

    /**
     * Materialize the `kind='asset'` session row that the cookie's
     * `session_uuid` claim points at. Parented to the web session so a
     * logout cascade kills every asset cookie minted under it. Both
     * fields are `null` only when the caller didn't supply a web session
     * at all — the cookie still mints unparented and without an
     * `auth_id` claim (matches v1 behavior for access-token-minted
     * cookies that aren't tied to an interactive session).
     *
     * If the caller DID supply a `webSessionUuid` but the lookup misses
     * (row revoked / expired between mint request and this lookup),
     * throw — otherwise we'd quietly emit an unparented "ghost" cookie
     * that has no revocation hook for 7 days. The extra check piggybacks
     * on the lookup we already had to do, so no added perf cost.
     */
    async #mintAssetSessionContext(
        webSessionUuid: string | undefined,
    ): Promise<{ assetSessionUuid: string | null; authId: string | null }> {
        if (!webSessionUuid) return { assetSessionUuid: null, authId: null };
        const webSession = await this.stores.session.getByUuid(webSessionUuid);
        if (!webSession) {
            throw new HttpError(401, 'session no longer valid', {
                legacyCode: 'session_required',
            });
        }
        const authId =
            ((webSession as SessionRow).auth_id as string | null) ?? null;
        const row = await this.stores.session.create(
            (webSession as SessionRow).user_id as number,
            {
                kind: 'asset',
                parent_session_id: webSessionUuid,
                expires_at: nowSeconds() + ASSET_WINDOW_SECONDS,
                auth_id: authId,
            },
        );
        return { assetSessionUuid: row.uuid, authId };
    }

    async verifyPrivateAssetToken(
        token: string,
        expected: {
            expectedAppUid?: string;
            expectedSubdomain?: string;
            expectedPrivateHost?: string;
        } = {},
    ): Promise<{
        userUid: string;
        sessionUuid?: string;
        appUid?: string;
        subdomain?: string;
        privateHost?: string;
        authId?: string;
        legacy?: boolean;
    }> {
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

        // Bind the cookie to the user's session lifetime: the session row
        // referenced at mint must still exist AND not be revoked. The
        // `getByUuid` lookup is already filtered on `revoked_at IS NULL`,
        // so a logout cascade transparently invalidates every asset
        // cookie minted under that web session. Cookies minted without
        // a session_uuid (e.g. from an access-token actor) skip the
        // check; nothing to bind.
        const sessionUuid = decoded.session_uuid as string | undefined;
        if (sessionUuid) {
            const session = await this.stores.session.getByUuid(sessionUuid);
            if (!session) {
                throw new HttpError(
                    401,
                    'private-asset token session no longer valid',
                    { legacyCode: 'session_required' },
                );
            }
        }

        return {
            userUid: decoded.user_uid as string,
            sessionUuid,
            appUid: decoded.app_uid as string | undefined,
            subdomain: decoded.subdomain as string | undefined,
            privateHost: decoded.host as string | undefined,
            authId: decoded.auth_id as string | undefined,
            legacy: decoded.legacy === true ? true : undefined,
        };
    }

    async verifyPublicHostedActorToken(
        token: string,
        expected: {
            expectedAppUid?: string;
            expectedSubdomain?: string;
            expectedHost?: string;
        } = {},
    ): Promise<{
        userUid: string;
        sessionUuid?: string;
        appUid?: string;
        subdomain?: string;
        host?: string;
        authId?: string;
        legacy?: boolean;
    }> {
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

        // Same revocation cascade as the private path: if the cookie was
        // minted under a now-revoked web session, drop it.
        const sessionUuid = decoded.session_uuid as string | undefined;
        if (sessionUuid) {
            const session = await this.stores.session.getByUuid(sessionUuid);
            if (!session) {
                throw new HttpError(
                    401,
                    'public hosted-actor token session no longer valid',
                    { legacyCode: 'session_required' },
                );
            }
        }

        return {
            userUid: decoded.user_uid as string,
            sessionUuid,
            appUid: decoded.app_uid as string | undefined,
            subdomain: decoded.subdomain as string | undefined,
            host: decoded.host as string | undefined,
            authId: decoded.auth_id as string | undefined,
            legacy: decoded.legacy === true ? true : undefined,
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
            throw new HttpError(
                401,
                `hosted-asset token is not ${expectedKind}`,
                { legacyCode: 'token_invalid' },
            );
        }
        if (typeof decoded.user_uid !== 'string' || !decoded.user_uid) {
            throw new HttpError(401, 'hosted-asset token missing user_uid', {
                legacyCode: 'token_invalid',
            });
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
            throw new HttpError(401, `hosted-asset token ${label} mismatch`, {
                legacyCode: 'token_invalid',
            });
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
            ...sessionCookieFlags(this.config),
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

    // -- Access tokens -----------------------------------------------

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
        // `expiresIn` follows jsonwebtoken's expiresIn semantics — either
        // a number of seconds (integer) or a duration string ('1h',
        // '30d'). `#hardExpiryFromExpiresIn` supports both, and existing
        // callers / tests pass the string form, so narrowing to `number`
        // here would force unsafe casts at every call site.
        options: { expiresIn?: string | number; label?: string | null } = {},
    ): Promise<string> {
        if (!actor.user)
            throw new HttpError(403, 'Actor must be a user', {
                legacyCode: 'forbidden',
            });
        if (actor.accessToken) {
            throw new HttpError(
                403,
                'Access tokens may not create access tokens',
                {
                    legacyCode: 'forbidden',
                },
            );
        }

        // Full-API-access sentinel: a token that may do anything its issuing
        // user can do via the API (resolved against the issuer at check time —
        // see PermissionService.#scanAccessToken). Only a plain user actor may
        // mint one; an app-under-user actor must not be able to escalate the
        // scoped access it was granted into blanket account-wide access.
        const wantsFullAccess = permissions.some(
            ([p]) => p === FULL_API_ACCESS,
        );
        if (wantsFullAccess && actor.app) {
            throw new HttpError(403, 'Apps may not mint full-access tokens', {
                legacyCode: 'forbidden',
            });
        }

        // Permission-subset enforcement: an access token can only carry
        // permissions the issuer itself holds. Without this, an
        // app-under-user actor (third-party app authorized by the user)
        // could mint a token claiming permissions it was never granted —
        // those grants live in `access_token_permissions` and are
        // returned verbatim at check-time, with no re-validation against
        // the authorizer. `checkMany` is one pipelined MGET against the
        // per-actor permission cache so the cost is small even for
        // many-permission mints. The full-access sentinel is excluded — it
        // isn't a real permission the issuer "holds"; its gate is the
        // user-actor check above.
        const requestedPerms = [
            ...new Set(
                permissions
                    .map(([p]) => p)
                    .filter(
                        (p): p is string =>
                            typeof p === 'string' &&
                            !!p &&
                            p !== FULL_API_ACCESS,
                    ),
            ),
        ];
        if (requestedPerms.length > 0) {
            const granted = await this.services.permission.checkMany(
                actor,
                requestedPerms,
            );
            const missing = requestedPerms.filter((p) => !granted.get(p));
            if (missing.length > 0) {
                throw new HttpError(
                    403,
                    `Issuer lacks permission(s): ${missing.join(', ')}`,
                    {
                        legacyCode: 'forbidden',
                        fields: { missing_permissions: missing },
                    },
                );
            }
        }

        const tokenUid = uuidv4();
        const auth_id = this.#authIdFor(actor.user as UserRow);

        // Access tokens carry a *hard* row-level expiry — no slide. If the
        // caller passed `expiresIn`, the row's `expires_at` matches the JWT
        // exp; otherwise both are absent (open-ended access tokens).
        const expiresAt = this.#hardExpiryFromExpiresIn(options.expiresIn);

        // App-issued access tokens parent to the issuing app's session row
        // so cascading the app authorization kills its scoped tokens. User-
        // issued tokens (no actor.app) stay top-level.
        const parent_session_id =
            actor.app && actor.session ? actor.session.uid : null;

        const tokenSession = await this.stores.session.create(
            actor.user.id as number,
            {
                kind: 'access_token',
                // User-facing name shown (and editable) in the manage-sessions
                // UI. Trimmed/clamped by the caller; null when unnamed.
                label: options.label ?? null,
                parent_session_id,
                expires_at: expiresAt,
                auth_id,
                // Stored on the session row so a raw-uuid revoke (caller has the
                // token_uid but no JWT) can reverse-find the row and flip
                // `revoked_at` — see `revokeAccessToken`.
                access_token_uid: tokenUid,
            },
        );

        const jwtPayload: Record<string, unknown> = {
            type: 'access-token',
            version: '2',
            token_uid: tokenUid,
            user_uid: actor.user.uuid,
            session_uid: tokenSession.uuid,
            auth_id,
        };
        if (actor.app) {
            jwtPayload.app_uid = actor.app.uid;
        }
        // Full-access is carried as a signed claim (not a stored permission
        // row): it's the single source of truth read at auth time into
        // `actor.accessToken.fullAccess`, which both `requireNonAccessTokenGate`
        // and the permission scan consult. The `actor.app` block above already
        // rejected app-issued full-access mints.
        if (wantsFullAccess) {
            jwtPayload.full_access = true;
        }

        // jsonwebtoken's SignOptions.expiresIn is typed as `number |
        // ${number}${unit}` (template literal), so a plain string can't
        // be statically proven safe. The runtime accepts the same range
        // of strings #hardExpiryFromExpiresIn parses ('1h', '30d'), so
        // the cast is faithful to actual behavior.
        const jwt = this.services.token.sign(
            'auth',
            jwtPayload,
            // Only `expiresIn` is a valid jsonwebtoken sign option; `label` is
            // ours (stored on the session row above), so don't forward it.
            options.expiresIn !== undefined
                ? { expiresIn: options.expiresIn as number }
                : {},
        );

        // Store each permission grant
        const db = this.stores.permission as unknown as {
            clients: {
                db: { write: (q: string, p: unknown[]) => Promise<void> };
            };
        };
        for (const spec of permissions) {
            const [permission, extra] = spec;
            // The full-access sentinel is not a real grant — it lives in the
            // signed `full_access` claim, not `access_token_permissions`.
            if (permission === FULL_API_ACCESS) continue;
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
        if (!actor.user)
            throw new HttpError(403, 'Actor must be a user', {
                legacyCode: 'forbidden',
            });

        let tokenUid: string;
        let issuerUuidFromJwt: string | undefined;
        let sessionUidFromJwt: string | undefined;
        const isJwt = /^[\w-]+\.[\w-]+\.[\w-]+$/.test(tokenOrUuid.trim());
        if (isJwt) {
            const decoded = this.services.token.verify<AccessTokenPayload>(
                'auth',
                tokenOrUuid,
            );
            if (decoded.type !== 'access-token' || !decoded.token_uid) {
                throw new HttpError(400, 'Invalid access token', {
                    legacyCode: 'token_invalid',
                });
            }
            tokenUid = decoded.token_uid;
            issuerUuidFromJwt = decoded.user_uid;
            sessionUidFromJwt = decoded.session_uid;
        } else {
            tokenUid = tokenOrUuid;
        }

        // A signature-verified JWT is itself proof of who issued the token —
        // the body's `user_uid` was set by createAccessToken at mint time.
        // For raw-uuid input we fall back to the persisted authorizer.
        if (issuerUuidFromJwt !== undefined) {
            if (issuerUuidFromJwt !== actor.user.uuid) {
                throw new HttpError(404, 'Access token not found', {
                    legacyCode: 'not_found',
                });
            }
        } else {
            const rows = (await this.clients.db.read(
                'SELECT `authorizer_user_id` FROM `access_token_permissions` WHERE `token_uid` = ? LIMIT 1',
                [tokenUid],
            )) as Array<{ authorizer_user_id?: number | null }>;
            const ownerId = rows[0]?.authorizer_user_id ?? null;
            if (ownerId === null || ownerId !== actor.user.id) {
                throw new HttpError(404, 'Access token not found', {
                    legacyCode: 'not_found',
                });
            }
        }

        // Permissions rows still DELETE — the "no DELETE on revoke"
        // rule scoped to the `sessions` table (where the audit trail of
        // when a session existed/was revoked is load-bearing for forensic
        // queries and the cascade graph). `access_token_permissions`
        // rows are the grant manifest for an *active* token; once its
        // session is soft-revoked, the grants are dead-weight cache
        // entries that would only confuse `checkMany`. If we later need
        // permission-grant history for audit, that becomes a
        // `revoked_at` column on this table, not a behavior change here.
        await this.clients.db.write(
            'DELETE FROM `access_token_permissions` WHERE `token_uid` = ?',
            [tokenUid],
        );
        await this.stores.permission.invalidateAccessTokenPerms(tokenUid);

        if (sessionUidFromJwt) {
            await this.stores.session.removeByUuid(sessionUidFromJwt);
        } else {
            const row =
                await this.stores.session.findActiveByAccessTokenUid(tokenUid);
            if (row) await this.stores.session.removeByUuid(row.uuid);
        }
    }

    // -- Internals ---------------------------------------------------

    #originFromUrl(url: string): string | null {
        try {
            const parsed = new URL(url);
            // A real web origin is always http(s). `new URL()` happily parses
            // `javascript:`, `data:`, `file:`, `vbscript:`, etc.; if one of
            // those slips through it ends up persisted as an app `index_url`
            // (see AppStore.createFromOrigin) and later loaded as `iframe.src`
            // — an XSS/code-execution primitive. Reject anything that isn't
            // http(s) so the bootstrap path matches AppDriver's validateUrl
            // allow-list.
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
                return null;
            }
            return `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ''}`;
        } catch {
            return null;
        }
    }

    async #actorFromSessionToken(
        decoded: SessionTokenPayload,
        ctx: { ip?: string; userAgent?: string } = {},
    ): Promise<AuthResult> {
        const user = await this.stores.user.getByUuid(decoded.user_uid);
        if (!user) return { invalid: true };
        const auth_id = this.#authIdFor(user as UserRow);

        // v2 tokens prefer `session_uid`; v1 only carries `uuid`. Both
        // store the web-session uuid.
        const sessionUuid = decoded.session_uid ?? decoded.uuid;

        const rawRow = sessionUuid
            ? ((await this.stores.session.getByUuidAny(
                  sessionUuid,
              )) as SessionRow | null)
            : null;

        if (rawRow?.revoked_at != null) {
            return { reauth: { reason: 'session_revoked', auth_id } };
        }
        if (rawRow?.expires_at != null && rawRow.expires_at <= nowSeconds()) {
            return { reauth: { reason: 'session_expired', auth_id } };
        }

        let session: SessionRow | null = rawRow;

        if (!session && decoded.legacy) {
            session = (await this.stores.session.findOrCreateLegacyWeb({
                userId: user.id,
                auth_id,
            })) as SessionRow | null;
        }

        if (!session) return { invalid: true };

        this.stores.session
            .touch({
                uuid: session.uuid,
                userId: user.id,
                ip: ctx.ip,
                userAgent: ctx.userAgent,
            })
            .catch(() => {});

        return { actor: this.#buildUserActor(user, session) };
    }

    async #actorFromAppUnderUserToken(
        decoded: AppUnderUserTokenPayload,
        ctx: { ip?: string; userAgent?: string } = {},
    ): Promise<AuthResult> {
        const user = await this.stores.user.getByUuid(decoded.user_uid);
        if (!user) return { invalid: true };
        const auth_id = this.#authIdFor(user as UserRow);

        const app = await this.stores.app.getByUid(decoded.app_uid);
        if (!app) return { invalid: true };

        let rawRow: SessionRow | null = null;
        if (decoded.session_uid) {
            rawRow = (await this.stores.session.getByUuidAny(
                decoded.session_uid,
            )) as SessionRow | null;
        }

        if (rawRow?.revoked_at != null) {
            return { reauth: { reason: 'session_revoked', auth_id } };
        }
        if (rawRow?.expires_at != null && rawRow.expires_at <= nowSeconds()) {
            return { reauth: { reason: 'session_expired', auth_id } };
        }

        let session: SessionRow | null = rawRow;

        // Legacy v1: lazy-backfill keyed on (user_id, app_uid).
        if (!session && decoded.legacy) {
            session = (await this.stores.session.getOrCreateApp(
                user.id,
                decoded.app_uid,
                { auth_id },
            )) as SessionRow | null;
        }

        if (!session && !decoded.legacy) return { invalid: true };

        if (!session && decoded.session) {
            session = (await this.stores.session.getByUuid(
                decoded.session,
            )) as SessionRow | null;
        }

        this.stores.session
            .touch({
                uuid: session?.uuid,
                userId: user.id,
                ip: ctx.ip,
                userAgent: ctx.userAgent,
            })
            .catch(() => {});

        return {
            actor: this.#buildAppUnderUserActor(user, app, session),
        };
    }

    async #actorFromAccessTokenToken(
        decoded: AccessTokenPayload,
        ctx: { ip?: string; userAgent?: string } = {},
    ): Promise<AuthResult> {
        if (!decoded.token_uid || !decoded.user_uid) return { invalid: true };

        const user = await this.stores.user.getByUuid(decoded.user_uid);
        if (!user) return { invalid: true };
        const auth_id = this.#authIdFor(user as UserRow);

        let session: SessionRow | null = null;
        if (decoded.session_uid) {
            const rawRow = (await this.stores.session.getByUuidAny(
                decoded.session_uid,
            )) as SessionRow | null;
            if (rawRow?.revoked_at != null) {
                return { reauth: { reason: 'session_revoked', auth_id } };
            }
            if (
                rawRow?.expires_at != null &&
                rawRow.expires_at <= nowSeconds()
            ) {
                return { reauth: { reason: 'session_expired', auth_id } };
            }
            if (!rawRow) return { invalid: true };
            session = rawRow;
        } else if (decoded.legacy) {
            session = (await this.stores.session.findOrCreateLegacyAccessToken(
                decoded.token_uid,
                { userId: user.id, auth_id },
            )) as SessionRow | null;
            // If backfill fails (DB write contention etc.) we don't
            // strand the legacy token — it falls through to the
            // permission-table path that v1 used.
        }

        let authorizer: Actor;
        if (decoded.app_uid) {
            const app = await this.stores.app.getByUid(decoded.app_uid);
            if (!app) return { invalid: true };
            authorizer = this.#buildAppUnderUserActor(user, app, null);
        } else {
            authorizer = this.#buildUserActor(user, null);
        }

        if (session) {
            this.stores.session
                .touch({
                    uuid: session.uuid,
                    userId: user.id,
                    ip: ctx.ip,
                    userAgent: ctx.userAgent,
                })
                .catch(() => {});
        }

        return {
            actor: {
                user: this.#actorUserFromRow(user),
                accessToken: {
                    uid: decoded.token_uid,
                    issuer: authorizer,
                    authorized: null,
                    // Honor the signed full-access claim only for user-issued
                    // tokens. App-issued tokens (`app_uid` present) can never be
                    // full-access — mirrors the mint-time block — so even a
                    // claim on one is ignored here.
                    fullAccess:
                        !decoded.app_uid && decoded.full_access === true,
                },
            },
        };
    }

    // -- Actor builders ----------------------------------------------

    #actorUserFromRow(user: UserRow) {
        // Strip the password hash; pass everything else through so callers
        // can read metadata, desktop_bg_*, otp_enabled, etc. without
        // re-fetching the user. Mirrors what /whoami exposes off of UserRow.
        const { password: _password, ...rest } = user;
        return {
            ...rest,
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
