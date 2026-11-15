// Both workers carry generated copies: run tools/pushWorkerNames.mjs after edits.

export const PUSH_DB_NAME = 'puter-push';
export const HANDLERS_STORE = 'handlers';
export const CLICKS_STORE = 'clicks';

// Handlers-store keys no channel can take, so the database stays at version 1.
export const OPT_IN_PREFIX = 'puter:opt-in:';
export const SERVER_KEY_ENTRY = 'puter:server-key';
/** Every key the server named as Puter's, the current one first. */
export const SERVER_KEYS_ENTRY = 'puter:server-keys';
/** Per user: `{ endpoint, at }` of the subscription the server last confirmed. */
export const SYNCED_PREFIX = 'puter:synced:';
/** Per worker scope: set by a worker when a subscription is replaced. */
export const SUBSCRIPTION_CHANGED_PREFIX = 'puter:subscription-changed:';
/** Per worker scope: `{ endpoint, receipt }` the server last gave. */
export const RECEIPT_PREFIX = 'puter:receipt:';
/** Where a tap without a URL goes, per worker scope. */
export const TAP_BASE_PREFIX = 'puter:tap-base:';
/** What a worker posts when the browser replaced the push subscription. */
export const SUBSCRIPTION_CHANGED_MESSAGE = 'puter-push-subscription-changed';
