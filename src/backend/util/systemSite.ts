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

import type { FSEntry } from '../stores/fs/FSEntry.js';
import type { FSEntryStore } from '../stores/fs/FSEntryStore.js';
import type { SubdomainStore } from '../stores/subdomain/SubdomainStore.js';
import { isUniqueViolation } from './dbError.js';

/**
 * Ensure `dirPath` exists (created as `creatorUserId` if missing) and that
 * `subdomain` serves it. Idempotent.
 *
 * The site is registered to the directory's owner, not the creator: a missing
 * parent directory may already belong to another user, and the hosting
 * middleware refuses a site whose user doesn't own its root. A row registered
 * to anyone else, or pointing at another directory, is replaced.
 */
export async function ensureSystemSite(
    stores: { fsEntry: FSEntryStore; subdomain: SubdomainStore },
    {
        subdomain,
        dirPath,
        creatorUserId,
        isProtected = false,
    }: {
        subdomain: string;
        dirPath: string;
        creatorUserId: number;
        isProtected?: boolean;
    },
): Promise<FSEntry | null> {
    const dir =
        (await stores.fsEntry.getEntryByPath(dirPath)) ??
        (await stores.fsEntry.resolveParentDirectory(
            creatorUserId,
            dirPath,
            true,
        ));
    if (!dir) return null;

    // Primary read: the cache can hold a stale negative entry on first boot.
    const site = await stores.subdomain.getBySubdomain(subdomain, {
        primary: true,
    });
    if (
        site &&
        Number(site.user_id) === Number(dir.userId) &&
        Number(site.root_dir_id) === Number(dir.id)
    ) {
        return dir;
    }
    if (site) await stores.subdomain.deleteByUuid(site.uuid);

    // Runs concurrently on first boot; the unique constraint picks one row.
    try {
        await stores.subdomain.create({
            userId: dir.userId,
            subdomain,
            rootDirId: dir.id,
            isProtected,
        });
    } catch (e) {
        if (!isUniqueViolation(e)) throw e;
    }
    return dir;
}
