import getAbsolutePathForApp from '../utils/getAbsolutePathForApp.js';
import { defineOperation, firstDefined } from './scaffold.js';
import { invalidateShareCache, toShareItems, toShareRecipients } from './shareUtil.js';

/** @typedef {import('../types.js').UnshareOptions} UnshareOptions */
/** @typedef {import('../types.js').ShareRecipient} ShareRecipient */

/**
 * Withdraws a user's access to a file or directory.
 *
 * The item's owner can withdraw any share of it, whoever granted it. Anyone
 * else can withdraw the shares they granted, or their own access — pass
 * yourself as the recipient to leave a share someone else gave you.
 *
 * Resolves with the number of grants actually removed, which is `0` when there
 * was nothing to withdraw. A recipient/item pair that is refused does not fail
 * the others; its error is reported on the rejected promise only when every
 * pair was refused.
 *
 * @type {{
 *   (options: UnshareOptions): Promise<{ revoked: number }>,
 *   (
 *     path: string,
 *     recipient: ShareRecipient,
 *     success?: (value: { revoked: number }) => void,
 *     error?: (reason: unknown) => void,
 *   ): Promise<{ revoked: number }>,
 * }}
 */
const unshare = defineOperation({
    positional: ['path', 'recipient'],
    request (options) {
        const items = toShareItems(options, (path) => getAbsolutePathForApp(path));
        return {
            endpoint: '/share/revoke',
            body: {
                recipients: toShareRecipients(
                    firstDefined(options, 'recipient', 'recipients'),
                ),
                items,
            },
            transform: (/** @type {{ revoked?: number, results?: Record<string, unknown>[] }} */ response) => {
                const results = response.results ?? [];
                if ( results.length > 0 && results.every((r) => r.status === 'error') ) {
                    const first = results[0];
                    throw {
                        message: String(first.message ?? 'Unshare failed'),
                        code: String(first.code ?? 'unshare_failed'),
                    };
                }
                const revoked = Number(response.revoked ?? 0);
                if ( revoked > 0 ) invalidateShareCache(items);
                return { revoked };
            },
        };
    },
});

export default unshare;
