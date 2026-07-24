import { create } from './create.js';
import { del } from './delete.js';
import { get } from './get.js';
import { list } from './list.js';
import { update } from './update.js';

/** @typedef {import('../../../types/puter').Puter} Puter */

/**
 * The `puter.hosting` module. Holds a reference to the owning Puter instance
 * and reads auth state from it live — nothing is copied out, so token and
 * origin changes on the instance apply to in-flight modules immediately.
 *
 * Method implementations live in the sibling files as `this`-context
 * functions whose JSDoc (including the per-form `@overload` declarations) is
 * the source of truth for the public signatures; types/modules/hosting.d.ts
 * mirrors them for TypeScript consumers of the published SDK.
 */
export class HostingModule {
    /** @type {Puter} */
    puter;

    // The fields hold the unbound functions so they keep the full overloaded
    // types (`bind` erases overloads); the constructor rebinds them at runtime
    // so destructured calls (`const { create } = puter.hosting`) keep working.
    list = list;
    create = create;
    update = update;
    get = get;
    delete = del;

    /** @param {Puter} puter */
    constructor (puter) {
        this.puter = puter;

        const methods = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (
            /** @type {unknown} */ (this)
        );
        for ( const name of ['list', 'create', 'update', 'get', 'delete'] ) {
            methods[name] = methods[name].bind(this);
        }
    }

    // Kept for backward compatibility: these used to be copied fields kept in
    // sync by set{AuthToken,APIOrigin}; they now read through live.
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
 * `puter` handle and the legacy `authToken` accessor omitted.
 *
 * @typedef {import('../../lib/types.js').OmitMembers<
 *     typeof HostingModule,
 *     'puter' | 'authToken'
 * >} HostingConstructor
 */

export const Hosting = /** @type {HostingConstructor} */ (HostingModule);

export default Hosting;
