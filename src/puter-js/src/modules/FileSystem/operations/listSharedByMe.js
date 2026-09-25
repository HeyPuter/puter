import { defineOperation, firstDefined } from './scaffold.js';
import { toShare } from './shareUtil.js';

/** @typedef {import('../types.js').ListSharedByMeOptions} ListSharedByMeOptions */
/** @typedef {import('../types.js').SharePage} SharePage */

/**
 * Lists everything you have shared out, a page at a time — across every item,
 * without naming one. Includes invites nobody has claimed yet (`pending`),
 * and, for items you own, shares a delegate with `manage` access issued.
 *
 * `appUid` narrows to what one app issued in your name, or `'none'` for what
 * you shared yourself. An app is bound to its own grants either way.
 *
 * `cursor` comes back only while more pages remain, so iterate until it is
 * absent rather than comparing `items.length` to `limit` — a page can be short
 * once items the caller can no longer see are filtered out.
 *
 * @type {{
 *   (options?: ListSharedByMeOptions): Promise<SharePage>,
 *   (
 *     success?: (value: SharePage) => void,
 *     error?: (reason: unknown) => void,
 *   ): Promise<SharePage>,
 * }}
 */
const listSharedByMe = defineOperation({
    request (options) {
        const query = new URLSearchParams();
        if ( options.limit !== undefined ) query.set('limit', String(options.limit));
        if ( options.cursor !== undefined ) query.set('cursor', String(options.cursor));
        if ( options.appUid !== undefined ) query.set('appUid', String(options.appUid));
        if ( firstDefined(options, 'includeTotal', 'include_total') ) {
            query.set('includeTotal', 'true');
        }
        const suffix = query.toString();

        return {
            endpoint: `/share/shared-by-me${suffix ? `?${suffix}` : ''}`,
            method: 'get',
            transform: (/** @type {{ items?: Record<string, unknown>[], cursor?: string, total?: number }} */ response) => ({
                items: (response.items ?? []).map(toShare),
                ...(response.cursor === undefined ? {} : { cursor: response.cursor }),
                ...(response.total === undefined ? {} : { total: response.total }),
            }),
        };
    },
});

export default listSharedByMe;
