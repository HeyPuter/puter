// The out-of-storage upgrade prompt, shared by every filesystem operation.
//
// Any operation that allocates bytes can be refused with 413
// `storage_limit_reached` — uploads, but also copies (a copy duplicates
// bytes) and the rest of the mutation surface. The refusal reaches the app
// as a rejection either way; this is the part that also tells the *user*,
// so an app that swallows the rejection doesn't read as "Puter stopped
// saving my files". Mirrors the credit flow: prompt AND reject, never
// prompt instead of rejecting.

import { showUsageLimitDialog } from '../../UsageLimitDialog.js';

/**
 * Whether a filesystem rejection means the account is out of storage.
 * Matches every shape the storage refusal arrives in: the structured
 * `code` from the API error body, the bare 413 status, and the legacy
 * batch endpoint's `NOT_ENOUGH_SPACE`.
 *
 * @param {unknown} error
 * @returns {boolean}
 */
export const isStorageLimitError = (error) => {
    if ( !error || typeof error !== 'object' ) return false;
    const e = /** @type {{ code?: unknown, status?: unknown }} */ (error);
    return e.code === 'storage_limit_reached'
        || e.code === 'NOT_ENOUGH_SPACE'
        || e.status === 413;
};

/**
 * Show the upgrade prompt when `error` is a storage refusal: the app's own
 * upgrade flow inside an app, the usage-limit dialog everywhere else (which
 * dedupes itself, so racing operations can't stack dialogs). The error is
 * not consumed — callers still reject with it.
 *
 * @param {unknown} error
 */
export const promptIfStorageLimitError = (error) => {
    if ( !isStorageLimitError(error) ) return;
    if ( puter.env === 'app' ) {
        puter.ui.requestUpgrade();
    } else {
        showUsageLimitDialog('Not enough storage space available.<br>Please upgrade to continue.');
    }
};
