import { PuterModule } from '../../lib/PuterModule.js';
import { requestReadAppRootDir, requestWriteAppRootDir } from './appRootDir.js';
import {
    requestFolder_,
    requestReadDesktop, requestWriteDesktop,
    requestReadDocuments, requestWriteDocuments,
    requestReadPictures, requestWritePictures,
    requestReadVideos, requestWriteVideos,
} from './folders.js';
import {
    grantApp, grantAppAnyUser, grantGroup, grantOrigin, grantUser,
    revokeApp, revokeAppAnyUser, revokeGroup, revokeOrigin, revokeUser,
} from './grants.js';
import { addUsersToGroup, createGroup, listGroups, removeUsersFromGroup } from './groups.js';
import { req } from './lib/req.js';
import {
    request, requestEmail, requestManageApps, requestManageSubdomains,
    requestPermission, requestReadApps, requestReadSubdomains,
} from './permissions.js';

/** @typedef {import('../../../types/puter').Puter} Puter */

// Every `this`-context method exposed on the module, rebound in the
// constructor so both `puter.perms.grantUser(...)` and destructured
// `const { grantUser } = puter.perms` calls keep the right `this`.
const METHODS = [
    'grantUser', 'grantGroup', 'grantApp', 'grantAppAnyUser', 'grantOrigin',
    'revokeUser', 'revokeGroup', 'revokeApp', 'revokeAppAnyUser', 'revokeOrigin',
    'createGroup', 'addUsersToGroup', 'removeUsersFromGroup', 'listGroups',
    'request', 'requestPermission', 'requestEmail',
    'requestReadApps', 'requestManageApps', 'requestReadSubdomains', 'requestManageSubdomains',
    'requestFolder_',
    'requestReadDesktop', 'requestWriteDesktop',
    'requestReadDocuments', 'requestWriteDocuments',
    'requestReadPictures', 'requestWritePictures',
    'requestReadVideos', 'requestWriteVideos',
    'requestReadAppRootDir', 'requestWriteAppRootDir',
];

/**
 * The `puter.perms` module.
 *
 * Method implementations live in the sibling files as `this`-context
 * functions whose JSDoc is the source of truth for the public signatures;
 * types/modules/perms.d.ts mirrors them for TypeScript consumers of the SDK.
 */
export class PermsModule extends PuterModule {
    // Grant / revoke
    grantUser = grantUser;
    grantGroup = grantGroup;
    grantApp = grantApp;
    grantAppAnyUser = grantAppAnyUser;
    grantOrigin = grantOrigin;
    revokeUser = revokeUser;
    revokeGroup = revokeGroup;
    revokeApp = revokeApp;
    revokeAppAnyUser = revokeAppAnyUser;
    revokeOrigin = revokeOrigin;

    // Group management
    createGroup = createGroup;
    addUsersToGroup = addUsersToGroup;
    removeUsersFromGroup = removeUsersFromGroup;
    listGroups = listGroups;

    // Permission requests
    request = request;
    requestPermission = requestPermission;
    requestEmail = requestEmail;
    requestReadApps = requestReadApps;
    requestManageApps = requestManageApps;
    requestReadSubdomains = requestReadSubdomains;
    requestManageSubdomains = requestManageSubdomains;

    // Folder access
    requestFolder_ = requestFolder_;
    requestReadDesktop = requestReadDesktop;
    requestWriteDesktop = requestWriteDesktop;
    requestReadDocuments = requestReadDocuments;
    requestWriteDocuments = requestWriteDocuments;
    requestReadPictures = requestReadPictures;
    requestWritePictures = requestWritePictures;
    requestReadVideos = requestReadVideos;
    requestWriteVideos = requestWriteVideos;

    // App root directory access
    requestReadAppRootDir = requestReadAppRootDir;
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

    /**
     * Low-level request helper against the auth/group endpoints, kept on the
     * instance for backward compatibility. Returns the parsed result object
     * (with `error: true` set on failure) rather than rejecting.
     *
     * @param {string} route
     * @param {Record<string, unknown>} [body]
     * @returns {Promise<Record<string, unknown>>}
     */
    req_ (route, body) {
        return req(this.puter, route, body);
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
