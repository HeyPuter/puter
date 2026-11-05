/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { validate as validateUuid } from 'uuid';
import type { FSEntry } from '../../stores/fs/FSEntry';
import type { FSEntryStore } from '../../stores/fs/FSEntryStore';
import { PermissionUtil } from './permissionUtil';

/** Root of the cross-app application-data permission namespace. */
export const APP_DATA_PERMISSION_PREFIX = 'app-data';
export type AppDataStore = 'kv' | 'fs';

/**
 * Access classes a grant may be written at. Coarser than a concrete op, so a
 * single `…:kv:read` row covers `get` and `list`.
 *
 * Each class implies the ones below it: `delete` > `write` > `read`. An app
 * can't remove an entry it may not see or change, so `delete` carries both;
 * `write` still never reaches a deletion. Coarser grants (`app-data:X:kv`,
 * `app-data:X`) cover all three by prefix implication, which is why the consent
 * dialog has to name deletion whenever it prompts for one.
 */
export const APP_DATA_CLASSES = ['read', 'write', 'delete'] as const;
export type AppDataClass = (typeof APP_DATA_CLASSES)[number];

/** KV operations another app may be granted. */
export const APP_DATA_KV_OPS = [
    'get',
    'list',
    'set',
    'add',
    'incr',
    'decr',
    'update',
    'del',
    'remove',
    'expire',
    'expireAt',
] as const;
export type AppDataKvOp = (typeof APP_DATA_KV_OPS)[number];

/**
 * Parameters that turn a write into a deletion: both set an expiry, and an
 * expiry in the past makes the key vanish (the store filters it out on read and
 * DynamoDB reaps it later). A cross-app call carrying either one therefore
 * needs the `delete` class, not just `write` — otherwise `kv:set` alone would
 * be a delete capability under another name.
 */
export const APP_DATA_KV_TTL_PARAMS = ['expireAt', 'ttl'] as const;

/** Classes that satisfy a concrete op. Drives the exploder. */
export const APP_DATA_KV_OP_CLASSES: Record<
    AppDataKvOp,
    readonly AppDataClass[]
> = {
    get: ['read', 'write', 'delete'],
    list: ['read', 'write', 'delete'],
    set: ['write', 'delete'],
    add: ['write', 'delete'],
    incr: ['write', 'delete'],
    decr: ['write', 'delete'],
    update: ['write', 'delete'],
    del: ['delete'],
    remove: ['delete'],
    expire: ['delete'],
    expireAt: ['delete'],
};

/**
 * ACL fs mode → the class that covers it.
 *
 * `delete` is not an ACL mode: delete, move, and rename all ask ACL for
 * `write`, so it cannot tell them apart. That class is supplied by the
 * destructive guard on `remove`/`move`/`rename` instead.
 */
export const APP_DATA_FS_MODE_CLASSES = {
    see: 'read',
    list: 'read',
    read: 'read',
    write: 'write',
    delete: 'delete',
} as const;

/**
 * Driver method → the op it is checked as, or `null` for methods that must
 * never reach another app's namespace. Every public method on KVStoreDriver
 * appears here; a method missing from this map fails closed at the call site.
 */
export const APP_DATA_KV_METHOD_OPS: Record<string, AppDataKvOp | null> = {
    get: 'get',
    list: 'list',
    set: 'set',
    batchPut: 'set',
    add: 'add',
    incr: 'incr',
    decr: 'decr',
    update: 'update',
    del: 'del',
    remove: 'remove',
    expire: 'expire',
    expireAt: 'expireAt',
    flush: null,
};

/**
 * Builds a permission string, omitting trailing components so callers can name
 * a whole store (`app-data:<uid>:kv`) or the whole app (`app-data:<uid>`).
 */
export const appDataPermission = (
    targetAppUid: string,
    store?: AppDataStore,
    op?: string,
): string =>
    PermissionUtil.join(
        ...[APP_DATA_PERMISSION_PREFIX, targetAppUid, store, op].filter(
            (part): part is string => Boolean(part),
        ),
    );

/**
 * Parse a cross-app data permission, or `null` if it isn't one.
 *
 * Rejects a bare `app-data` (no target): prefix implication would make that one
 * row cover every app the user has, which no consent prompt can describe.
 */
export const parseAppDataPermission = (
    permission: string,
): { targetAppUid: string; store?: string; op?: string } | null => {
    if (!permission.startsWith(`${APP_DATA_PERMISSION_PREFIX}:`)) return null;
    const [, targetAppUid, store, op] = PermissionUtil.split(permission);
    if (!targetAppUid) return null;
    return { targetAppUid, store, op };
};

/**
 * The app whose `/<username>/AppData/<appUid>` subtree `path` sits in, under
 * any user, or null. `AppData` matches case-insensitively, like the column.
 * Only an `app-<uuid>` name counts: any other folder there belongs to no app,
 * and looking it up would only miss (or, outside latin1, fail the query).
 */
export const appDataOwnerOf = (path: string): string | null => {
    const segments = path.split('/');
    if (segments[2]?.toLowerCase() !== 'appdata') return null;
    const appUid = segments[3] ?? '';
    return /^app-/i.test(appUid) && validateUuid(appUid.slice(4))
        ? appUid
        : null;
};

/**
 * Whether `app` lets other apps reach its per-user data.
 *
 * Opt-**out**: only an explicit `share_app_data: false` closes it, so an app
 * with no metadata — which is every app written before this existed — stays
 * shareable. An app that keeps third-party tokens or entitlements in its KV
 * namespace or AppData directory sets the flag to exclude itself; user consent
 * alone is otherwise the gate.
 *
 * `AppStore` parses the `metadata` column into an object, or `null` when the
 * stored JSON is malformed. Absent, `null`, and non-object metadata all read as
 * allowed: this decides whether a feature is available, not whether access is
 * authorized, so it must not fail closed on a row it cannot interpret.
 */
export const appDataSharingAllowed = (app: { metadata?: unknown }): boolean => {
    const metadata = app.metadata;
    if (!metadata || typeof metadata !== 'object') return true;
    return (metadata as { share_app_data?: unknown }).share_app_data !== false;
};

type AppLookup = {
    getByUids(
        uids: string[],
    ): Promise<Map<string, { uid: string; metadata?: unknown }>>;
};

/**
 * Lowercased uids of the apps, other than `ownAppUid`, whose AppData holds one
 * of `paths` and that keep it closed. Reads nothing unless a path is in another
 * app's AppData.
 */
export const closedAppDataOwners = async (
    apps: AppLookup,
    paths: Iterable<string>,
    ownAppUid: string,
): Promise<Set<string>> => {
    const own = ownAppUid.toLowerCase();
    const owners = new Set<string>();
    for (const path of paths) {
        const uid = appDataOwnerOf(path)?.toLowerCase();
        if (uid && uid !== own) owners.add(uid);
    }
    if (owners.size === 0) return owners;
    const rows = await apps.getByUids([...owners]);
    return new Set(
        [...rows.values()]
            .filter((app) => !appDataSharingAllowed(app))
            .map((app) => app.uid.toLowerCase()),
    );
};

const APP_DATA_PAGE_SIZE = 1000;

/**
 * Whether `folder` is a home or `AppData` folder holding the AppData of an app
 * other than `ownAppUid` that keeps it closed. Copying, moving or sharing such
 * a folder hands that data on past the opt-out. Anything else answers false
 * without a read.
 */
export const carriesClosedAppData = async (
    stores: {
        fsEntry: Pick<FSEntryStore, 'getEntryByPath' | 'listChildrenOfParents'>;
        app: AppLookup;
    },
    folder: FSEntry,
    ownAppUid: string,
): Promise<boolean> => {
    if (!folder.isDir) return false;
    const segments = folder.path.split('/');
    const isHome = segments.length === 2 && segments[1] !== '';
    const isAppData =
        segments.length === 3 && segments[2]!.toLowerCase() === 'appdata';
    if (!isHome && !isAppData) return false;

    const appData = isAppData
        ? folder
        : await stores.fsEntry.getEntryByPath(`${folder.path}/AppData`);
    if (!appData) return false;
    let after: FSEntry | undefined;
    for (;;) {
        const page = await stores.fsEntry.listChildrenOfParents([appData], {
            limit: APP_DATA_PAGE_SIZE,
            after,
        });
        const closed = await closedAppDataOwners(
            stores.app,
            page.map((entry) => entry.path),
            ownAppUid,
        );
        if (closed.size > 0) return true;
        if (page.length < APP_DATA_PAGE_SIZE) return false;
        after = page[page.length - 1];
    }
};
