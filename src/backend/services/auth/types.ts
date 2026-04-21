// Express `Request` augmentations live in `core/http/expressAugmentation.ts`
// — auth-related fields (`actor`, `token`) are declared there alongside the
// other request-level fields populated by global middleware.

// ── Token payload shapes (after `TokenService.verify` decompression) ──

/** Base fields every non-legacy auth token carries. */
interface TokenPayloadBase {
    version?: string;
    type: TokenType;
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
    /** Session uuid (plain, not FPE-encrypted for session tokens). */
    uuid: string;
    /** User uuid (plain). */
    user_uid: string;
}

/**
 * App-under-user token — issued to an app acting on behalf of a user.
 *
 * `session`, when present, is the raw session uuid (no encryption). The token
 * is bound to that session, so user logout invalidates it. App tokens minted
 * outside an interactive session context (e.g., from an access-token actor)
 * omit the field entirely.
 */
export interface AppUnderUserTokenPayload extends TokenPayloadBase {
    type: 'app-under-user';
    user_uid: string;
    app_uid: string;
    /** Raw session uuid (optional — some app tokens have no session). */
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
}

export type AnyTokenPayload =
    | SessionTokenPayload
    | AppUnderUserTokenPayload
    | AccessTokenPayload;

// ── Session row (from `sessions` table) ────────────────────────────

export interface SessionRow {
    id: number;
    uuid: string;
    user_id: number;
    meta?: Record<string, unknown> | string | null;
    created_at?: number | null;
    last_activity?: number | null;
}

export {};
