/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify it under the
 * terms of the GNU Affero General Public License as published by the Free
 * Software Foundation, either version 3 of the License, or (at your option) any
 * later version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
 * FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License for more
 * details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see
 * [https://www.gnu.org/licenses/](https://www.gnu.org/licenses/).
 */

// Express `Request` augmentations live in `core/http/expressAugmentation.ts`
// — auth-related fields (`actor`, `token`) are declared there alongside the
// other request-level fields populated by global middleware.

// -- Token payload shapes (after `TokenService.verify` decompression) --

/**
 * Base fields every auth token carries. Only v2 tokens (`kid: 'v2'`) verify, so
 * `session_uid` and `auth_id` are always present on a payload that got here.
 */
interface TokenPayloadBase {
    version?: string;
    type: TokenType;
    /** Unified session-row binding (uuid of the `sessions` row). */
    session_uid?: string;
    /** Stable per-user identity that survives re-login. */
    auth_id?: string;
}

export type TokenType = 'session' | 'gui' | 'app-under-user' | 'access-token';

/**
 * Browser session token. `'session'` is the HTTP-only-cookie flavor, `'gui'`
 * the same shape served in a response body (e.g. QR login).
 */
export interface SessionTokenPayload extends TokenPayloadBase {
    type: 'session' | 'gui';
    /** Session uuid; v2 tokens carry the same value in `session_uid`. */
    uuid: string;
    /** User uuid (plain). */
    user_uid: string;
}

/**
 * Issued to an app acting for a user. v2 tokens carry the app's own session row
 * in `session_uid`; the parent web session is recorded on the row.
 */
export interface AppUnderUserTokenPayload extends TokenPayloadBase {
    type: 'app-under-user';
    user_uid: string;
    app_uid: string;
    /** V1: raw web-session uuid (optional). v2: unused. */
    session?: string;
}

/**
 * Access token — issued to a third-party / programmatic caller. Carries a token
 * uuid whose permissions are managed in `access_token_permissions`.
 */
export interface AccessTokenPayload extends TokenPayloadBase {
    type: 'access-token';
    token_uid: string;
    user_uid: string;
    app_uid?: string;
    /**
     * Personal access token marker; user-issued only. Drives
     * `ActorAccessToken.fullAccess`.
     */
    full_access?: boolean;
}

export type AnyTokenPayload =
    SessionTokenPayload | AppUnderUserTokenPayload | AccessTokenPayload;

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
