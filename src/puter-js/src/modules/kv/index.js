import { add } from './add.js';
import { decr } from './decr.js';
import { del } from './del.js';
import { expire } from './expire.js';
import { expireAt } from './expireAt.js';
import { flush } from './flush.js';
import { get } from './get.js';
import { incr } from './incr.js';
import { GuiBootCache } from './lib/guiCache.js';
import { MAX_KEY_SIZE, MAX_VALUE_SIZE } from './lib/validate.js';
import { list } from './list.js';
import { remove } from './remove.js';
import { set } from './set.js';
import { update } from './update.js';

/** @typedef {import('../../../types/puter').Puter} Puter */

/**
 * The `puter.kv` module. Holds a reference to the owning Puter instance and
 * reads auth state from it live — nothing is copied out, so token and origin
 * changes on the instance apply to in-flight modules immediately.
 *
 * Method implementations live in the sibling files as `this`-context
 * functions whose JSDoc (including the per-form `@overload` declarations) is
 * the source of truth for the public signatures; types/modules/kv.d.ts
 * mirrors them for TypeScript consumers of the published SDK.
 */
export class KVModule {
    /** @type {Puter} */
    puter;

    /** @type {GuiBootCache} */
    guiCache;

    /** The maximum allowed key size, in bytes (`1 KB`). */
    MAX_KEY_SIZE = MAX_KEY_SIZE;

    /** The maximum allowed value size, in bytes (`400 KB`). */
    MAX_VALUE_SIZE = MAX_VALUE_SIZE;

    // The fields hold the unbound functions so they keep the full overloaded
    // types (`bind` erases overloads); the constructor rebinds them at
    // runtime so destructured calls (`const { get } = puter.kv`) keep
    // working like the old arrow fields did.
    set = set;
    get = get;
    del = del;
    incr = incr;
    decr = decr;
    add = add;
    remove = remove;
    update = update;
    expire = expire;
    expireAt = expireAt;
    list = list;
    flush = flush;
    /** Alias of {@link flush}. */
    clear = flush;

    /** @param {Puter} puter */
    constructor (puter) {
        this.puter = puter;
        this.guiCache = new GuiBootCache(puter);

        const methods = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (
            /** @type {unknown} */ (this)
        );
        for ( const name of [
            'set', 'get', 'del', 'incr', 'decr', 'add', 'remove',
            'update', 'expire', 'expireAt', 'list', 'flush',
        ] ) {
            methods[name] = methods[name].bind(this);
        }
        // The same bound function, so `puter.kv.clear === puter.kv.flush`
        // keeps holding like it did when clear was assigned from flush.
        this.clear = this.flush;
    }

    // Kept for backward compatibility: these used to be copied fields kept
    // in sync by set{AuthToken,APIOrigin}; they now read through live.
    get authToken () {
        return this.puter.authToken;
    }

    get APIOrigin () {
        return this.puter.APIOrigin;
    }

    get appID () {
        return this.puter.appID;
    }

    // No-ops: auth state is read from the Puter instance at call time. The
    // module registry still invokes these on token/origin changes.
    setAuthToken () {}

    setAPIOrigin () {}
}

/**
 * The public face of the module: derived from the class, with the internal
 * `puter` handle, the GUI boot cache, and the legacy `authToken` accessor
 * omitted.
 *
 * @typedef {import('../../lib/types.js').OmitMembers<
 *     typeof KVModule,
 *     'puter' | 'guiCache' | 'authToken'
 * >} KVConstructor
 */

export const KV = /** @type {KVConstructor} */ (KVModule);
