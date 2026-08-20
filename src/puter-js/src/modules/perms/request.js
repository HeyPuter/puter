import { appDataRequest } from './appData.js';
import { appUidOf, statAppRootDir } from './appRootDir.js';
import { folderPathFor } from './folders.js';
import { holdsPermissions } from './lib/holds.js';
import {
    appRootDirPermission,
    appsPermission,
    emailPermission,
    fsPermission,
    subdomainsPermission,
} from './lib/permissionStrings.js';
import { assertAccess, assertFolderName, invalidArgument } from './lib/validate.js';
import { requestPermissions } from './permissions.js';

/** @typedef {import('./index.js').PermsModule} PermsModule */
/** @typedef {import('./types.js').PermsAccess} PermsAccess */
/** @typedef {import('./types.js').PermsResource} PermsResource */
/** @typedef {import('./types.js').PermsRequestDetails} PermsRequestDetails */

/** @param {Record<string, unknown>} details @returns {PermsAccess} */
const accessOf = (details) => assertAccess(details.access ?? 'read');

/**
 * The permission strings a `'permission'` request names, one or many.
 *
 * @param {Record<string, unknown>} details
 * @returns {string[]}
 */
const permissionsOf = (details) => {
    const { permission, permissions } = details;
    if ( permissions !== undefined ) {
        if ( permission !== undefined ) {
            throw invalidArgument('pass `permission` or `permissions`, not both');
        }
        if ( ! Array.isArray(permissions) || permissions.length === 0 ) {
            throw invalidArgument('`permissions` must be a non-empty array');
        }
        for ( const entry of permissions ) {
            if ( typeof entry !== 'string' || entry === '' ) {
                throw invalidArgument('`permissions` entries must be non-empty strings');
            }
        }
        return [...new Set(/** @type {string[]} */ (permissions))];
    }
    if ( typeof permission !== 'string' || permission === '' ) {
        throw invalidArgument('`permission` must be a non-empty string');
    }
    return [permission];
};

/**
 * Per resource: ask for it alone (`request`, delegating to the method that
 * always served it), whether it is held (`check`), the strings a batch pools
 * into one prompt (`permissions`), and the value once held (`resolve`).
 *
 * @type {Record<string, {
 *     request: (perms: PermsModule, details: Record<string, unknown>) => Promise<unknown>,
 *     check: (perms: PermsModule, details: Record<string, unknown>) => Promise<boolean>,
 *     permissions: (perms: PermsModule, details: Record<string, unknown>) => Promise<string[]>,
 *     resolve: (perms: PermsModule, details: Record<string, unknown>, held: boolean) => Promise<unknown>,
 * }>}
 */
const RESOURCES = {
    email: {
        request: (perms) => perms.requestEmail(),
        check: async (perms) => {
            // The grant is what puts the field on `whoami`, so `null` is granted.
            const whoami = await perms.puter.auth.whoami();
            if ( whoami.email !== undefined ) return true;
            return await holdsPermissions(perms.puter, [
                emailPermission(whoami.uuid),
            ]);
        },
        permissions: async (perms) => {
            const whoami = await perms.puter.auth.whoami();
            return [emailPermission(whoami.uuid)];
        },
        resolve: async (perms, _details, held) => {
            if ( ! held ) return undefined;
            return (await perms.puter.auth.whoami()).email;
        },
    },

    folder: {
        request: (perms, details) =>
            perms.requestFolder(
                /** @type {import('./types.js').PermsFolderName} */ (details.name),
                accessOf(details),
            ),
        check: async (perms, details) => {
            const permissions = await RESOURCES.folder.permissions(perms, details);
            return await holdsPermissions(perms.puter, permissions);
        },
        permissions: async (perms, details) => {
            const access = accessOf(details);
            const path = await folderPathFor(
                perms.puter,
                assertFolderName(details.name),
            );
            return [fsPermission(path, access)];
        },
        resolve: async (perms, details, held) => {
            if ( ! held ) return undefined;
            return await folderPathFor(
                perms.puter,
                assertFolderName(details.name),
            );
        },
    },

    apps: {
        request: (perms, details) => perms.requestApps(accessOf(details)),
        check: async (perms, details) =>
            await holdsPermissions(
                perms.puter,
                await RESOURCES.apps.permissions(perms, details),
            ),
        permissions: async (perms, details) => {
            const access = accessOf(details);
            const whoami = await perms.puter.auth.whoami();
            return [appsPermission(whoami.uuid, access)];
        },
        resolve: async (_perms, _details, held) => held,
    },

    subdomains: {
        request: (perms, details) => perms.requestSubdomains(accessOf(details)),
        check: async (perms, details) =>
            await holdsPermissions(
                perms.puter,
                await RESOURCES.subdomains.permissions(perms, details),
            ),
        permissions: async (perms, details) => {
            const access = accessOf(details);
            const whoami = await perms.puter.auth.whoami();
            return [subdomainsPermission(whoami.uuid, access)];
        },
        resolve: async (_perms, _details, held) => held,
    },

    appData: {
        request: (perms, details) =>
            perms.requestAppData(
                /** @type {string} */ (details.app),
                /** @type {import('./types.js').AppDataScopes} */ (details.scopes),
            ),
        check: async (perms, details) => {
            const permissions = await RESOURCES.appData.permissions(perms, details);
            // Its own data, which it may always use.
            if ( permissions.length === 0 ) return true;
            return await holdsPermissions(perms.puter, permissions);
        },
        permissions: (perms, details) =>
            appDataRequest(
                perms.puter,
                /** @type {string} */ (details.app),
                /** @type {import('./types.js').AppDataScopes} */ (details.scopes),
            ),
        resolve: async (_perms, _details, held) => held,
    },

    appRootDir: {
        request: (perms, details) =>
            perms.requestAppRootDir(
                /** @type {string} */ (details.app),
                accessOf(details),
            ),
        // `app-root-dir:…` only resolves while a grant is written, so ask the server.
        check: async (perms, details) => {
            const result = await statAppRootDir(
                perms.puter,
                appUidOf(details.app),
                accessOf(details),
            );
            return ! result.error;
        },
        permissions: async (_perms, details) => [
            appRootDirPermission(appUidOf(details.app), accessOf(details)),
        ],
        // Only the server can name the directory, so this asks even once held.
        resolve: async (perms, details, held) => {
            if ( ! held ) return undefined;
            const result = await statAppRootDir(
                perms.puter,
                appUidOf(details.app),
                accessOf(details),
            );
            return result.error ? undefined : result;
        },
    },

    permission: {
        request: (perms, details) =>
            requestPermissions(perms.puter, permissionsOf(details)),
        check: (perms, details) =>
            holdsPermissions(perms.puter, permissionsOf(details)),
        permissions: async (_perms, details) => permissionsOf(details),
        resolve: async (_perms, _details, held) => held,
    },
};

/**
 * Resolve a call to its resource handler, or to the legacy raw-permission form.
 *
 * A lone string naming no resource is a permission string: no resource name
 * contains a `:` and every permission string does, so neither can be mistaken
 * for the other. Details beside an unknown resource is a typo, and says so.
 *
 * @param {'request' | 'check'} op
 * @param {unknown} resource
 * @param {unknown} details
 * @returns {{ handler: (perms: PermsModule, details: Record<string, unknown>) => Promise<unknown>, details: Record<string, unknown> }}
 */
const resolve = (op, resource, details) => {
    if ( typeof resource !== 'string' || resource === '' ) {
        throw invalidArgument('resource must be a non-empty string');
    }
    if ( details !== undefined && (typeof details !== 'object' || details === null || Array.isArray(details)) ) {
        throw invalidArgument('details must be an object');
    }

    const entry = RESOURCES[resource];
    if ( entry ) {
        return {
            handler: entry[op],
            details: /** @type {Record<string, unknown>} */ (details ?? {}),
        };
    }
    if ( details !== undefined ) {
        throw invalidArgument(
            `unknown resource: ${resource} (expected one of: ${Object.keys(RESOURCES).join(', ')})`,
        );
    }
    return {
        handler: RESOURCES.permission[op],
        details: { permission: resource },
    };
};

/**
 * Split a batch entry into its resource and its remaining fields. The resource
 * travels inside the object so one array can carry differently-shaped entries.
 *
 * @param {unknown} entry
 * @param {number} index
 * @returns {{ resource: string, details: Record<string, unknown> }}
 */
const batchEntry = (entry, index) => {
    if ( typeof entry !== 'object' || entry === null || Array.isArray(entry) ) {
        throw invalidArgument(`requests[${index}] must be an object`);
    }
    const { resource, ...details } = /** @type {Record<string, unknown>} */ (entry);
    if ( typeof resource !== 'string' || resource === '' ) {
        throw invalidArgument(`requests[${index}].resource must be a non-empty string`);
    }
    if ( ! RESOURCES[resource] ) {
        throw invalidArgument(
            `requests[${index}]: unknown resource: ${resource} ` +
            `(expected one of: ${Object.keys(RESOURCES).join(', ')})`,
        );
    }
    return { resource, details };
};

/**
 * Ask for several resources under a single prompt, which lists only what is
 * missing and never appears when the whole batch is already held. A denial
 * denies every entry that needed the prompt; held entries keep their value.
 *
 * @param {PermsModule} perms
 * @param {unknown[]} requests
 * @returns {Promise<unknown[]>}
 */
async function requestBatch (perms, requests) {
    const entries = requests.map(batchEntry);

    // Validate every entry first, so a bad one can't follow a raised prompt.
    const permissions = await Promise.all(
        entries.map(({ resource, details }) =>
            RESOURCES[resource].permissions(perms, details),
        ),
    );
    const held = await Promise.all(
        entries.map(({ resource, details }) =>
            RESOURCES[resource].check(perms, details),
        ),
    );

    const missing = [
        ...new Set(
            entries.flatMap((_entry, i) => (held[i] ? [] : permissions[i])),
        ),
    ];
    const granted =
        missing.length === 0
            ? true
            : await requestPermissions(perms.puter, missing);

    return await Promise.all(
        entries.map(({ resource, details }, i) =>
            RESOURCES[resource].resolve(perms, details, held[i] || granted),
        ),
    );
}

/**
 * @overload
 * @param {'email'} resource
 * @returns {Promise<string | null | undefined>}
 */
/**
 * @overload
 * @param {'folder'} resource
 * @param {import('./types.js').PermsFolderRequest} details
 * @returns {Promise<string | undefined>}
 */
/**
 * @overload
 * @param {'apps' | 'subdomains'} resource
 * @param {import('./types.js').PermsAccessRequest} [details]
 * @returns {Promise<boolean>}
 */
/**
 * @overload
 * @param {'appData'} resource
 * @param {import('./types.js').PermsAppDataRequest} details
 * @returns {Promise<boolean>}
 */
/**
 * @overload
 * @param {'appRootDir'} resource
 * @param {import('./types.js').PermsAppRootDirRequest} details
 * @returns {Promise<Record<string, unknown> | undefined>}
 */
/**
 * @overload
 * @param {'permission'} resource
 * @param {import('./types.js').PermsPermissionRequest} details
 * @returns {Promise<boolean>}
 */
/**
 * @overload
 * @param {import('./types.js').PermsBatchEntry[]} requests
 * @returns {Promise<unknown[]>}
 */
/**
 * @overload
 * @param {string} permission
 * @returns {Promise<boolean>}
 */
/**
 * Ask the user for access, prompting only when it isn't already held. The
 * resource decides which details are taken and what resolves: `'folder'` gives
 * the path, `'email'` the address, the rest a boolean. Denied is always falsy.
 *
 *     await puter.perms.request('folder', { name: 'Documents', access: 'write' });
 *
 * An array asks for several at once, behind one prompt, resolving in order.
 *
 *     await puter.perms.request([
 *         { resource: 'folder', name: 'Documents' },
 *         { resource: 'apps' },
 *     ]);
 *
 * @this {PermsModule}
 * @param {PermsResource | string | import('./types.js').PermsBatchEntry[]} resource
 * @param {PermsRequestDetails} [details]
 * @returns {Promise<unknown>}
 */
export async function request (resource, details) {
    if ( Array.isArray(resource) ) {
        if ( details !== undefined ) {
            throw invalidArgument('a batch takes no second argument');
        }
        return await requestBatch(this, resource);
    }
    const resolved = resolve('request', resource, details);
    return await resolved.handler(this, resolved.details);
}

/**
 * @overload
 * @param {'email'} resource
 * @returns {Promise<boolean>}
 */
/**
 * @overload
 * @param {'folder'} resource
 * @param {import('./types.js').PermsFolderRequest} details
 * @returns {Promise<boolean>}
 */
/**
 * @overload
 * @param {'apps' | 'subdomains'} resource
 * @param {import('./types.js').PermsAccessRequest} [details]
 * @returns {Promise<boolean>}
 */
/**
 * @overload
 * @param {'appData'} resource
 * @param {import('./types.js').PermsAppDataRequest} details
 * @returns {Promise<boolean>}
 */
/**
 * @overload
 * @param {'appRootDir'} resource
 * @param {import('./types.js').PermsAppRootDirRequest} details
 * @returns {Promise<boolean>}
 */
/**
 * @overload
 * @param {'permission'} resource
 * @param {import('./types.js').PermsPermissionRequest} details
 * @returns {Promise<boolean>}
 */
/**
 * @overload
 * @param {import('./types.js').PermsBatchEntry[]} requests
 * @returns {Promise<boolean[]>}
 */
/**
 * @overload
 * @param {string} permission
 * @returns {Promise<boolean>}
 */
/**
 * Whether the access is already held, never prompting. Takes the same resource
 * and details as {@link request}, so an app can offer an opt-in only where one
 * is needed. A partly-granted set answers `false` — the prompt is still needed.
 *
 *     if ( ! await puter.perms.check('folder', { name: 'Documents' }) ) ...
 *
 * The array form answers per entry, in order, naming which parts are missing.
 *
 * @this {PermsModule}
 * @param {PermsResource | string | import('./types.js').PermsBatchEntry[]} resource
 * @param {PermsRequestDetails} [details]
 * @returns {Promise<boolean | boolean[]>}
 */
export async function check (resource, details) {
    if ( Array.isArray(resource) ) {
        if ( details !== undefined ) {
            throw invalidArgument('a batch takes no second argument');
        }
        const entries = resource.map(batchEntry);
        return await Promise.all(
            entries.map(({ resource: name, details: entryDetails }) =>
                RESOURCES[name].check(this, entryDetails),
            ),
        );
    }
    const resolved = resolve('check', resource, details);
    return /** @type {boolean} */ (await resolved.handler(this, resolved.details));
}
