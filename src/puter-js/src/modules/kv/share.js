import { isObject } from './lib/args.js';
import { assertUsernameRecipient, sharesRequest } from './lib/shares.js';

/** @typedef {import('./types.js').KVShare} KVShare */
/** @typedef {import('./types.js').KVShareAccess} KVShareAccess */
/** @typedef {import('./types.js').KVShareOptions} KVShareOptions */
/** @typedef {import('./types.js').KVShareRecipient} KVShareRecipient */
/** @typedef {import('./types.js').KVShareManyOptions} KVShareManyOptions */
/** @typedef {import('./types.js').KVShareManyItem} KVShareManyItem */

/**
 * @overload
 * @param {string} prefix
 * @param {KVShareRecipient} recipient
 * @param {KVShareAccess} [access]
 * @returns {Promise<KVShare>}
 */
/**
 * @overload
 * @param {string} prefix
 * @param {KVShareRecipient[]} recipients
 * @param {KVShareAccess} [access]
 * @returns {Promise<KVShareManyItem[]>}
 */
/**
 * @overload
 * @param {KVShareOptions} options
 * @returns {Promise<KVShare>}
 */
/**
 * @overload
 * @param {KVShareManyOptions} options
 * @returns {Promise<KVShareManyItem[]>}
 */
/**
 * Shares the keys under a prefix with another user, at `read` access unless
 * `access` says otherwise. Sharing the same prefix with the same user again
 * changes the level, label or `notify` in place and keeps the handle. An array of
 * recipients shares with each of them and resolves to one item per recipient,
 * in order, each a share or an `error`.
 *
 * @this {import('./index.js').KVModule}
 * @param {string | KVShareOptions | KVShareManyOptions} prefixOrOptions
 * @param {KVShareRecipient | KVShareRecipient[]} [recipient]
 * @param {KVShareAccess} [access]
 * @returns {Promise<KVShare | KVShareManyItem[]>}
 */
export async function share (prefixOrOptions, recipient, access) {
    /** @type {Partial<KVShareOptions & KVShareManyOptions>} */
    const options = isObject(prefixOrOptions)
        ? /** @type {KVShareOptions | KVShareManyOptions} */ (prefixOrOptions)
        : Array.isArray(recipient)
            ? { prefix: /** @type {string} */ (prefixOrOptions), recipients: recipient, access }
            : { prefix: /** @type {string} */ (prefixOrOptions), recipient, access };

    const body = {
        prefix: options.prefix,
        ...(options.access !== undefined ? { access: options.access } : {}),
        ...(options.label !== undefined ? { label: options.label } : {}),
        ...(options.notify !== undefined ? { notify: options.notify } : {}),
        ...(options.appUuid !== undefined ? { appUid: options.appUuid } : {}),
    };
    // Each recipient of a batch is checked by the server and reported on its
    // own item, so one bad entry doesn't fail the others.
    if ( options.recipients !== undefined ) {
        const { items } = await sharesRequest(this.puter, 'POST', '/kv/shares', {
            body: { ...body, recipients: options.recipients },
        });
        return items;
    }
    return await sharesRequest(this.puter, 'POST', '/kv/shares', {
        body: { ...body, recipient: assertUsernameRecipient(options.recipient) },
    });
}
