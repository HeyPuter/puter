import { PuterJSError } from '../../lib/PuterJSError.js';

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

const err = (message) => new PuterJSError(message, 'invalid_argument');

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
 * Ask the user to let this app use another app's data — its KV namespace and its
 * AppData directory.
 *
 * The target may be named by uid or by registered app name. Scopes accept a
 * shorthand applying to both stores, explicit `store:name` pairs, or a per-store
 * object:
 *
 *     await puter.perms.requestAppData('contacts', 'read');
 *     await puter.perms.requestAppData('contacts', ['kv:get', 'fs:read']);
 *     await puter.perms.requestAppData('contacts', { kv: ['get', 'set'], fs: 'read' });
 *
 * Deleting entries is a separate scope from writing them, so an app that only
 * adds data cannot remove any: request `delete` explicitly when it needs to.
 *
 * @this {PermsModule}
 * @param {string | { uid: string } | { name: string }} appIdentifier
 * @param {AppDataScopes} scopes
 * @returns {Promise<boolean>} `true` if the app may now use that data.
 */
export async function requestAppData (appIdentifier, scopes) {
    const identifier =
        typeof appIdentifier === 'object' && appIdentifier !== null
            ? (appIdentifier.uid ?? appIdentifier.name)
            : appIdentifier;
    if (typeof identifier !== 'string' || identifier === '') {
        throw err('parameter appIdentifier must be a non-empty string');
    }

    // A uid is `app-` plus a UUID. The bare prefix would read an app *named*
    // `app-store` as a uid, and `puter.apps.get` resolves names only.
    const appUid = APP_UID_RE.test(identifier)
        ? identifier
        : (await this.puter.apps.get(identifier))?.uid;
    if (typeof appUid !== 'string' || appUid === '') {
        throw new PuterJSError(`app not found: ${identifier}`, 'not_found');
    }

    // Already true for its own data, so prompting would ask for nothing.
    if (appUid === this.puter.appID) return true;

    const permissions = appDataPermissions(appUid, normaliseScopes(scopes));
    return await this.puter.ui.requestPermission({ permissions });
}
