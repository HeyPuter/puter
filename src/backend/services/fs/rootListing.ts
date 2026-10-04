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

import { posix as pathPosix } from 'node:path';
import {
    isAccessTokenActor,
    isAccountContext,
    type Actor,
} from '../../core/actor.js';
import type { FSEntry } from '../../stores/fs/FSEntry.js';
import type { FSEntryStore } from '../../stores/fs/FSEntryStore.js';
import type { PermissionStore } from '../../stores/permission/PermissionStore.js';
import type { AclMode, ACLService } from '../acl/ACLService.js';

/**
 * Synthesize the listing for the virtual root `/`. There is no fsentry row at
 * `/` — root stands in for the actor's own home.
 *
 * Issuer homes are deliberately absent: a grant on a file says nothing about
 * its ancestors, so listing them advertised folders `readdir` then refused to
 * open. Shares are reached through the sharing API instead. For the same reason
 * a scoped access token sees its own home only when it can list it.
 */
export async function listRootEntries(
    actor: Actor,
    fsEntryStore: FSEntryStore,
    aclService: ACLService,
    permissionStore: PermissionStore,
): Promise<FSEntry[]> {
    const entries: FSEntry[] = [];
    const seenPaths = new Set<string>();

    const pushByUsername = async (username: string | undefined) => {
        if (!username) return;
        const path = `/${username}`;
        if (seenPaths.has(path)) return;
        seenPaths.add(path);
        const entry = await fsEntryStore.getEntryByPath(path);
        // Only the actor's own row: if the heal couldn't claim this path,
        // whoever holds it is someone else.
        if (entry && entry.userId === actor.user.id) entries.push(entry);
    };

    // For the actor's own home, heal first: a user whose home drifted
    // (stale path after a rename that never cascaded, or legacy rows
    // that were never path-populated) would otherwise be invisible to a
    // `getEntryByPath('/{username}')` lookup. `renameUserHome` is a
    // cheap no-op when the root already matches.
    const userId = actor.user.id;
    if (typeof userId === 'number' && actor.user.username) {
        try {
            const healed = await fsEntryStore.renameUserHome(
                userId,
                actor.user.username,
            );
            if (healed) {
                seenPaths.add(healed.path);
                entries.push(healed);
            }
        } catch {
            // Fall through to the path-based lookup below.
        }
    }

    await pushByUsername(actor.user.username);

    const shown: FSEntry[] = [];
    for (const entry of entries) {
        if (
            await rootShowsHome(
                actor,
                entry,
                'list',
                aclService,
                permissionStore,
            )
        ) {
            shown.push(entry);
        }
    }
    return shown;
}

/**
 * Whether a root listing may show the actor's home. Only a scoped access token
 * is checked, against its own grants on the home in one read. The issuer needs
 * no check: it is the owner or an app acting for them, and root shows the home
 * to both.
 */
export async function rootShowsHome(
    actor: Actor,
    home: Pick<FSEntry, 'uuid'>,
    mode: AclMode,
    aclService: ACLService,
    permissionStore: PermissionStore,
): Promise<boolean> {
    if (!isAccessTokenActor(actor) || isAccountContext(actor)) return true;
    return permissionStore.hasAnyAccessTokenPerm(
        actor.accessToken!.uid,
        aclService.permissionsFor(home.uuid, mode),
    );
}

/**
 * The `parentUid` to publish for `entry`. Nulled when the parent is the
 * issuer's own home and the access token behind this response can't list it —
 * otherwise the uuid alone would name a home that `rootShowsHome` keeps out of
 * root listings. A direct child of anything else returns its own `parentUid`
 * without a lookup.
 */
export async function clientParentUid(
    actor: Actor,
    entry: Pick<FSEntry, 'path' | 'parentUid'>,
    aclService: ACLService,
    permissionStore: PermissionStore,
): Promise<string | null> {
    const parentUid = entry.parentUid ?? null;
    if (
        !parentUid ||
        !isAccessTokenActor(actor) ||
        isAccountContext(actor) ||
        !actor.user.username ||
        pathPosix.dirname(entry.path) !== `/${actor.user.username}`
    ) {
        return parentUid;
    }
    const visible = await rootShowsHome(
        actor,
        { uuid: parentUid },
        'list',
        aclService,
        permissionStore,
    );
    return visible ? parentUid : null;
}
