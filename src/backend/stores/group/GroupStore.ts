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

import { PuterStore } from '../types';

// -- Types ------------------------------------------------------------

export interface GroupRow {
    id: number;
    uid: string;
    owner_user_id: number;
    extra: Record<string, unknown>;
    metadata: Record<string, unknown>;
    [k: string]: unknown;
}

// -- GroupStore -------------------------------------------------------

/**
 * Persistence layer for persistent user groups.
 *
 * Reads the `group` table and maintains the `jct_user_group` junction table.
 * Groups themselves are seeded by migration (the default user, temp, admin and
 * moderator groups) — nothing creates one at runtime, so this owns membership
 * writes only.
 */
export class GroupStore extends PuterStore {
    // -- Reads --------------------------------------------------------

    async getByUid(uid: string): Promise<GroupRow | null> {
        const rows = await this.clients.db.read(
            'SELECT * FROM `group` WHERE `uid` = ? LIMIT 1',
            [uid],
        );
        return rows[0] ? this.#decodeGroup(rows[0]) : null;
    }

    // -- Writes -------------------------------------------------------

    /**
     * Adds users (by username) to the group identified by `uid`. No-op if
     * `usernames` is empty.
     */
    async addUsers(uid: string, usernames: string[]): Promise<void> {
        if (usernames.length === 0) return;
        const placeholders = `(${usernames.map(() => '?').join(', ')})`;
        await this.clients.db.write(
            'INSERT INTO `jct_user_group` (`user_id`, `group_id`) ' +
                'SELECT u.id, g.id FROM `user` u ' +
                'JOIN (SELECT id FROM `group` WHERE uid = ?) g ON 1 = 1 ' +
                `WHERE u.username IN ${placeholders}`,
            [uid, ...usernames],
        );
    }

    /**
     * Removes users (by username) from the group identified by `uid`. No-op if
     * `usernames` is empty.
     */
    async removeUsers(uid: string, usernames: string[]): Promise<void> {
        if (usernames.length === 0) return;
        const placeholders = `(${usernames.map(() => '?').join(', ')})`;
        await this.clients.db.write(
            'DELETE FROM `jct_user_group` ' +
                'WHERE `group_id` = (SELECT id FROM `group` WHERE uid = ?) ' +
                'AND `user_id` IN (' +
                'SELECT u.id FROM `user` u ' +
                `WHERE u.username IN ${placeholders})`,
            [uid, ...usernames],
        );
    }

    // -- Internals ----------------------------------------------------

    #decodeGroup(row: Record<string, unknown>): GroupRow {
        const parse = (v: unknown): Record<string, unknown> => {
            if (v == null) return {};
            if (typeof v === 'object') return v as Record<string, unknown>;
            try {
                return JSON.parse(String(v));
            } catch {
                return {};
            }
        };
        const extra = this.clients.db.case<() => Record<string, unknown>>({
            mysql: () => (row.extra as Record<string, unknown>) ?? {},
            otherwise: () => parse(row.extra),
        })();
        const metadata = this.clients.db.case<() => Record<string, unknown>>({
            mysql: () => (row.metadata as Record<string, unknown>) ?? {},
            otherwise: () => parse(row.metadata),
        })();
        return { ...row, extra, metadata } as unknown as GroupRow;
    }
}
