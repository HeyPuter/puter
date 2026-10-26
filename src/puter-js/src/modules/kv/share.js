import { isObject } from './lib/args.js';
import { assertUsernameRecipient, sharesRequest } from './lib/shares.js';

/** @typedef {import('./types.js').KVShare} KVShare */
/** @typedef {import('./types.js').KVShareAccess} KVShareAccess */
/** @typedef {import('./types.js').KVShareOptions} KVShareOptions */
/** @typedef {import('./types.js').KVShareRecipient} KVShareRecipient */

/**
 * @overload
 * @param {string} prefix
 * @param {KVShareRecipient} recipient
 * @param {KVShareAccess} [access]
 * @returns {Promise<KVShare>}
 */
/**
 * @overload
 * @param {KVShareOptions} options
 * @returns {Promise<KVShare>}
 */
/**
 * Shares the keys under a prefix with another user, at `read` access unless
 * `access` says otherwise. Sharing the same prefix with the same user again
 * changes the level or label in place and keeps the handle.
 *
 * @this {import('./index.js').KVModule}
 * @param {string | KVShareOptions} prefixOrOptions
 * @param {KVShareRecipient} [recipient]
 * @param {KVShareAccess} [access]
 * @returns {Promise<KVShare>}
 */
export async function share (prefixOrOptions, recipient, access) {
    const options = isObject(prefixOrOptions)
        ? /** @type {KVShareOptions} */ (prefixOrOptions)
        : { prefix: /** @type {string} */ (prefixOrOptions), recipient, access };

    return await sharesRequest(this.puter, 'POST', '/kv/shares', {
        body: {
            prefix: options.prefix,
            recipient: assertUsernameRecipient(options.recipient),
            ...(options.access !== undefined ? { access: options.access } : {}),
            ...(options.label !== undefined ? { label: options.label } : {}),
            ...(options.appUuid !== undefined ? { appUid: options.appUuid } : {}),
        },
    });
}
