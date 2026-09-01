import { PuterModule } from '../../lib/PuterModule.js';
import { requestAppData } from './appData.js';
import { requestReadAppRootDir, requestWriteAppRootDir } from './appRootDir.js';
import {
    requestFolder_,
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
    requestEmail,
    requestManageApps, requestManageSubdomains,
    requestPermission, requestReadApps, requestReadSubdomains,
} from './permissions.js';
import { check, request } from './request.js';

/** @typedef {import('../../index.js').Puter} Puter */

// Every `this`-context method exposed on the module, rebound in the
// constructor so both `puter.perms.request(...)` and destructured
// `const { request } = puter.perms` calls keep the right `this`.
const METHODS = [
    'grantApp', 'grantAppAnyUser', 'grantOrigin',
    'revokeApp', 'revokeAppAnyUser', 'revokeOrigin',
    'request', 'check',
    // Deprecated aliases; bound for the same reason as the rest.
    'requestEmail', 'requestAppData',
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

    // The whole supported surface; everything below is a deprecated alias.
    request = request;
    check = check;

    // -- Deprecated aliases --
    //
    // Still bound and callable, and still in the generated declarations:
    // `stripInternal` does nothing for declarations emitted from JavaScript,
    // and hiding them by hand would break TypeScript callers we still serve.

    /** @deprecated Use `request('email')`. */
    requestEmail = requestEmail;
    /** @deprecated Use `request('appData', { app, scopes })`. */
    requestAppData = requestAppData;

    /** @deprecated Use {@link request}. */
    requestPermission = requestPermission;
    /** @deprecated Use `request('folder', { name, access })`. */
    requestFolder_ = requestFolder_;
    /** @deprecated Use `request('folder', { name: 'Desktop' })`. */
    requestReadDesktop = requestReadDesktop;
    /** @deprecated Use `request('folder', { name: 'Desktop', access: 'write' })`. */
    requestWriteDesktop = requestWriteDesktop;
    /** @deprecated Use `request('folder', { name: 'Documents' })`. */
    requestReadDocuments = requestReadDocuments;
    /** @deprecated Use `request('folder', { name: 'Documents', access: 'write' })`. */
    requestWriteDocuments = requestWriteDocuments;
    /** @deprecated Use `request('folder', { name: 'Pictures' })`. */
    requestReadPictures = requestReadPictures;
    /** @deprecated Use `request('folder', { name: 'Pictures', access: 'write' })`. */
    requestWritePictures = requestWritePictures;
    /** @deprecated Use `request('folder', { name: 'Videos' })`. */
    requestReadVideos = requestReadVideos;
    /** @deprecated Use `request('folder', { name: 'Videos', access: 'write' })`. */
    requestWriteVideos = requestWriteVideos;
    /** @deprecated Use `request('apps')`. */
    requestReadApps = requestReadApps;
    /** @deprecated Use `request('apps', { access: 'write' })`. */
    requestManageApps = requestManageApps;
    /** @deprecated Use `request('subdomains')`. */
    requestReadSubdomains = requestReadSubdomains;
    /** @deprecated Use `request('subdomains', { access: 'write' })`. */
    requestManageSubdomains = requestManageSubdomains;
    /** @deprecated Use `request('appRootDir', { app })`. */
    requestReadAppRootDir = requestReadAppRootDir;
    /** @deprecated Use `request('appRootDir', { app, access: 'write' })`. */
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
