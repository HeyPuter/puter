import { driverCallEnvelope } from '../../../lib/networkUtils.js';

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
 * Boot-time read cache for the GUI's well-known keys, active only when the SDK
 * runs as the GUI. Lazy: nothing is fetched until the first `lookup()`
 * resolves the init deferred; every read within the lifetime window is then
 * served from the one batched response, except for keys written through the
 * module since it was created.
 */
export class GuiBootCache {
    /** @param {import('../../../index.js').Puter} puter */
    constructor (puter) {
        this.puter = puter;
        /** @type {Set<string>} */
        this.written = new Set();
        // Elsewhere these are ordinary keys in the caller's own store.
        if ( puter.env !== 'gui' ) {
            this.batch = null;
            this.init = null;
            return;
        }
        this.batch = createDeferred();
        this.init = createDeferred();
        (async () => {
            await this.init.promise;
            this.init = null;
            let values;
            try {
                values = await driverCallEnvelope({
                    puter,
                    iface: 'puter-kvstore',
                    method: 'get',
                    args: { key: GUI_CACHE_KEYS },
                });
            } catch {
                values = null;
            }
            const scheduleExpiry = () => {
                setTimeout(() => {
                    this.batch = null;
                }, BATCH_LIFETIME_MS);
            };
            // A batch that failed or came back in an unexpected shape resolves
            // to `null` (no cached keys), so every read for the rest of the
            // window falls through to its own call instead of a false "miss".
            if ( ! Array.isArray(values?.result) ) {
                this.batch.resolve(null);
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
        return typeof key === 'string' && GUI_CACHE_KEYS.includes(key) && !this.written.has(key) && this.batch !== null;
    }

    /**
     * Stops serving `keys` from the batch, so a read after a write goes to the
     * store. Called when a write is issued, before it lands.
     *
     * @param {...unknown} keys
     */
    invalidate (...keys) {
        if ( this.batch === null ) return;
        for ( const key of keys ) {
            if ( typeof key === 'string' && GUI_CACHE_KEYS.includes(key) ) {
                this.written.add(key);
            }
        }
    }

    invalidateAll () {
        this.invalidate(...GUI_CACHE_KEYS);
    }

    /**
     * @param {string} key
     * @returns {Promise<{ hit: true, value: unknown } | { hit: false }>}
     *   `hit: false` when the batch failed, came back malformed, or the key
     *   was written meanwhile — the caller should fall through to its own
     *   driver call.
     */
    async lookup (key) {
        this.init && this.init.resolve();
        const cache = await this.batch.promise;
        // Written while this read waited: the batch may predate the write.
        if ( cache === null || this.written.has(key) ) return { hit: false };
        // `null`, not `undefined`, to match a normal miss from `kv.get()`.
        return { hit: true, value: cache[key] ?? null };
    }
}
