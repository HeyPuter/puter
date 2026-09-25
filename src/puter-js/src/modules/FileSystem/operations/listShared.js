import { defineOperation, firstDefined } from './scaffold.js';
import { toShare } from './shareUtil.js';

/** @typedef {import('../types.js').ListSharedOptions} ListSharedOptions */
/** @typedef {import('../types.js').SharePage} SharePage */

/**
 * Lists what other users have shared with you, a page at a time.
 *
 * `cursor` comes back only while more pages remain, so iterate until it is
 * absent rather than comparing `items.length` to `limit` — a page can be short
 * once items the caller can no longer see are filtered out.
 *
 * @type {{
 *   (options?: ListSharedOptions): Promise<SharePage>,
 *   (
 *     success?: (value: SharePage) => void,
 *     error?: (reason: unknown) => void,
 *   ): Promise<SharePage>,
 * }}
 */
const listShared = defineOperation({
    request (options) {
        const query = new URLSearchParams();
        if ( options.limit !== undefined ) query.set('limit', String(options.limit));
        if ( options.cursor !== undefined ) query.set('cursor', String(options.cursor));
        if ( firstDefined(options, 'includeTotal', 'include_total') ) {
            query.set('includeTotal', 'true');
        }
        const suffix = query.toString();

        return {
            endpoint: `/share/shared-with-me${suffix ? `?${suffix}` : ''}`,
            method: 'get',
            transform: (/** @type {{ items?: Record<string, unknown>[], cursor?: string, total?: number }} */ response) => ({
                items: (response.items ?? []).map(toShare),
                ...(response.cursor === undefined ? {} : { cursor: response.cursor }),
                ...(response.total === undefined ? {} : { total: response.total }),
            }),
        };
    },
});

export default listShared;
