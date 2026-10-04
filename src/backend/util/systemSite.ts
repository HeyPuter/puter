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

import { SYSTEM_ACTOR_UUID } from '../core/actor.js';
import type { FSEntry } from '../stores/fs/FSEntry.js';
import type { FSEntryStore } from '../stores/fs/FSEntryStore.js';
import type { SubdomainStore } from '../stores/subdomain/SubdomainStore.js';
import type { UserStore } from '../stores/user/UserStore.js';
import { isUniqueViolation } from './dbError.js';

/**
 * Ensure `dirPath` and every directory above it exist and belong to the system
 * user, and that `subdomain` serves `dirPath` as the system user. Directories
 * another account created are re-owned, and a site row registered to anyone
 * else or pointing elsewhere is replaced — the hosting middleware won't serve a
 * site whose user doesn't own its root. Idempotent.
 *
 * Returns the system user's id (the account to write the site's files as), or
 * null if there is no system user.
 */
export async function ensureSystemSite(
    stores: {
        fsEntry: FSEntryStore;
        subdomain: SubdomainStore;
        user: UserStore;
    },
    {
        subdomain,
        dirPath,
        isProtected = false,
    }: {
        subdomain: string;
        dirPath: string;
        isProtected?: boolean;
    },
): Promise<number | null> {
    const systemUser = await stores.user.getByUuid(SYSTEM_ACTOR_UUID);
    if (!systemUser) return null;
    const systemUserId = Number(systemUser.id);

    const segments = dirPath.split('/').filter(Boolean);
    let dir: FSEntry | null = null;
    for (let i = 1; i <= segments.length; i++) {
        const path = `/${segments.slice(0, i).join('/')}`;
        dir = await stores.fsEntry.resolveParentDirectory(
            systemUserId,
            path,
            true,
        );
        if (Number(dir.userId) !== systemUserId) {
            dir = await stores.fsEntry.updateEntry(dir.uuid, {
                userId: systemUserId,
            });
        }
    }
    if (!dir) return null;

    // Primary read: the cache can hold a stale negative entry on first boot.
    const site = await stores.subdomain.getBySubdomain(subdomain, {
        primary: true,
    });
    if (
        site &&
        Number(site.user_id) === systemUserId &&
        Number(site.root_dir_id) === Number(dir.id)
    ) {
        return systemUserId;
    }
    if (site) await stores.subdomain.deleteByUuid(site.uuid);

    // Concurrent boots can race here; the unique constraint picks one row.
    try {
        await stores.subdomain.create({
            userId: systemUserId,
            subdomain,
            rootDirId: dir.id,
            isProtected,
        });
    } catch (e) {
        if (!isUniqueViolation(e)) throw e;
    }
    return systemUserId;
}
