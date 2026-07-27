import { defineOperation } from './scaffold.js';

/**
 * Revokes a read URL (or the access token / token UUID used by it).
 * After revocation, the URL will no longer allow reading the file.
 *
 * @type {(urlOrTokenOrUuid: string) => Promise<void>}
 */
const revokeReadURL = defineOperation({
    positional: ['tokenOrUuid'],
    request (options) {
        const tokenOrUuid = options.tokenOrUuid;

        return {
            endpoint: '/auth/revoke-access-token',
            body: {
                tokenOrUuid: typeof tokenOrUuid === 'string' ? tokenOrUuid.trim() : String(tokenOrUuid),
            },
            transform: () => undefined,
        };
    },
});

export default revokeReadURL;
