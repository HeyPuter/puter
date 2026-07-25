import { user } from './user.js';
import { version } from './version.js';

/** @typedef {import('../../../types/puter').Puter} Puter */

/**
 * The `puter.os` module. Holds a reference to the owning Puter instance and
 * reads auth state from it live — nothing is copied out, so token and origin
 * changes on the instance apply to in-flight modules immediately.
 *
 * Method implementations live in the sibling files as `this`-context
 * functions whose JSDoc is the source of truth for the public signatures;
 * types/modules/os.d.ts mirrors them for TypeScript consumers of the SDK.
 */
export class OSModule {
    /** @type {Puter} */
    puter;

    user = user;
    version = version;

    /** @param {Puter} puter */
    constructor (puter) {
        this.puter = puter;

        const methods = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (
            /** @type {unknown} */ (this)
        );
        for ( const name of ['user', 'version'] ) {
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
 *     typeof OSModule,
 *     'puter' | 'authToken'
 * >} OSConstructor
 */

export const OS = /** @type {OSConstructor} */ (OSModule);

export default OS;
