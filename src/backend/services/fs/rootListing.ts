/**
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

import type { Actor } from '../../core/actor.js';
import type { FSEntry } from '../../stores/fs/FSEntry.js';
import type { FSEntryStore } from '../../stores/fs/FSEntryStore.js';
import type { PermissionService } from '../permission/PermissionService.js';

/**
 * Synthesize the listing for the virtual root `/`. There is no fsentry row
 * at `/` — instead root is a virtual aggregate of user-directory entries
 * the actor can see: the actor's own home plus any other users' homes
 * granted via permission issuers (i.e. users that have shared something
 * with this actor). Mirrors v1's `LLListUsers`.
 */
export async function listRootEntries(
    actor: Actor,
    fsEntryStore: FSEntryStore,
    permissionService: PermissionService,
): Promise<FSEntry[]> {
    const entries: FSEntry[] = [];
    const seenPaths = new Set<string>();

    const pushByUsername = async (username: string | undefined) => {
        if (!username) return;
        const path = `/${username}`;
        if (seenPaths.has(path)) return;
        seenPaths.add(path);
        const entry = await fsEntryStore.getEntryByPath(path);
        if (entry) entries.push(entry);
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

    if (typeof userId === 'number') {
        const issuers = await permissionService.listUserPermissionIssuers({
            id: userId,
        });
        for (const issuer of issuers) {
            if (!issuer) continue;
            await pushByUsername(issuer.username);
        }
    }

    return entries;
}
