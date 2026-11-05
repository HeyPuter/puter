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

import { v4 as uuidv4 } from 'uuid';
import type { PuterServer } from '../../server.js';
import { kvSharePermission } from './kvShares.js';

const SEED_CHUNK = 500;

/**
 * Insert `count` live handle rows straight into the table, many per statement,
 * so a test can fill a cap of thousands. Handles are unsigned placeholders:
 * they count toward quotas but don't resolve.
 */
export const seedKvShareHandles = async (
    server: PuterServer,
    seed: {
        ownerUserId: number;
        ownerUuid: string;
        granteeUserId: number;
        count: number;
        appUid: (i: number) => string;
        revokedAt?: number | null;
    },
): Promise<void> => {
    const now = Math.floor(Date.now() / 1000);
    for (let at = 0; at < seed.count; at += SEED_CHUNK) {
        const rows: unknown[][] = [];
        for (let i = at; i < Math.min(seed.count, at + SEED_CHUNK); i++) {
            const appUid = seed.appUid(i);
            const prefix = `seeded:${uuidv4()}:`;
            rows.push([
                `kvh-seed-${uuidv4()}`,
                seed.ownerUserId,
                seed.granteeUserId,
                appUid,
                prefix,
                kvSharePermission(seed.ownerUuid, appUid, prefix),
                now,
                seed.revokedAt ?? null,
            ]);
        }
        await server.clients.db.write(
            'INSERT INTO `kv_share_handles` (`handle`, `owner_user_id`, ' +
                '`grantee_user_id`, `app_uid`, `key_prefix`, `permission`, ' +
                '`created_at`, `revoked_at`) VALUES ' +
                rows.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(', '),
            rows.flat(),
        );
    }
};
