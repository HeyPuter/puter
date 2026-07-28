import { PuterModule } from '../../lib/PuterModule.js';
import { checkName } from './checkName.js';
import { create } from './create.js';
import { del } from './delete.js';
import { get } from './get.js';
import { getDeveloperProfile } from './getDeveloperProfile.js';
import { list } from './list.js';
import { update } from './update.js';

/** @typedef {import('../../../types/puter').Puter} Puter */

/**
 * The `puter.apps` module.
 *
 * Method implementations live in the sibling files as `this`-context
 * functions whose JSDoc (including the per-form `@overload` declarations) is
 * the source of truth for the public signatures; types/modules/apps.d.ts
 * mirrors them for TypeScript consumers of the published SDK.
 */
export class AppsModule extends PuterModule {
    // The fields hold the unbound functions so they keep the full overloaded
    // types (`bind` erases overloads); the constructor rebinds them at runtime
    // so destructured calls (`const { create } = puter.apps`) keep working.
    list = list;
    create = create;
    update = update;
    get = get;
    delete = del;
    checkName = checkName;
    getDeveloperProfile = getDeveloperProfile;

    /** @param {Puter} puter */
    constructor (puter) {
        super(puter);

        const methods = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (
            /** @type {unknown} */ (this)
        );
        for ( const name of ['list', 'create', 'update', 'get', 'delete', 'checkName', 'getDeveloperProfile'] ) {
            methods[name] = methods[name].bind(this);
        }
    }
}

/**
 * The public face of the module: derived from the class, with the internal
 * `puter` handle and the legacy `authToken` accessor omitted.
 *
 * @typedef {import('../../lib/types.js').OmitMembers<
 *     typeof AppsModule,
 *     'puter' | 'authToken'
 * >} AppsConstructor
 */

export const Apps = /** @type {AppsConstructor} */ (AppsModule);

export default Apps;
