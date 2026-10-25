import { appDataRequest } from './appData.js';
import {
    appUidOf,
    checkAppRootDir,
    pollAppRootDir,
    statAppRootDir,
} from './appRootDir.js';
import { PuterJSError } from '../../lib/PuterJSError.js';
import { folderPathFor, folderReadable } from './folders.js';
import { fsTargetOf } from './fs.js';
import { kvShareRequestPermission } from './kvShare.js';
import { checkPermissions } from './lib/holds.js';
import {
    appRootDirPermission,
    appsPermission,
    BACKGROUND_EVENTS_PERMISSION,
    emailPermission,
    fsPermission,
    subdomainsPermission,
} from './lib/permissionStrings.js';
import {
    assertAccess,
    assertCreateKind,
    assertFolderName,
    assertKnownFields,
    invalidArgument,
} from './lib/validate.js';
import { requestPermissions } from './permissions.js';

/** @typedef {import('./index.js').PermsModule} PermsModule */
/** @typedef {import('../../index.js').Puter} Puter */
/** @typedef {import('./types.js').PermsAccess} PermsAccess */
/** @typedef {import('./types.js').PermsResource} PermsResource */
/** @typedef {import('./types.js').PermsRequestDetails} PermsRequestDetails */

/**
 * Per-call scratch space. `whoami` is cached here so a ten-entry batch fetches
 * it once, with `reread` for the one caller that needs it fresh: a grant is
 * what puts the email on it, so the copy read before the prompt doesn't carry
 * the address the prompt just released.
 *
 * @typedef {Object} PermsContext
 * @property {Puter} puter
 * @property {() => Promise<Record<string, any>>} whoami
 * @property {() => Promise<Record<string, any>>} reread
 */

/**
 * @param {Puter} puter
 * @returns {PermsContext}
 */
const makeContext = (puter) => {
    /** @type {Promise<Record<string, any>> | undefined} */
    let pending;
    return {
        puter,
        whoami: () => (pending ??= puter.auth.whoami()),
        reread: () => (pending = puter.auth.whoami()),
    };
};

/** @param {Record<string, unknown>} details @returns {PermsAccess} */
const accessOf = (details) => assertAccess(details.access ?? 'read');

/** @param {Record<string, unknown>} details @returns {string} */
const folderNameOf = (details) => assertFolderName(details.name);

/**
 * The permission strings a `'permission'` request names, one or many.
 *
 * @param {Record<string, unknown>} details
 * @returns {string[]}
 */
const permissionsOf = (details) => {
    const { permission, permissions, create } = details;
    assertCreateKind(create);
    if (permissions !== undefined) {
        if (permission !== undefined) {
            throw invalidArgument(
                'pass `permission` or `permissions`, not both',
            );
        }
        if (!Array.isArray(permissions) || permissions.length === 0) {
            throw invalidArgument('`permissions` must be a non-empty array');
        }
        for (const entry of permissions) {
            if (typeof entry !== 'string' || entry === '') {
                throw invalidArgument(
                    '`permissions` entries must be non-empty strings',
                );
            }
        }
        return [...new Set(/** @type {string[]} */ (permissions))];
    }
    if (typeof permission !== 'string' || permission === '') {
        throw invalidArgument('`permission` must be a non-empty string');
    }
    return [permission];
};

/**
 * One entry's question, handed to that resource's `check` and `resolve`.
 *
 * @typedef {Object} PermsQuery
 * @property {PermsContext} ctx
 * @property {Record<string, unknown>} details
 * @property {string[]} permissions - What this entry needs, already resolved.
 * @property {(permissions: string[]) => Promise<boolean>} holds - Answered from
 *   the call's one pooled permission read.
 * @property {boolean} prompt - Whether this is a `request`. A resource whose
 *   check would otherwise repeat work the request is about to do anyway can
 *   spend the round trip once and hand the result on through `scratch`.
 * @property {Record<string, unknown>} scratch - Per-entry, passed from `check`
 *   to `resolve`.
 */

/**
 * Per resource: the permission strings it needs (`permissions`, which also
 * validates the details), whether they are already held (`check`), and the
 * value once held (`resolve`). `pooled: false` marks a resource whose `check`
 * asks the server itself, so its strings stay out of the pooled read.
 *
 * @typedef {Object} PermsResourceHandler
 * @property {(query: {
 *     ctx: PermsContext;
 *     details: Record<string, unknown>;
 * }) => Promise<string[]>} permissions
 * @property {(query: PermsQuery) => Promise<boolean>} check
 * @property {(
 *     query: {
 *         ctx: PermsContext;
 *         details: Record<string, unknown>;
 *         scratch: Record<string, unknown>;
 *     },
 *     held: boolean,
 * ) => Promise<unknown>} resolve
 * @property {boolean} [pooled]
 */

/**
 * The supported resources. Prototype-free so a permission string that happens
 * to share a name with an `Object.prototype` member (`constructor`, `toString`)
 * is still read as the permission string it is.
 *
 * @type {Record<string, PermsResourceHandler>}
 */
const RESOURCES = Object.assign(Object.create(null), {
    fs: {
        permissions: async ({ ctx, details }) => {
            assertKnownFields(details, ['path', 'uid', 'access', 'create']);
            assertCreateKind(details.create);
            return [
                fsPermission(
                    await fsTargetOf(details, ctx.whoami),
                    accessOf(details),
                ),
            ];
        },
        // The server answers an app's own `fs:` check through ACL, so a
        // grant on a parent folder counts.
        check: async ({ permissions, holds }) => holds(permissions),
        resolve: async (_query, held) => held,
    },

    backgroundEvents: {
        permissions: async ({ details }) => {
            assertKnownFields(details, []);
            return [BACKGROUND_EVENTS_PERMISSION];
        },
        check: async ({ permissions, holds }) => holds(permissions),
        resolve: async (_query, held) => held,
    },

    kvShare: {
        permissions: async ({ ctx, details }) => {
            assertKnownFields(details, ['prefix', 'access']);
            return [
                kvShareRequestPermission(
                    ctx.puter,
                    await ctx.whoami(),
                    details,
                ),
            ];
        },
        check: async ({ permissions, holds }) => holds(permissions),
        resolve: async (_query, held) => held,
    },

    email: {
        permissions: async ({ ctx }) => [
            emailPermission((await ctx.whoami()).uuid),
        ],
        check: async ({ ctx, permissions, holds }) => {
            // The grant is what puts the field on `whoami`, so `null` is granted.
            if ((await ctx.whoami()).email !== undefined) return true;
            return holds(permissions);
        },
        resolve: async ({ ctx }, held) => {
            if (!held) return undefined;
            // Already there before the prompt, or released by it — one more
            // read only in the second case.
            const whoami = await ctx.whoami();
            if (whoami.email !== undefined) return whoami.email;
            return (await ctx.reread()).email;
        },
    },

    folder: {
        permissions: async ({ ctx, details }) => [
            fsPermission(
                folderPathFor(
                    (await ctx.whoami()).username,
                    folderNameOf(details),
                ),
                accessOf(details),
            ),
        ],
        check: async ({ ctx, details, permissions, holds }) => {
            if (accessOf(details) !== 'write') {
                const path = folderPathFor(
                    (await ctx.whoami()).username,
                    folderNameOf(details),
                );
                if (await folderReadable(ctx.puter, path)) return true;
            }
            return holds(permissions);
        },
        resolve: async ({ ctx, details }, held) => {
            if (!held) return undefined;
            return folderPathFor(
                (await ctx.whoami()).username,
                folderNameOf(details),
            );
        },
    },

    apps: {
        permissions: async ({ ctx, details }) => [
            appsPermission((await ctx.whoami()).uuid, accessOf(details)),
        ],
        check: async ({ permissions, holds }) => holds(permissions),
        resolve: async (_query, held) => held,
    },

    subdomains: {
        permissions: async ({ ctx, details }) => [
            subdomainsPermission((await ctx.whoami()).uuid, accessOf(details)),
        ],
        check: async ({ permissions, holds }) => holds(permissions),
        resolve: async (_query, held) => held,
    },

    appData: {
        permissions: ({ ctx, details }) =>
            appDataRequest(
                ctx.puter,
                /** @type {string} */ (details.app),
                /** @type {import('./types.js').AppDataScopes} */ (
                    details.scopes
                ),
            ),
        // An empty list is its own data, which it may always use.
        check: async ({ permissions, holds }) =>
            permissions.length === 0 || holds(permissions),
        resolve: async (_query, held) => held,
    },

    appRootDir: {
        permissions: async ({ details }) => [
            appRootDirPermission(appUidOf(details.app), accessOf(details)),
        ],
        // `app-root-dir:…` resolves to nothing in a permission scan, so only the
        // server can answer, and it stays out of the pooled read.
        pooled: false,
        check: async ({ ctx, details, prompt, scratch }) => {
            const appUid = appUidOf(details.app);
            const access = accessOf(details);
            // A check must not provision the directory just for asking.
            if (!prompt) {
                return await checkAppRootDir(ctx.puter, appUid, access);
            }
            // A request is going to claim it either way, so the claim is the
            // check — one round trip, as the shipped method has always made.
            const result = await statAppRootDir(ctx.puter, appUid, access);
            // Permanent, unlike a plain refusal a grant is about to lift.
            if (result.error && result.reason === 'app_mismatch') {
                throw new PuterJSError(
                    typeof result.message === 'string'
                        ? result.message
                        : 'Only the app itself may request its root dir',
                    'forbidden',
                    { permsUngrantable: true },
                );
            }
            if (result.error) return false;
            scratch.entry = result;
            return true;
        },
        // Only the server can name the directory. Already in hand when the
        // check claimed it; otherwise asked for now, riding out the cache lag
        // behind a fresh grant.
        resolve: async ({ ctx, details, scratch }, held) => {
            if (!held) return undefined;
            if (scratch.entry) return scratch.entry;
            return await pollAppRootDir(
                ctx.puter,
                appUidOf(details.app),
                accessOf(details),
            );
        },
    },

    permission: {
        permissions: async ({ details }) => permissionsOf(details),
        check: async ({ permissions, holds }) => holds(permissions),
        resolve: async (_query, held) => held,
    },
});

/** The resource names, for the "expected one of" in an unknown-resource error. */
const RESOURCE_NAMES = Object.keys(RESOURCES);

/** The resources whose details carry `create`. */
const CREATE_RESOURCES = new Set(['fs', 'permission']);

/**
 * Resolve a call to its resource, or to the legacy raw-permission form.
 *
 * A lone string naming no resource is a permission string: no resource name
 * contains a `:` and every permission string does, so neither can be mistaken
 * for the other. Details beside an unknown resource is a typo, and says so.
 *
 * @param {unknown} resource
 * @param {unknown} details
 * @returns {{ resource: string; details: Record<string, unknown> }}
 */
const singleEntry = (resource, details) => {
    if (typeof resource !== 'string' || resource === '') {
        throw invalidArgument('resource must be a non-empty string');
    }
    if (
        details !== undefined &&
        (typeof details !== 'object' ||
            details === null ||
            Array.isArray(details))
    ) {
        throw invalidArgument('details must be an object');
    }
    if (RESOURCES[resource]) {
        return {
            resource,
            details: /** @type {Record<string, unknown>} */ (details ?? {}),
        };
    }
    if (details !== undefined) {
        throw invalidArgument(
            `unknown resource: ${resource} (expected one of: ${RESOURCE_NAMES.join(', ')})`,
        );
    }
    return { resource: 'permission', details: { permission: resource } };
};

/**
 * Split a batch entry into its resource and its remaining fields. The resource
 * travels inside the object so one array can carry differently-shaped entries.
 *
 * @param {unknown} entry
 * @param {number} index
 * @returns {{ resource: string; details: Record<string, unknown> }}
 */
const batchEntry = (entry, index) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
        throw invalidArgument(`requests[${index}] must be an object`);
    }
    const { resource, ...details } = /** @type {Record<string, unknown>} */ (
        entry
    );
    if (typeof resource !== 'string' || resource === '') {
        throw invalidArgument(
            `requests[${index}].resource must be a non-empty string`,
        );
    }
    if (!RESOURCES[resource]) {
        throw invalidArgument(
            `requests[${index}]: unknown resource: ${resource} ` +
                `(expected one of: ${RESOURCE_NAMES.join(', ')})`,
        );
    }
    return { resource, details };
};

/**
 * One read of everything the call asks about, answered per entry. Made on the
 * first entry that needs it, so a resource that can settle on its own — an
 * email already on `whoami`, a folder it can stat — costs no round trip, and
 * read once however many entries then ask.
 *
 * @param {PermsContext} ctx
 * @param {string[]} permissions
 * @returns {(permissions: string[]) => Promise<boolean>}
 */
function pooledHolds(ctx, permissions) {
    const wanted = [...new Set(permissions)];
    /** @type {Promise<Record<string, boolean>> | undefined} */
    let pending;

    return async (needed) => {
        if (needed.length === 0 || wanted.length === 0) return false;
        const held = await (pending ??= checkPermissions(ctx.puter, wanted));
        return needed.every((name) => held[name] === true);
    };
}

/**
 * The one path behind `request` and `check`, and behind both their single and
 * array forms, so what a request prompts for and what a check reports can't
 * drift apart.
 *
 * @param {PermsContext} ctx
 * @param {{ resource: string; details: Record<string, unknown> }[]} entries
 * @param {boolean} prompt
 * @returns {Promise<unknown[]>}
 */
async function runEntries(ctx, entries, prompt) {
    // Resolved — and so validated — before anything is asked, so a bad entry
    // can't surface after a prompt has gone up for the rest.
    const permissions = await Promise.all(
        entries.map(({ resource, details }) =>
            RESOURCES[resource].permissions({ ctx, details }),
        ),
    );

    // One prompt is one decision, so at most one distinct `create` may cover
    // it. Checked here, still before anything is asked.
    const createValues = [
        ...new Set(
            entries
                .filter(({ resource }) => CREATE_RESOURCES.has(resource))
                .map(({ details }) => details.create)
                .filter((value) => value !== undefined),
        ),
    ];
    if (createValues.length > 1) {
        throw invalidArgument('conflicting `create` values in one request');
    }
    const create = createValues[0];

    const holds = pooledHolds(
        ctx,
        entries.flatMap(({ resource }, i) =>
            RESOURCES[resource].pooled === false ? [] : permissions[i],
        ),
    );

    // A check that couldn't be made is not a refusal. `request` has somewhere
    // to go with that — the prompt it would have raised anyway, which is what
    // it did before there was a check at all. `check` has nowhere to go, and
    // answering "not granted" would prompt someone who already granted it.
    /** Per entry, for whatever its `check` wants to hand to its `resolve`. */
    const scratch = entries.map(
        () => /** @type {Record<string, unknown>} */ ({}),
    );
    /** Entries whose refusal no grant could lift, so they never reach a prompt. */
    const ungrantable = entries.map(() => false);

    const held = await Promise.all(
        entries.map(async ({ resource, details }, i) => {
            try {
                return await RESOURCES[resource].check({
                    ctx,
                    details,
                    permissions: permissions[i],
                    holds,
                    prompt,
                    scratch: scratch[i],
                });
            } catch (e) {
                if (e?.permsUngrantable) {
                    ungrantable[i] = true;
                    return false;
                }
                if (!prompt) throw e;
                return false;
            }
        }),
    );
    if (!prompt) return held;

    const missing = [
        ...new Set(
            entries.flatMap((_entry, i) =>
                held[i] || ungrantable[i] ? [] : permissions[i],
            ),
        ),
    ];
    const granted =
        missing.length === 0
            ? true
            : await requestPermissions(ctx.puter, missing, create);

    return await Promise.all(
        entries.map(({ resource, details }, i) =>
            RESOURCES[resource].resolve(
                { ctx, details, scratch: scratch[i] },
                // An entry that named no permission asked nothing, so a grant
                // covering the others says nothing about it.
                !ungrantable[i] &&
                    (held[i] || (permissions[i].length > 0 && granted)),
            ),
        ),
    );
}

/**
 * @param {unknown} resource
 * @param {unknown} details
 * @returns {{ resource: string; details: Record<string, unknown> }[]}
 */
const entriesOf = (resource, details) => {
    if (!Array.isArray(resource)) return [singleEntry(resource, details)];
    if (details !== undefined) {
        throw invalidArgument('a batch takes no second argument');
    }
    return resource.map(batchEntry);
};

/**
 * @overload
 * @param {'fs'} resource
 * @param {import('./types.js').PermsFsRequest} details
 * @returns {Promise<boolean>}
 */
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
 * @param {'backgroundEvents'} resource
 * @returns {Promise<boolean>}
 */
/**
 * @overload
 * @param {'kvShare'} resource
 * @param {import('./types.js').PermsKvShareRequest} details
 * @returns {Promise<boolean>}
 */
/**
 * @overload
 * @deprecated Use the resource the permission string names, such as `'fs'`.
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
 * @deprecated Use the resource the permission string names, such as `'fs'`.
 * @param {string} permission
 * @returns {Promise<boolean>}
 */
/**
 * Ask the user for access, prompting only for what isn't already held. The
 * resource decides which details are taken and what resolves: `'folder'` gives
 * the path, `'email'` the address, `'appRootDir'` the directory, the rest a
 * boolean. Denied is always falsy. `puter.perms.Resource` and
 * `puter.perms.Access` name the accepted values.
 *
 *     await puter.perms.request(puter.perms.Resource.FS, {
 *         path: '~/Documents/notes.txt',
 *         access: puter.perms.Access.WRITE,
 *     });
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
export async function request(resource, details) {
    const entries = entriesOf(resource, details);
    const results = await runEntries(makeContext(this.puter), entries, true);
    return Array.isArray(resource) ? results : results[0];
}

/**
 * @overload
 * @param {'fs'} resource
 * @param {import('./types.js').PermsFsRequest} details
 * @returns {Promise<boolean>}
 */
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
 * @param {'backgroundEvents'} resource
 * @returns {Promise<boolean>}
 */
/**
 * @overload
 * @param {'kvShare'} resource
 * @param {import('./types.js').PermsKvShareRequest} details
 * @returns {Promise<boolean>}
 */
/**
 * @overload
 * @deprecated Use the resource the permission string names, such as `'fs'`.
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
 * @deprecated Use the resource the permission string names, such as `'fs'`.
 * @param {string} permission
 * @returns {Promise<boolean>}
 */
/**
 * Whether the access is already held, never prompting and never changing
 * anything. Takes the same resource and details as {@link request}, so an app
 * can offer an opt-in only where one is needed. A partly-granted set answers
 * `false` — the prompt is still needed.
 *
 *     if ( ! await puter.perms.check('folder', { name: 'Documents' }) ) ...
 *
 * The array form answers per entry, in order.
 *
 * @this {PermsModule}
 * @param {PermsResource | string | import('./types.js').PermsBatchEntry[]} resource
 * @param {PermsRequestDetails} [details]
 * @returns {Promise<boolean | boolean[]>}
 */
export async function check(resource, details) {
    const entries = entriesOf(resource, details);
    const held = /** @type {boolean[]} */ (
        await runEntries(makeContext(this.puter), entries, false)
    );
    return Array.isArray(resource) ? held : held[0];
}
