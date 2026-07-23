import { fetchUrl } from '../../../lib/networkUtils.js';

// Keys the Puter GUI reads at boot. The first `get()` of any of them triggers
// a single batched driver call fetching all of them, so the desktop doesn't
// issue a dozen round-trips while it initializes.
const GUI_CACHE_KEYS = [
    'has_set_default_app_user_permissions',
    'window_sidebar_width',
    'sidebar_items',
    'menubar_style',
    'user_preferences.auto_arrange_desktop',
    'user_preferences.show_hidden_files',
    'user_preferences.language',
    'user_preferences.clock_visible',
    'toolbar_auto_hide_enabled',
    'has_seen_welcome_window',
    'desktop_item_positions',
    'desktop_icons_hidden',
    'taskbar_position',
    'has_seen_toolbar_animation',
];

// How long the resolved batch keeps serving reads before the cache disables
// itself and gets fall through to the network again.
const BATCH_LIFETIME_MS = 4000;

const createDeferred = () => {
    /** @type {(value?: unknown) => void} */
    let resolve = () => {};
    /** @type {(reason?: unknown) => void} */
    let reject = () => {};
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
};

/**
 * Boot-time read cache for the GUI's well-known keys. Lazy: nothing is
 * fetched until the first `lookup()` resolves the init deferred; every read
 * within the lifetime window is then served from the one batched response.
 */
export class GuiBootCache {
    /** @param {import('../../../../types/puter').Puter} puter */
    constructor (puter) {
        this.puter = puter;
        this.batch = createDeferred();
        this.init = createDeferred();
        (async () => {
            await this.init.promise;
            this.init = null;
            const resp = await fetchUrl(`${puter.APIOrigin}/drivers/call`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'text/plain;actually=json',
                },
                body: JSON.stringify({
                    interface: 'puter-kvstore',
                    method: 'get',
                    args: {
                        key: GUI_CACHE_KEYS,
                    },
                    auth_token: puter.authToken,
                }),
            });
            const values = await resp.json();
            const scheduleExpiry = () => {
                setTimeout(() => {
                    this.batch = null;
                }, BATCH_LIFETIME_MS);
            };
            if ( ! Array.isArray(values?.result) ) {
                this.batch.resolve({});
                scheduleExpiry();
                return;
            }
            const byKey = {};
            for ( let i = 0; i < GUI_CACHE_KEYS.length; i++ ) {
                byKey[GUI_CACHE_KEYS[i]] = values.result[i];
            }
            this.batch.resolve(byKey);
            scheduleExpiry();
        })();
    }

    /** True when `key` is a boot key this cache can still serve. */
    serves (key) {
        return typeof key === 'string' && GUI_CACHE_KEYS.includes(key) && this.batch !== null;
    }

    /**
     * @param {string} key
     * @returns {Promise<unknown>}
     */
    async lookup (key) {
        this.init && this.init.resolve();
        const cache = await this.batch.promise;
        return cache[key];
    }
}
