// The upgrade prompt for refusals an upgrade would clear: no usage credit
// (402 `insufficient_funds`), a plan without the surface (402
// `subscription_required`), no storage (413 `storage_limit_reached`). Callers
// prompt AND reject, never prompt instead of rejecting.

import { showUsageLimitDialog } from '../modules/UsageLimitDialog.js';

/** @typedef {import('./types.js').UpgradeReason} UpgradeReason */
/** @typedef {import('./types.js').UpgradePromptContext} UpgradePromptContext */

/**
 * The shapes a refusal arrives in: route error body, driver envelope, bare
 * status, stream line metadata, legacy batch `NOT_ENOUGH_SPACE`.
 *
 * @typedef {{
 *   code?: unknown,
 *   status?: unknown,
 *   message?: unknown,
 *   error?: { code?: unknown, status?: unknown, message?: unknown } | string,
 *   metadata?: { usage_limited?: unknown },
 * }} RefusalShape
 */

const TITLES = {
    funds: 'Low Balance',
    subscription: 'Subscription Required',
    storage: 'Out of Storage',
};

const FUNDS_MESSAGE = 'Your account does not have enough funding to complete this request.';
const STORAGE_MESSAGE = 'Not enough storage space available.';
const SUBSCRIPTION_FALLBACK_MESSAGE = 'This action requires a subscription.';

/**
 * Which upgrade a rejection is asking for, or `null` when it isn't one. A
 * bare 402 with no recognised code reads as funding, as every 402 did before
 * plan gates existed.
 *
 * @param {unknown} error
 * @returns {UpgradeReason | null}
 */
export const classifyUpgradeRefusal = (error) => {
    if ( ! error || typeof error !== 'object' ) return null;
    const e = /** @type {RefusalShape} */ (error);
    const nested = typeof e.error === 'object' && e.error !== null ? e.error : {};
    const codes = [e.code, nested.code];
    const statuses = [e.status, nested.status];

    if ( codes.includes('subscription_required') ) return 'subscription';
    if (
        codes.includes('storage_limit_reached')
        || codes.includes('NOT_ENOUGH_SPACE')
        || statuses.includes(413)
    ) return 'storage';
    if (
        codes.includes('insufficient_funds')
        || statuses.includes(402)
        || e.metadata?.usage_limited === true
    ) return 'funds';
    return null;
};

/**
 * @param {RefusalShape} e
 * @returns {string | undefined} The backend's explanation, when it sent one.
 */
const backendMessage = (e) => {
    const nested = typeof e.error === 'object' && e.error !== null ? e.error.message : e.error;
    const candidate = [e.message, nested].find(
        (m) => typeof m === 'string' && m.trim() !== '',
    );
    return typeof candidate === 'string' ? candidate.trim() : undefined;
};

/** @param {string} sentence */
const withPeriod = (sentence) => (/[.!?]$/.test(sentence) ? sentence : `${sentence}.`);

/**
 * One sentence saying what was refused. For a plan gate: the SDK method's own
 * wording, then the backend's message, then a generic line.
 *
 * @param {UpgradeReason} reason
 * @param {RefusalShape} error
 * @param {UpgradePromptContext} context
 * @returns {string}
 */
const messageFor = (reason, error, context) => {
    if ( reason === 'funds' ) return FUNDS_MESSAGE;
    if ( reason === 'storage' ) return STORAGE_MESSAGE;
    if ( context.subscriptionMessage ) return context.subscriptionMessage;
    const fromBackend = backendMessage(error);
    return fromBackend ? withPeriod(fromBackend) : SUBSCRIPTION_FALLBACK_MESSAGE;
};

/**
 * Show the upgrade prompt when `error` is a refusal an upgrade would clear.
 * Inside an app the desktop's upgrade flow is asked for (and not awaited: it
 * never answers). The SDK's own dialog covers storage refusals everywhere
 * else - the desktop leans on it for those - and funding / plan refusals on
 * third-party sites only. The error is not consumed; callers still reject.
 *
 * @param {unknown} error The rejection, in whatever shape it arrived.
 * @param {UpgradePromptContext} [context] Which SDK method was refused and,
 *   for a plan gate, why it needs one.
 * @param {{ env?: string, ui?: { requestUpgrade: Function } }} [puter] The SDK
 *   instance the call ran against; defaults to the global one.
 */
export const promptIfUpgradeRequired = (error, context = {}, puter = globalThis.puter) => {
    const reason = classifyUpgradeRefusal(error);
    if ( ! reason ) return;

    const message = messageFor(reason, /** @type {RefusalShape} */ (error), context);
    const { method } = context;

    if ( puter?.env === 'app' ) {
        puter.ui.requestUpgrade({ reason, method, message });
    } else if ( puter?.env === 'web' || reason === 'storage' ) {
        showUsageLimitDialog(message, { title: TITLES[reason], method });
    }
};
