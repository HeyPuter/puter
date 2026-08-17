import getAbsolutePathForApp from '../utils/getAbsolutePathForApp.js';
import { defineOperation } from './scaffold.js';
import { toShare } from './shareUtil.js';

/** @typedef {import('../types.js').GetSharesOptions} GetSharesOptions */
/** @typedef {import('../types.js').Share} Share */

/**
 * Lists who can reach a file or directory you can manage.
 *
 * Includes shares granted by anyone holding `manage` on the item, not only
 * your own — which is how an owner sees what a delegate has re-shared.
 *
 * @type {{
 *   (options: GetSharesOptions): Promise<Share[]>,
 *   (
 *     path: string,
 *     success?: (value: Share[]) => void,
 *     error?: (reason: unknown) => void,
 *   ): Promise<Share[]>,
 * }}
 */
const getShares = defineOperation({
    positional: ['path'],
    request (options) {
        const query = new URLSearchParams();
        if ( options.uid !== undefined ) {
            query.set('uid', String(options.uid));
        } else {
            query.set('path', getAbsolutePathForApp(String(options.path)));
        }

        return {
            endpoint: `/share/shares?${query.toString()}`,
            method: 'get',
            transform: (/** @type {{ items?: Record<string, unknown>[] }} */ response) =>
                (response.items ?? []).map(toShare),
        };
    },
});

export default getShares;
