import { PuterModule } from '../../lib/PuterModule.js';
import { requestAppData } from './appData.js';
import {
    requestAppRootDir,
    requestReadAppRootDir, requestWriteAppRootDir,
} from './appRootDir.js';
import {
    requestFolder, requestFolder_,
    requestReadDesktop, requestWriteDesktop,
    requestReadDocuments, requestWriteDocuments,
    requestReadPictures, requestWritePictures,
    requestReadVideos, requestWriteVideos,
} from './folders.js';
import {
    grantApp, grantAppAnyUser, grantOrigin,
    revokeApp, revokeAppAnyUser, revokeOrigin,
} from './grants.js';
import {
    request, requestApps, requestEmail,
    requestManageApps, requestManageSubdomains,
    requestPermission, requestReadApps, requestReadSubdomains,
    requestSubdomains,
} from './permissions.js';

/** @typedef {import('../../index.js').Puter} Puter */

// Every `this`-context method exposed on the module, rebound in the
// constructor so both `puter.perms.requestFolder(...)` and destructured
// `const { requestFolder } = puter.perms` calls keep the right `this`.
const METHODS = [
    'grantApp', 'grantAppAnyUser', 'grantOrigin',
    'revokeApp', 'revokeAppAnyUser', 'revokeOrigin',
    'request', 'requestEmail',
    'requestFolder', 'requestApps', 'requestSubdomains',
    'requestAppRootDir', 'requestAppData',
    // Deprecated aliases; bound for the same reason as the rest.
    'requestPermission', 'requestFolder_',
    'requestReadDesktop', 'requestWriteDesktop',
    'requestReadDocuments', 'requestWriteDocuments',
    'requestReadPictures', 'requestWritePictures',
    'requestReadVideos', 'requestWriteVideos',
    'requestReadApps', 'requestManageApps',
    'requestReadSubdomains', 'requestManageSubdomains',
    'requestReadAppRootDir', 'requestWriteAppRootDir',
];

/**
 * The `puter.perms` module.
 *
 * Method implementations live in the sibling files as `this`-context
 * functions whose JSDoc is the source of truth for the public signatures —
 * `types/` is generated from it, never edited by hand.
 */
export class PermsModule extends PuterModule {
    // Grant / revoke against an app, its origin, or every user of it
    grantApp = grantApp;
    grantAppAnyUser = grantAppAnyUser;
    grantOrigin = grantOrigin;
    revokeApp = revokeApp;
    revokeAppAnyUser = revokeAppAnyUser;
    revokeOrigin = revokeOrigin;

    // Permission requests
    request = request;
    requestEmail = requestEmail;

    // Special folders
    requestFolder = requestFolder;

    // The user's apps and subdomains
    requestApps = requestApps;
    requestSubdomains = requestSubdomains;

    // An app's root directory
    requestAppRootDir = requestAppRootDir;

    // Another app's data (KV namespace + AppData directory)
    requestAppData = requestAppData;

    // -- Deprecated aliases --
    //
    // Still bound and callable so apps written against the one-method-per-task
    // surface keep working. They stay in the generated declarations rather than
    // being hidden: `stripInternal` has no effect on declarations emitted from
    // JavaScript, and dropping them by hand would break TypeScript callers that
    // the runtime still serves.

    /** @deprecated Use {@link request}. */
    requestPermission = requestPermission;
    /** @deprecated Use {@link requestFolder}. */
    requestFolder_ = requestFolder_;
    /** @deprecated Use {@link requestFolder}. */
    requestReadDesktop = requestReadDesktop;
    /** @deprecated Use {@link requestFolder}. */
    requestWriteDesktop = requestWriteDesktop;
    /** @deprecated Use {@link requestFolder}. */
    requestReadDocuments = requestReadDocuments;
    /** @deprecated Use {@link requestFolder}. */
    requestWriteDocuments = requestWriteDocuments;
    /** @deprecated Use {@link requestFolder}. */
    requestReadPictures = requestReadPictures;
    /** @deprecated Use {@link requestFolder}. */
    requestWritePictures = requestWritePictures;
    /** @deprecated Use {@link requestFolder}. */
    requestReadVideos = requestReadVideos;
    /** @deprecated Use {@link requestFolder}. */
    requestWriteVideos = requestWriteVideos;
    /** @deprecated Use {@link requestApps}. */
    requestReadApps = requestReadApps;
    /** @deprecated Use {@link requestApps}. */
    requestManageApps = requestManageApps;
    /** @deprecated Use {@link requestSubdomains}. */
    requestReadSubdomains = requestReadSubdomains;
    /** @deprecated Use {@link requestSubdomains}. */
    requestManageSubdomains = requestManageSubdomains;
    /** @deprecated Use {@link requestAppRootDir}. */
    requestReadAppRootDir = requestReadAppRootDir;
    /** @deprecated Use {@link requestAppRootDir}. */
    requestWriteAppRootDir = requestWriteAppRootDir;

    /** @param {Puter} puter */
    constructor (puter) {
        super(puter);

        const methods = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (
            /** @type {unknown} */ (this)
        );
        for ( const name of METHODS ) {
            methods[name] = methods[name].bind(this);
        }
    }
}

/**
 * The public face of the module: derived from the class, with the internal
 * `puter` handle and the legacy `authToken` accessor omitted.
 *
 * @typedef {import('../../lib/types.js').OmitMembers<
 *     typeof PermsModule,
 *     'puter' | 'authToken'
 * >} PermsConstructor
 */

export const Perms = /** @type {PermsConstructor} */ (PermsModule);

export default Perms;
