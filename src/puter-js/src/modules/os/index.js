import { PuterModule } from '../../lib/PuterModule.js';
import { user } from './user.js';
import { version } from './version.js';

/** @typedef {import('../../../types/puter').Puter} Puter */

/**
 * The `puter.os` module.
 *
 * Method implementations live in the sibling files as `this`-context
 * functions whose JSDoc is the source of truth for the public signatures;
 * types/modules/os.d.ts mirrors them for TypeScript consumers of the SDK.
 */
export class OSModule extends PuterModule {
    user = user;
    version = version;

    /** @param {Puter} puter */
    constructor (puter) {
        super(puter);

        const methods = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (
            /** @type {unknown} */ (this)
        );
        for ( const name of ['user', 'version'] ) {
            methods[name] = methods[name].bind(this);
        }
    }
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
