import { promptIfUpgradeRequired } from '../../../lib/upgradePrompt.js';
import getAbsolutePathForApp from '../utils/getAbsolutePathForApp.js';
import { defineOperation, firstDefined } from './scaffold.js';
import { invalidateShareCache, toShare, toShareItems, toShareRecipients } from './shareUtil.js';

// Why sharing with anyone with the link needs a plan, for the upgrade prompt.
const LINK_SHARE_SUBSCRIPTION_MESSAGE =
    'Sharing with anyone who has the link requires a subscription.';

/** @typedef {import('../types.js').ShareOptions} ShareOptions */
/** @typedef {import('../types.js').ShareMode} ShareMode */
/** @typedef {import('../types.js').ShareRecipient} ShareRecipient */
/** @typedef {import('../types.js').Share} Share */

/**
 * Gives another Puter user access to a file or directory. Relative paths
 * resolve against the app's root directory. `{ anyone: true }` opens the item
 * to anyone with the link instead: every signed-in account that names it.
 *
 * Resolves with one {@link Share} per recipient/item pair that succeeded. A
 * pair that fails — an unknown recipient, say — does not fail the others; its
 * error is reported on the rejected pair only when every pair failed.
 *
 * @type {{
 *   (options: ShareOptions): Promise<Share[]>,
 *   (
 *     path: string,
 *     recipient: ShareRecipient | ShareRecipient[],
 *     mode?: ShareMode,
 *     success?: (value: Share[]) => void,
 *     error?: (reason: unknown) => void,
 *   ): Promise<Share[]>,
 * }}
 */
const share = defineOperation({
    positional: ['path', 'recipient', 'mode'],
    request (options) {
        const recipients = toShareRecipients(
            firstDefined(options, 'recipient', 'recipients'),
        );
        const items = toShareItems(options, (path) => getAbsolutePathForApp(path));

        return {
            endpoint: '/share',
            body: {
                recipients,
                items,
                mode: options.mode ?? 'read',
            },
            transform: (/** @type {{ status: string, results: Record<string, unknown>[] }} */ response) => {
                const results = response.results ?? [];
                const ok = results.filter(
                    (r) => r.status === 'success' || r.status === 'pending',
                );
                if ( ok.length === 0 && results.length > 0 ) {
                    const first = results[0];
                    const error = {
                        message: String(first.message ?? 'Share failed'),
                        code: String(first.code ?? 'share_failed'),
                    };
                    // A plan gate refuses one pair, not the request, so it
                    // arrives as a 200 and the request path's prompt never
                    // sees it.
                    promptIfUpgradeRequired(error, {
                        method: 'puter.fs.share',
                        subscriptionMessage: LINK_SHARE_SUBSCRIPTION_MESSAGE,
                    });
                    throw error;
                }
                invalidateShareCache(items);
                return ok.map(toShare);
            },
        };
    },
});

export default share;
