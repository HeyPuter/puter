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

// Express `Request` augmentations live in `core/http/expressAugmentation.ts`
// — auth-related fields (`actor`, `token`) are declared there alongside the
// other request-level fields populated by global middleware.

// -- Token payload shapes (after `TokenService.verify` decompression) --

/**
 * Base fields every auth token carries.
 *
 * `session_uid` and `auth_id` are present on v2 tokens (`kid: 'v2'`) and
 * absent on v1. `legacy: true` is set by `TokenService.verify` when a
 * token verified through the legacy-secret fallback; AuthService keys
 * the v1→v2 backfill and re-auth flows off this flag.
 */
interface TokenPayloadBase {
    version?: string;
    type: TokenType;
    /** v2: unified session-row binding (uuid of the `sessions` row). */
    session_uid?: string;
    /** v2: stable per-user identity that survives re-login */
    auth_id?: string;
    /** Set by TokenService when the token verified via the legacy secret. */
    legacy?: boolean;
}

export type TokenType = 'session' | 'gui' | 'app-under-user' | 'access-token';

/**
 * Session token — issued at login; represents a browser session.
 *
 * `type === 'session'` is the HTTP-only-cookie flavor; `'gui'` is the same
 * shape but served as a response body (e.g., QR login → client-visible
 * token). Both resolve to a `UserActor` with `accessToken: null`.
 */
export interface SessionTokenPayload extends TokenPayloadBase {
    type: 'session' | 'gui';
    /**
     * Session uuid. v1 tokens carry this as the only session reference;
     * v2 tokens carry the same value in both `uuid` and `session_uid`.
     */
    uuid: string;
    /** User uuid (plain). */
    user_uid: string;
}

/**
 * App-under-user token — issued to an app acting on behalf of a user.
 *
 * v1: `session` carries the web session uuid the app token was minted
 *     under.
 * v2: `session_uid` carries the app's *own* session row uuid (kind='app').
 *     The (web session, app) parenting is recorded on the row, not the JWT.
 */
export interface AppUnderUserTokenPayload extends TokenPayloadBase {
    type: 'app-under-user';
    user_uid: string;
    app_uid: string;
    /** v1: raw web-session uuid (optional). v2: unused. */
    session?: string;
}

/**
 * Access token — issued to a third-party / programmatic caller. Carries a
 * token uuid whose permissions are managed in `access_token_permissions`.
 */
export interface AccessTokenPayload extends TokenPayloadBase {
    type: 'access-token';
    token_uid: string;
    user_uid: string;
    app_uid?: string;
    /**
     * Full-API-access ("personal access token") marker. Only ever set on
     * user-issued tokens (never app-issued). Drives `actor.accessToken
     * .fullAccess` — see ActorAccessToken in core/actor.ts.
     */
    full_access?: boolean;
}

export type AnyTokenPayload =
    | SessionTokenPayload
    | AppUnderUserTokenPayload
    | AccessTokenPayload;

// -- Session row (from `sessions` table) ----------------------------

export interface SessionRow {
    id: number;
    uuid: string;
    user_id: number;
    meta?: Record<string, unknown> | string | null;
    created_at?: number | null;
    last_activity?: number | null;
    kind?: string | null;
    parent_session_id?: string | null;
    revoked_at?: number | null;
    expires_at?: number | null;
    app_uid?: string | null;
    legacy_token_uid?: string | null;
    created_via?: string | null;
    auth_id?: string | null;
}

export {};
