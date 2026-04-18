import jwt, { type SignOptions } from 'jsonwebtoken';
import { PuterService } from '../types';

// ── Compression tables ──────────────────────────────────────────────
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
    for ( const k in o ) {
        const v = o[k];
        fullkey_to_info[k] = typeof v === 'string' ? { short: v } : v;
    }
    const short_to_fullkey = Object.keys(fullkey_to_info).reduce<Record<string, string>>((acc, key) => {
        const short = fullkey_to_info[key].short;
        if ( short ) acc[short] = key;
        return acc;
    }, {});
    return { fullkey_to_info, short_to_fullkey };
};

const defv = (o: Record<string, string>): { to_short: Record<string, string>; to_long: Record<string, string> } => {
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
        if ( prefix ) {
            if ( ! v.startsWith(prefix) ) {
                throw new Error(`Expected ${prefix} prefix`);
            }
            v = v.slice(prefix.length);
        }
        const undecorated = v.replace(/-/g, '');
        return Buffer.from(undecorated, 'hex').toString('base64');
    },
    decode: (v: string): string => {
        // Already a uuid string → passthrough (for tokens minted pre-compression)
        if ( v.includes('-') ) return v;
        const undecorated = Buffer.from(v, 'base64').toString('hex');
        return (prefix ?? '') + [
            undecorated.slice(0, 8),
            undecorated.slice(8, 12),
            undecorated.slice(12, 16),
            undecorated.slice(16, 20),
            undecorated.slice(20),
        ].join('-');
    },
});

const AUTH_COMPRESSION = def({
    uuid: { short: 'u', ...uuidCompression() },
    session: { short: 's', ...uuidCompression() },
    version: 'v',
    type: {
        short: 't',
        values: defv({
            'session': 's',
            'access-token': 't',
            'app-under-user': 'au',
        }),
    },
    user_uid: { short: 'uu', ...uuidCompression() },
    app_uid: { short: 'au', ...uuidCompression('app-') },
});

const COMPRESSION: Record<string, CompressionContext> = {
    auth: AUTH_COMPRESSION,
};

// ── TokenService ────────────────────────────────────────────────────

/**
 * Signs and verifies JWTs.
 *
 * Kept intentionally small — no session lifecycle, no revocation list, no
 * cookie shaping. That logic lives in `AuthService` (actor resolution) and
 * will live in a future session controller (mint/rotate/revoke).
 */
export class TokenService extends PuterService {
    #secret: string = '';

    override onServerStart (): void {
        const secret = this.config.jwt_secret;
        if ( ! secret ) {
            throw new Error('TokenService requires `jwt_secret` in config');
        }
        this.#secret = secret;
    }

    /**
     * Sign a payload for the given scope. The compression table for `scope`
     * is applied to the payload before signing, so what reaches the wire is
     * the short-key form.
     */
    sign (scope: string, payload: Record<string, unknown>, options?: SignOptions): string {
        const context = COMPRESSION[scope];
        const compressed = this.#compressPayload(context, payload);
        return jwt.sign(compressed, this.#secret, options ?? {});
    }

    /**
     * Verify and decompress. Throws on invalid signature / expired / malformed
     * (propagating `jsonwebtoken`'s errors). Callers in the auth probe should
     * catch and treat as "no actor".
     */
    verify<T = Record<string, unknown>> (scope: string, token: string): T {
        const context = COMPRESSION[scope];
        const payload = jwt.verify(token, this.#secret) as Record<string, unknown>;
        return this.#decompressPayload(context, payload) as unknown as T;
    }

    // ── Internals ───────────────────────────────────────────────────

    #compressPayload (context: CompressionContext | undefined, payload: Record<string, unknown>): Record<string, unknown> {
        if ( ! context ) return payload;
        const { fullkey_to_info } = context;
        const out: Record<string, unknown> = {};
        for ( const fullkey in payload ) {
            const info = fullkey_to_info[fullkey];
            if ( ! info ) {
                out[fullkey] = payload[fullkey];
                continue;
            }
            let k = fullkey;
            let v = payload[fullkey];
            if ( info.short ) k = info.short;
            if ( info.values && typeof v === 'string' && info.values.to_short[v] !== undefined ) {
                v = info.values.to_short[v];
            } else if ( info.encode && typeof v === 'string' ) {
                v = info.encode(v);
            }
            out[k] = v;
        }
        return out;
    }

    #decompressPayload (context: CompressionContext | undefined, payload: Record<string, unknown>): Record<string, unknown> {
        if ( ! context ) return payload;
        const { fullkey_to_info, short_to_fullkey } = context;
        const out: Record<string, unknown> = {};
        for ( const short in payload ) {
            const fullkey = short_to_fullkey[short];
            if ( ! fullkey ) {
                out[short] = payload[short];
                continue;
            }
            const info = fullkey_to_info[fullkey];
            let k = short;
            let v = payload[short];
            if ( info.short ) k = fullkey;
            if ( info.values && typeof v === 'string' && info.values.to_long[v] !== undefined ) {
                v = info.values.to_long[v];
            } else if ( info.decode && typeof v === 'string' ) {
                v = info.decode(v);
            }
            out[k] = v;
        }
        return out;
    }
}
