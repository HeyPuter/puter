import { PuterJSError } from '../../lib/PuterJSError.js';
import { invalidArgument } from './lib/validate.js';

/** @typedef {import('./index.js').PermsModule} PermsModule */
/** @typedef {import('./types.js').AppDataScopes} AppDataScopes */
/** @typedef {import('./types.js').AppDataKvScope} AppDataKvScope */
/** @typedef {import('./types.js').AppDataFsScope} AppDataFsScope */

// Mirrors `services/permission/appDataScopes.ts`, which stays authoritative.
// This copy only turns a typo into a useful error instead of an opaque 403.
const KV_CLASS_OPS = {
    read: ['get', 'list'],
    write: ['set', 'add', 'incr', 'decr', 'update'],
    delete: ['del', 'remove', 'expire', 'expireAt'],
};

const FS_CLASSES = ['read', 'write', 'delete'];

const KV_OPS = Object.values(KV_CLASS_OPS).flat();

/** Never grantable: it empties a whole namespace rather than touching entries. */
const KV_FORBIDDEN_OPS = ['flush'];

const APP_UID_RE =
    /^app-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const err = invalidArgument;

/**
 * Normalise one store's requested scopes into a deduped list of op or class
 * names, accepting a single string or an array.
 */
const toList = (value, store) => {
    if (value === undefined || value === null) return [];
    const list = Array.isArray(value) ? value : [value];
    for (const entry of list) {
        if (typeof entry !== 'string' || entry === '') {
            throw err(`${store} scopes must be non-empty strings`);
        }
        if (store === 'kv' && KV_FORBIDDEN_OPS.includes(entry)) {
            throw err(`kv:${entry} cannot be granted to another app`);
        }
        const known =
            store === 'kv'
                ? [...KV_OPS, ...Object.keys(KV_CLASS_OPS)]
                : FS_CLASSES;
        if (!known.includes(entry)) {
            throw err(`unknown ${store} scope: ${entry}`);
        }
    }
    return [...new Set(list)];
};

/**
 * Collapse a KV request to the fewest names covering it, but only when the
 * collapse is lossless — the requested ops must be exactly a class's full set.
 *
 * Collapsing `['get']` up to `read` would ask the user to approve `list` as
 * well, so a partial set stays spelled out: fewer dialog lines are not worth
 * granting more than the app asked for.
 */
const collapseKv = (requested) => {
    const wanted = new Set(requested);
    const classes = [];

    for (const [cls, ops] of Object.entries(KV_CLASS_OPS)) {
        if (wanted.has(cls)) {
            classes.push(cls);
            for (const op of ops) wanted.delete(op);
            wanted.delete(cls);
            continue;
        }
        if (ops.every((op) => wanted.has(op))) {
            classes.push(cls);
            for (const op of ops) wanted.delete(op);
        }
    }

    return [...classes, ...wanted];
};

/**
 * Build the permission strings for a request. Exported for the unit tests, which
 * assert the mapping without going near the IPC layer.
 *
 * @param {string} appUid
 * @param {{ kv?: AppDataKvScope | AppDataKvScope[], fs?: AppDataFsScope | AppDataFsScope[] }} scopes
 * @returns {string[]}
 */
export function appDataPermissions (appUid, scopes) {
    const kv = collapseKv(toList(scopes.kv, 'kv'));
    const fs = toList(scopes.fs, 'fs');
    if (kv.length === 0 && fs.length === 0) {
        throw err('at least one `kv` or `fs` scope is required');
    }

    // Both stores complete: one row covers the lot.
    const allKv = Object.keys(KV_CLASS_OPS).every((c) => kv.includes(c));
    const allFs = FS_CLASSES.every((c) => fs.includes(c));
    if (allKv && allFs) return [`app-data:${appUid}`];

    const out = [];
    if (allKv) out.push(`app-data:${appUid}:kv`);
    else for (const name of kv) out.push(`app-data:${appUid}:kv:${name}`);
    if (allFs) out.push(`app-data:${appUid}:fs`);
    else for (const name of fs) out.push(`app-data:${appUid}:fs:${name}`);

    // Sorted so an identical request yields an identical list — the dialog
    // de-duplicates concurrent prompts on it.
    return out.sort();
}

/** Expand the `'read' | 'write' | 'delete'` shorthand to both stores. */
const normaliseScopes = (scopes) => {
    if (typeof scopes === 'string') return { kv: scopes, fs: scopes };
    if (Array.isArray(scopes)) {
        const out = { kv: [], fs: [] };
        for (const entry of scopes) {
            if (typeof entry !== 'string' || !entry.includes(':')) {
                throw err(`scope must look like "kv:get" or "fs:read": ${entry}`);
            }
            const [store, name] = entry.split(':');
            // Explicit names, not `out[store]`: `toString` and friends are
            // truthy, so the push below would throw a TypeError instead.
            if (store !== 'kv' && store !== 'fs') {
                throw err(`unknown store: ${store}`);
            }
            out[store].push(name);
        }
        return out;
    }
    if (scopes && typeof scopes === 'object') return scopes;
    throw err('scopes must be a string, an array, or an object');
};

/**
 * The permission strings a cross-app data request needs, shared with `check`.
 *
 * @param {import('../../index.js').Puter} puter
 * @param {string | { uid: string } | { name: string }} appIdentifier
 * @param {AppDataScopes} scopes
 * @returns {Promise<string[]>} The permissions to ask for, or an empty list
 * when the request names this app's own data.
 */
export async function appDataRequest (puter, appIdentifier, scopes) {
    const identifier =
        typeof appIdentifier === 'object' && appIdentifier !== null
            ? (/** @type {{ uid?: string, name?: string }} */ (appIdentifier).uid ??
               /** @type {{ uid?: string, name?: string }} */ (appIdentifier).name)
            : appIdentifier;
    if (typeof identifier !== 'string' || identifier === '') {
        throw err('parameter appIdentifier must be a non-empty string');
    }

    // A uid is `app-` plus a UUID. The bare prefix would read an app *named*
    // `app-store` as a uid, and `puter.apps.get` resolves names only.
    const appUid = APP_UID_RE.test(identifier)
        ? identifier
        : (await puter.apps.get(identifier))?.uid;
    if (typeof appUid !== 'string' || appUid === '') {
        throw new PuterJSError(`app not found: ${identifier}`, 'not_found');
    }

    // Already allowed for its own data, so there is nothing to ask for.
    if (appUid === puter.appID) return [];

    return appDataPermissions(appUid, normaliseScopes(scopes));
}

/**
 * Ask the user to let this app use another app's KV namespace and AppData
 * directory. Scopes take a shorthand for both stores, `store:name` pairs, or a
 * per-store object. `delete` is separate from `write` and must be asked for.
 *
 *     await puter.perms.request('appData', { app: 'contacts', scopes: 'read' });
 *
 * @this {PermsModule}
 * @param {string | { uid: string } | { name: string }} appIdentifier
 * @param {AppDataScopes} scopes
 * @returns {Promise<boolean>} `true` if the app may now use that data.
 */
export async function requestAppData (appIdentifier, scopes) {
    const permissions = await appDataRequest(
        this.puter,
        appIdentifier,
        scopes,
    );
    if (permissions.length === 0) return true;
    return await this.puter.ui.requestPermission({ permissions });
}
