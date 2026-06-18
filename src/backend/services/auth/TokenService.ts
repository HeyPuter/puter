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

import jwt, { type SignOptions } from 'jsonwebtoken';
import { PuterService } from '../types';

// Clock-skew tolerance for `iat` / `exp` checks. 30s matches the
// design-doc allowance and absorbs ordinary NTP drift between nodes
// without papering over a genuinely-expired token.
const CLOCK_TOLERANCE_SECONDS = 30;

// -- Compression tables ----------------------------------------------
//
// Token payloads are compressed on the wire: full field names become
// short aliases, enum values become single-letter codes, and UUIDs get
// base64-packed (no dashes, no `-` padding).
//
// This keeps tokens small enough to fit in cookies / query strings.
// The `short` aliases and value codes are part of the wire contract —
// existing tokens depend on them, do not change without a migration.

interface FieldInfo {
    short?: string;
    values?: {
        to_short: Record<string, string>;
        to_long: Record<string, string>;
    };
    encode?: (v: string) => string;
    decode?: (v: string) => string;
}

type FieldInfoShorthand = string | FieldInfo;

interface CompressionContext {
    fullkey_to_info: Record<string, FieldInfo>;
    short_to_fullkey: Record<string, string>;
}

const def = (o: Record<string, FieldInfoShorthand>): CompressionContext => {
    const fullkey_to_info: Record<string, FieldInfo> = {};
    for (const k in o) {
        const v = o[k];
        fullkey_to_info[k] = typeof v === 'string' ? { short: v } : v;
    }
    const short_to_fullkey = Object.keys(fullkey_to_info).reduce<
        Record<string, string>
    >((acc, key) => {
        const short = fullkey_to_info[key].short;
        if (short) acc[short] = key;
        return acc;
    }, {});
    return { fullkey_to_info, short_to_fullkey };
};

const defv = (
    o: Record<string, string>,
): { to_short: Record<string, string>; to_long: Record<string, string> } => {
    return {
        to_short: o,
        to_long: Object.keys(o).reduce<Record<string, string>>((acc, key) => {
            acc[o[key]] = key;
            return acc;
        }, {}),
    };
};

/**
 * UUIDs on the wire: strip dashes, hex→base64. Optional prefix is stripped
 * before encoding and re-added on decode (e.g., `app-<uuid>`).
 */
const uuidCompression = (prefix?: string) => ({
    encode: (v: string): string => {
        if (prefix) {
            if (!v.startsWith(prefix)) {
                throw new Error(`Expected ${prefix} prefix`);
            }
            v = v.slice(prefix.length);
        }
        const undecorated = v.replace(/-/g, '');
        return Buffer.from(undecorated, 'hex').toString('base64');
    },
    decode: (v: string): string => {
        // Already a uuid string → passthrough (for tokens minted pre-compression)
        if (v.includes('-')) return v;
        const undecorated = Buffer.from(v, 'base64').toString('hex');
        return (
            (prefix ?? '') +
            [
                undecorated.slice(0, 8),
                undecorated.slice(8, 12),
                undecorated.slice(12, 16),
                undecorated.slice(16, 20),
                undecorated.slice(20),
            ].join('-')
        );
    },
});

const AUTH_COMPRESSION = def({
    uuid: { short: 'u', ...uuidCompression() },
    // v1 per-type field on app-under-user. v2 uses `session_uid` instead.
    session: { short: 's', ...uuidCompression() },
    version: 'v',
    type: {
        short: 't',
        values: defv({
            session: 's',
            'access-token': 't',
            'app-under-user': 'au',
        }),
    },
    user_uid: { short: 'uu', ...uuidCompression() },
    app_uid: { short: 'au', ...uuidCompression('app-') },
    // v2 unified session-row binding — present on every v2 token kind.
    session_uid: { short: 'su', ...uuidCompression() },
    // v2 stable per-user identity that survives re-login
    auth_id: { short: 'ai', ...uuidCompression() },
});

// `hosted-asset` scope signs the sticky cookies set after a visitor
// passes the private/public-app access gate (see AuthService
// createPrivateAssetToken / createPublicHostedActorToken). Keeping it
// in its own scope prevents a cookie from ever being honored as a main
// auth token.
const HOSTED_ASSET_COMPRESSION = def({
    version: 'v',
    kind: {
        short: 'k',
        values: defv({
            private: 'pr',
            public: 'pu',
        }),
    },
    user_uid: { short: 'uu', ...uuidCompression() },
    app_uid: { short: 'au', ...uuidCompression('app-') },
    session_uuid: { short: 's', ...uuidCompression() },
    // Mirrors the `auth_id` claim on `auth`-scope tokens — stable
    // per-user identity that survives re-login. Lets a reauth flow
    // re-mint an asset cookie tied to the same identity.
    auth_id: { short: 'ai', ...uuidCompression() },
    subdomain: 'sd',
    host: 'h',
});

const COMPRESSION: Record<string, CompressionContext> = {
    auth: AUTH_COMPRESSION,
    'hosted-asset': HOSTED_ASSET_COMPRESSION,
};

/**
 * Thrown by `verify()` when a v1 token is presented while
 * `auth.allow_v1_tokens=false`. Carries the **unverified** payload so
 * the auth probe can mint a `reauth_required` response with an
 * `auth_id` hint — the hint is advisory only (never trusted as
 * identity), so reading it from an unsigned payload is safe.
 */
export class V1TokensDisabledError extends Error {
    constructor(public readonly payload: Record<string, unknown>) {
        super('v1 tokens are disabled');
        this.name = 'V1TokensDisabledError';
    }
}

// -- TokenService ----------------------------------------------------

// The exact secret values shipped in config.default.json. Matched exactly
// (not by substring) so the boot guard refuses only these known-insecure
// defaults and never a legitimate operator secret that happens to contain
// "change-me".
const SHIPPED_PLACEHOLDER_SECRETS = new Set([
    'dev-jwt-secret-change-me',
    'dev-jwt-secret-v2-change-me',
    'dev-url-signature-secret-change-me',
]);

export class TokenService extends PuterService {
    #secretV2: string = '';
    #secretLegacy: string = '';
    #allowV1Tokens = true;

    override onServerStart(): void {
        const secretV2 = this.config.jwt_secret_v2;
        if (!secretV2) {
            throw new Error(
                'TokenService requires `jwt_secret_v2` in config — v2 signing cannot proceed without it',
            );
        }
        // The dev placeholders ship in config.default.json (a public repo) and
        // survive a deep-merge when an override config omits them — anyone who
        // knows the placeholder can forge with that secret. For the JWT secrets
        // that means forging a session token for any user; for
        // `url_signature_secret` it means forging file read/write capability
        // URLs for any file uid. Refuse to boot a non-dev deployment on any
        // placeholder secret. (`url_signature_secret` is guarded here, with the
        // other shipped placeholder secrets, even though it's consumed
        // elsewhere — this is the one hook guaranteed to run before any request.)
        if (this.config.env !== 'dev') {
            for (const [name, value] of [
                ['jwt_secret_v2', secretV2],
                ['jwt_secret', this.config.jwt_secret ?? ''],
                [
                    'url_signature_secret',
                    this.config.url_signature_secret ?? '',
                ],
            ] as const) {
                if (SHIPPED_PLACEHOLDER_SECRETS.has(value)) {
                    throw new Error(
                        `\`${name}\` is still the dev placeholder from config.default.json; ` +
                            'set a real secret before running with env != "dev"',
                    );
                }
            }
        }
        this.#secretV2 = secretV2;
        // Legacy secret is optional in fresh installs (no v1 tokens to verify),
        // but every existing deployment carries one. Don't fail boot if it's
        // missing — instead, refuse to verify v1 tokens later.
        this.#secretLegacy = this.config.jwt_secret ?? '';
        this.#allowV1Tokens = this.config.allow_v1_tokens !== false;
    }

    /**
     * Sign a payload for the given scope. Always emits v2 — the JWT header
     * carries `kid: 'v2'` so the verifier can route to the right secret.
     * Compression for `scope` is applied to the payload before signing.
     */
    sign(
        scope: string,
        payload: Record<string, unknown>,
        options?: SignOptions,
    ): string {
        const context = COMPRESSION[scope];
        const compressed = this.#compressPayload(context, payload);
        return jwt.sign(compressed, this.#secretV2, {
            ...(options ?? {}),
            // `keyid` is the SignOption name; it surfaces in the JWT header
            // as `kid`. Caller-supplied options can't override this — `kid`
            // is the routing discriminant.
            keyid: 'v2',
        });
    }

    /**
     * Verify and decompress. Routes by header `kid`:
     *   - `kid === 'v2'` → verify against the v2 secret.
     *   - else → verify against the legacy secret and tag the result with
     *     `legacy: true`. Rejected outright if `allow_v1_tokens=false`.
     *
     * Throws on invalid signature / expired / malformed (propagates
     * `jsonwebtoken`'s errors). Callers in the auth probe should catch and
     * treat as "no actor".
     */
    verify<T = Record<string, unknown>>(scope: string, token: string): T {
        const context = COMPRESSION[scope];
        const decoded = jwt.decode(token, { complete: true });
        const kid =
            typeof decoded === 'object' && decoded
                ? (decoded.header?.kid ?? null)
                : null;

        if (kid === 'v2') {
            const payload = jwt.verify(token, this.#secretV2, {
                clockTolerance: CLOCK_TOLERANCE_SECONDS,
                // Secrets are symmetric; never accept asymmetric algs here.
                algorithms: ['HS256'],
            }) as Record<string, unknown>;
            return this.#decompressPayload(context, payload) as unknown as T;
        }

        // Legacy / unsigned-kid path.
        if (!this.#allowV1Tokens) {
            // Surface a structured error so the auth probe can route to a
            // `reauth_required` response (with an `auth_id` hint) instead
            // of a bare 401 that strands the user. Decompress the
            // *unverified* payload — the hint is advisory, never trusted
            // as identity.
            const rawPayload =
                decoded &&
                typeof decoded === 'object' &&
                decoded.payload &&
                typeof decoded.payload === 'object'
                    ? (decoded.payload as Record<string, unknown>)
                    : {};
            const hint = this.#decompressPayload(context, rawPayload);
            throw new V1TokensDisabledError(hint);
        }
        if (!this.#secretLegacy) {
            throw new Error(
                'v1 token presented but no legacy `jwt_secret` configured',
            );
        }
        const payload = jwt.verify(token, this.#secretLegacy, {
            clockTolerance: CLOCK_TOLERANCE_SECONDS,
            algorithms: ['HS256'],
        }) as Record<string, unknown>;
        const decompressed = this.#decompressPayload(
            context,
            payload,
        ) as Record<string, unknown>;
        // `legacy: true` lets AuthService run the v1-token migration paths
        // (lazy session backfill, re-auth signal for web sessions).
        decompressed.legacy = true;
        return decompressed as unknown as T;
    }

    /**
     * Decode + decompress *without* verifying the signature. Returns
     * `null` for malformed tokens. Use **only** for paths that need to
     * recover advisory hints from an expired / unsignable token (e.g.,
     * the logout path that wants to revoke a session row even if the
     * JWT has expired since the user opened the tab). The result is
     * never trusted as identity — only as a pointer for cleanup
     * operations the caller would otherwise authorize via a different
     * channel.
     */
    decodeWithoutVerify<T = Record<string, unknown>>(
        scope: string,
        token: string,
    ): T | null {
        const context = COMPRESSION[scope];
        const decoded = jwt.decode(token);
        if (!decoded || typeof decoded !== 'object') return null;
        return this.#decompressPayload(
            context,
            decoded as Record<string, unknown>,
        ) as unknown as T;
    }

    // -- Internals ---------------------------------------------------

    #compressPayload(
        context: CompressionContext | undefined,
        payload: Record<string, unknown>,
    ): Record<string, unknown> {
        if (!context) return payload;
        const { fullkey_to_info } = context;
        const out: Record<string, unknown> = {};
        for (const fullkey in payload) {
            const info = fullkey_to_info[fullkey];
            if (!info) {
                out[fullkey] = payload[fullkey];
                continue;
            }
            let k = fullkey;
            let v = payload[fullkey];
            if (info.short) k = info.short;
            if (
                info.values &&
                typeof v === 'string' &&
                info.values.to_short[v] !== undefined
            ) {
                v = info.values.to_short[v];
            } else if (info.encode && typeof v === 'string') {
                v = info.encode(v);
            }
            out[k] = v;
        }
        return out;
    }

    #decompressPayload(
        context: CompressionContext | undefined,
        payload: Record<string, unknown>,
    ): Record<string, unknown> {
        if (!context) return payload;
        const { fullkey_to_info, short_to_fullkey } = context;
        const out: Record<string, unknown> = {};
        for (const short in payload) {
            const fullkey = short_to_fullkey[short];
            if (!fullkey) {
                out[short] = payload[short];
                continue;
            }
            const info = fullkey_to_info[fullkey];
            let k = short;
            let v = payload[short];
            if (info.short) k = fullkey;
            if (
                info.values &&
                typeof v === 'string' &&
                info.values.to_long[v] !== undefined
            ) {
                v = info.values.to_long[v];
            } else if (info.decode && typeof v === 'string') {
                v = info.decode(v);
            }
            out[k] = v;
        }
        return out;
    }
}
