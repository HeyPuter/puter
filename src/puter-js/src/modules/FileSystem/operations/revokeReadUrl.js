import { defineOperation } from './scaffold.js';

const JWT_PATTERN = /^[\w-]+\.[\w-]+\.[\w-]+$/;

/**
 * The JWT from the URL `getReadURL()` returns (`?token=<jwt>`), or a bare JWT.
 *
 * @param {string} value
 * @returns {string | undefined}
 */
const extractToken = (value) => {
    const trimmed = value.trim();
    if ( JWT_PATTERN.test(trimmed) ) return trimmed;

    try {
        const fromQuery = new URL(trimmed, 'https://placeholder.invalid').searchParams.get('token');
        if ( fromQuery && JWT_PATTERN.test(fromQuery) ) return fromQuery;
    } catch {
        // Not a parseable URL either; extraction has failed.
    }

    return undefined;
};

/**
 * Revokes a read URL created by `getReadURL()`, given that URL or its token.
 * An app can revoke only URLs it created; the account's own session or API
 * token can revoke any of its read URLs. Revoking an already revoked or
 * expired URL resolves.
 *
 * @type {(urlOrToken: string) => Promise<void>}
 */
const revokeReadURL = defineOperation({
    positional: ['tokenOrUuid'],
    request (options) {
        const raw = options.tokenOrUuid;
        const value = typeof raw === 'string' ? raw : String(raw ?? '');
        if ( value.trim() === '' ) {
            throw {
                message: 'revokeReadURL() needs the URL that getReadURL() returned.',
                code: 'field_missing',
            };
        }
        const token = extractToken(value);
        if ( token === undefined ) {
            throw {
                message: 'revokeReadURL() needs the URL or token that getReadURL() returned.',
                code: 'field_invalid',
            };
        }

        return {
            endpoint: '/auth/revoke-own-access-token',
            body: { token },
            transform: () => undefined,
        };
    },
});

export default revokeReadURL;
