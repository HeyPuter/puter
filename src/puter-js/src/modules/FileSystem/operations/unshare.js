import getAbsolutePathForApp from '../utils/getAbsolutePathForApp.js';
import { defineOperation, firstDefined } from './scaffold.js';
import { invalidateShareCache, toShareItems, toShareRecipients } from './shareUtil.js';

/** @typedef {import('../types.js').UnshareOptions} UnshareOptions */
/** @typedef {import('../types.js').ShareRecipient} ShareRecipient */
/** @typedef {import('../types.js').UnshareResult} UnshareResult */
/** @typedef {import('../types.js').UnshareFailure} UnshareFailure */
/** @typedef {import('../types.js').UnshareError} UnshareError */

// The recipient or the item is gone: nothing to withdraw.
const GONE_CODES = ['user_does_not_exist', 'subject_does_not_exist'];
const UNNAMED_CODE = 'unshare_failed';

/**
 * @param {Record<string, unknown>} result a refused pair as the server reports it
 * @returns {UnshareFailure}
 */
const toFailure = (result) => ({
    recipient: String(result.recipient ?? ''),
    ...(result.path ? { path: String(result.path) } : {}),
    ...(result.uid ? { uid: String(result.uid) } : {}),
    message: String(result.message ?? 'Unshare failed'),
    code: String(result.code ?? UNNAMED_CODE),
});

/**
 * Withdraws a user's access to a file or directory.
 *
 * The item's owner can withdraw any share of it, whoever granted it. Anyone
 * else can withdraw the shares they granted, or their own access — pass
 * yourself as the recipient to leave a share someone else gave you.
 *
 * Resolves with the number of grants actually removed, which is `0` when there
 * was nothing to withdraw, and the recipient/item pairs that were refused. A
 * refused pair does not fail the others. The promise rejects only when every
 * pair was refused and at least one for a reason other than the recipient or
 * the item being gone; that rejection is an `UnshareError`.
 *
 * @type {{
 *   (options: UnshareOptions): Promise<UnshareResult>,
 *   (
 *     path: string,
 *     recipient: ShareRecipient,
 *     success?: (value: UnshareResult) => void,
 *     error?: (reason: unknown) => void,
 *   ): Promise<UnshareResult>,
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
                const failed = results.filter((r) => r.status === 'error').map(toFailure);
                const refusals = failed.filter((f) => ! GONE_CODES.includes(f.code));
                if ( results.length > 0 && failed.length === results.length && refusals.length > 0 ) {
                    // A pair the server could not complete names no code.
                    const { message, code } =
                        refusals.find((f) => f.code !== UNNAMED_CODE) ?? refusals[0];
                    throw /** @type {UnshareError} */ ({ message, code, failed });
                }
                const revoked = Number(response.revoked ?? 0);
                if ( revoked > 0 ) invalidateShareCache(items);
                return { revoked, failed };
            },
        };
    },
});

export default unshare;
