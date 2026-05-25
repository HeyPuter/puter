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
import {
    ASSET_WINDOW_SECONDS,
    WEB_WINDOW_SECONDS,
} from '../../stores/session/SessionStore.js';
import type { UserRow } from '../../stores/user/UserStore';
import type { LayerInstances } from '../../types';
import { sessionCookieFlags } from '../../util/cookieFlags.js';
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

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

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
    ): string {
        return this.services.token.sign('auth', {
            type,
            version: '2',
            // `uuid` retained alongside `session_uid` so any legacy reader
            // (e.g. middleware that hasn't been updated to v2 claims yet)
            // still finds the session id where it expects.
            uuid: sessionUuid,
            session_uid: sessionUuid,
            user_uid: user.uuid,
            auth_id: authId,
        });
    }

    /**
     * Stable per-user identity carried on every v2 token (PUT-1010). Survives
     * re-login so the login endpoint can re-attach a new session to the same
     * underlying account — critical for temp users whose files are keyed off
     * the account that owns them.
     *
     * For normal users this is `user.uuid` (already stable). Temp-user
     * dedicated ids are PUT-1016's territory; until then, the uuid is fine
     * because temp re-login swaps the row but keeps the uuid.
     */
    #authIdFor(user: UserRow): string {
        return user.uuid;
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

    /**
     * Remove the session referenced by a session/GUI JWT. Cascades to
     * derived rows (asset cookies parented to this web session) so
     * logout transitively kills every cookie minted under the session.
     * App authorizations are top-level (no parent) and survive logout
     * per the PUT-1010 hierarchy.
     */
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
        const sessionPayload = decoded as SessionTokenPayload;
        const sessionUuid =
            (sessionPayload.session_uid as string | undefined) ??
            sessionPayload.uuid;
        await this.stores.session.revokeCascade(sessionUuid);
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

    /**
     * Revoke a session by uuid, cascading to any rows whose
     * `parent_session_id` points at it. Used by the manage-sessions UI
     * and by `removeSessionByToken` — semantics are identical.
     */
    async revokeSession(uuid: string): Promise<void> {
        await this.stores.session.revokeCascade(uuid);
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

    /**
     * Sign an app-under-user token for the given app UID. Idempotent per
     * `(user.id, appUid)` — repeat opens of the same app reuse the existing
     * `kind='app'` session row rather than minting a fresh one. The row is
     * top-level (no `parent_session_id`) so signing out of the web session
     * doesn't kill the app authorization (PUT-1010 hierarchy).
     */
    async getUserAppToken(actor: Actor, appUid: string): Promise<string> {
        if (!actor.user)
            throw new HttpError(403, 'Actor must be a user', {
                legacyCode: 'forbidden',
            });

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

    async createPrivateAssetToken(claims: {
        appUid: string;
        userUid: string;
        sessionUuid?: string;
        subdomain?: string;
        privateHost?: string;
    }): Promise<string> {
        const assetSessionUuid = await this.#mintAssetSessionUuid(
            claims.sessionUuid,
        );
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
        const assetSessionUuid = await this.#mintAssetSessionUuid(
            claims.sessionUuid,
        );
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
            ...(claims.subdomain ? { subdomain: claims.subdomain } : {}),
            ...(claims.host ? { host: claims.host } : {}),
        });
    }

    /**
     * Materialize the `kind='asset'` session row that the cookie's
     * `session_uuid` claim points at. Parented to the web session so a
     * logout cascade kills every asset cookie minted under it. Returns
     * `null` when the caller didn't supply a web session — the cookie
     * still mints, but unparented (matches v1 behavior for access-token-
     * minted cookies that aren't tied to an interactive session).
     */
    async #mintAssetSessionUuid(
        webSessionUuid: string | undefined,
    ): Promise<string | null> {
        if (!webSessionUuid) return null;
        const webSession = await this.stores.session.getByUuid(webSessionUuid);
        if (!webSession) return null;
        const row = await this.stores.session.create(
            (webSession as SessionRow).user_id as number,
            {
                kind: 'asset',
                parent_session_id: webSessionUuid,
                expires_at: nowSeconds() + ASSET_WINDOW_SECONDS,
                auth_id:
                    ((webSession as SessionRow).auth_id as string | null) ??
                    null,
            },
        );
        return row.uuid;
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
        // referenced at mint must still exist. Logging out drops the row,
        // which transitively invalidates every private-app cookie issued
        // under that session — matching v1's `expectedSessionUuid` check
        // (private apps only; public hosted-actor cookies stay informational).
        // Cookies minted without a session_uuid (e.g. from an access-token
        // actor) skip this check; nothing to bind.
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
                parent_session_id,
                expires_at: expiresAt,
                auth_id,
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

        await this.clients.db.write(
            'DELETE FROM `access_token_permissions` WHERE `token_uid` = ?',
            [tokenUid],
        );
        await this.stores.permission.invalidateAccessTokenPerms(tokenUid);

        // v2 access tokens carry a session row whose `revoked_at` is the
        // authoritative kill switch — flip it so a stolen token can't
        // resurrect by re-grabbing the deleted permissions. v1 tokens
        // (or raw-uuid input where the JWT wasn't presented) have no
        // session uuid here; AUTH-5 owns the full back-fill revoke flow.
        if (sessionUidFromJwt) {
            await this.stores.session.removeByUuid(sessionUidFromJwt);
        }
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
        const user = await this.stores.user.getByUuid(decoded.user_uid);
        if (!user) return null;

        // v2 tokens prefer `session_uid`; v1 only carries `uuid`. Both
        // store the web-session uuid.
        const sessionUuid = decoded.session_uid ?? decoded.uuid;

        let session: SessionRow | null = sessionUuid
            ? ((await this.stores.session.getByUuid(
                  sessionUuid,
              )) as SessionRow | null)
            : null;

        // Legacy v1 tokens whose row never existed (or whose row was
        // pre-PUT-1013) get lazy-backfilled so revoke works during the
        // migration window. AUTH-4 will still emit `reauth_required`
        // for these, but until then the session validates.
        if (!session && decoded.legacy) {
            session = (await this.stores.session.findOrCreateLegacyWeb({
                userId: user.id,
                auth_id: this.#authIdFor(user as UserRow),
            })) as SessionRow | null;
        }

        if (!session) return null;

        this.stores.session
            .touch({ uuid: session.uuid, userId: user.id })
            .catch(() => {});

        return this.#buildUserActor(user, session);
    }

    async #actorFromAppUnderUserToken(
        decoded: AppUnderUserTokenPayload,
    ): Promise<Actor | null> {
        const user = await this.stores.user.getByUuid(decoded.user_uid);
        if (!user) return null;

        const app = await this.stores.app.getByUid(decoded.app_uid);
        if (!app) return null;

        // v2 tokens point at the app's own `kind='app'` session row via
        // `session_uid`. v1 tokens (or v2 tokens minted before this
        // landed) get lazy-backfilled to the same idempotent row keyed
        // on (user_id, app_uid). For decoded.legacy we always backfill;
        // for decoded.session_uid we trust the row reference.
        let session: SessionRow | null = null;
        if (decoded.session_uid) {
            session = (await this.stores.session.getByUuid(
                decoded.session_uid,
            )) as SessionRow | null;
        }
        if (!session && decoded.legacy) {
            session = (await this.stores.session.getOrCreateApp(
                user.id,
                decoded.app_uid,
                { auth_id: this.#authIdFor(user as UserRow) },
            )) as SessionRow | null;
        }

        // v2 tokens whose session_uid is missing/revoked are rejected
        // outright — the row is the authoritative kill switch.
        if (!session && !decoded.legacy) return null;

        // Pre-v2 fallback: v1 tokens that carried `decoded.session`
        // (raw web-session uuid). Best-effort — if the row doesn't
        // resolve we still proceed so old puter-js builds without the
        // re-login patch don't strand users. AUTH-4 owns the migration
        // pressure.
        if (!session && decoded.session) {
            session = (await this.stores.session.getByUuid(
                decoded.session,
            )) as SessionRow | null;
        }

        this.stores.session
            .touch({ uuid: session?.uuid, userId: user.id })
            .catch(() => {});

        return this.#buildAppUnderUserActor(user, app, session);
    }

    async #actorFromAccessTokenToken(
        decoded: AccessTokenPayload,
    ): Promise<Actor | null> {
        if (!decoded.token_uid || !decoded.user_uid) return null;

        const user = await this.stores.user.getByUuid(decoded.user_uid);
        if (!user) return null;

        // v2 access tokens carry their session row uuid as `session_uid`
        // and the row is the kill switch — reject if missing/revoked.
        // v1 tokens lazy-backfill keyed on `token_uid` so revoke works
        // during the migration window.
        let session: SessionRow | null = null;
        if (decoded.session_uid) {
            session = (await this.stores.session.getByUuid(
                decoded.session_uid,
            )) as SessionRow | null;
            if (!session) return null;
        } else if (decoded.legacy) {
            session = (await this.stores.session.findOrCreateLegacyAccessToken(
                decoded.token_uid,
                {
                    userId: user.id,
                    auth_id: this.#authIdFor(user as UserRow),
                },
            )) as SessionRow | null;
            // If backfill fails (DB write contention etc.) we don't
            // strand the legacy token — it falls through to the
            // permission-table path that v1 used.
        }
        // Otherwise: v2 token without `session_uid` shouldn't happen
        // (the mint path always emits it), but if a malformed token
        // reaches here we let it through with no session binding —
        // the access_token_permissions table is the v1 contract.

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

        if (session) {
            this.stores.session
                .touch({ uuid: session.uuid, userId: user.id })
                .catch(() => {});
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
