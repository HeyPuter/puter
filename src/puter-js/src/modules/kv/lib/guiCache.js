import { driverCallEnvelope } from '../../../lib/networkUtils.js';

// Keys the Puter GUI reads at boot. The first `get()` of any of them triggers
// a single batched driver call fetching the ones the booted interface reads, so
// the GUI doesn't issue a round-trip per key while it initializes.
const SHARED_BOOT_KEYS = [
    'user_preferences.show_hidden_files',
    'user_preferences.language',
];
const DESKTOP_BOOT_KEYS = [
    ...SHARED_BOOT_KEYS,
    'window_sidebar_width',
    'sidebar_items',
];
// The dashboard's Files and Apps tabs.
const DASHBOARD_BOOT_KEYS = [
    ...SHARED_BOOT_KEYS,
    'view_mode',
    'sort_column',
    'sort_direction',
    'column_widths',
    'dashboard_apps_order',
    'dashboard_removed_apps',
    'dashboard_app_groups',
];
const GUI_CACHE_KEYS = [...new Set([...DESKTOP_BOOT_KEYS, ...DASHBOARD_BOOT_KEYS])];

// The GUI sets `is_dashboard_mode` before its first read.
const bootKeys = () => (globalThis.is_dashboard_mode === true ? DASHBOARD_BOOT_KEYS : DESKTOP_BOOT_KEYS);

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
            const keys = bootKeys();
            let values;
            try {
                values = await driverCallEnvelope({
                    puter,
                    iface: 'puter-kvstore',
                    method: 'get',
                    args: { key: keys },
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
            /** @type {Record<string, unknown>} */
            const byKey = {};
            for ( let i = 0; i < keys.length; i++ ) {
                byKey[keys[i]] = values.result[i];
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
     *   `hit: false` when the batch failed, came back malformed, left the key
     *   out, or the key was written meanwhile — the caller should fall through
     *   to its own driver call.
     */
    async lookup (key) {
        this.init && this.init.resolve();
        const cache = await this.batch.promise;
        // Written while this read waited: the batch may predate the write.
        // A key the other interface reads was never fetched.
        if ( cache === null || this.written.has(key) || !Object.hasOwn(cache, key) ) return { hit: false };
        // `null`, not `undefined`, to match a normal miss from `kv.get()`.
        return { hit: true, value: cache[key] ?? null };
    }
}
