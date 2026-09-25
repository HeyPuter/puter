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

// -- GroupStore -------------------------------------------------------

/**
 * Membership writes for the persistent user groups.
 *
 * Groups themselves are seeded by migration (system, admin, user, temp,
 * moderator, developer) — nothing creates, reads back or lists one at runtime,
 * so the `jct_user_group` junction table is all this owns. Signup, OIDC and the
 * self-hosted admin bootstrap are the callers.
 *
 * Permissions attached to a group are read through PermissionStore instead,
 * which joins the junction table itself.
 */
export class GroupStore extends PuterStore {
    /** Adds users to a seeded system group. No-op for a team or a member. */
    async addUsers(uid: string, usernames: string[]): Promise<void> {
        if (usernames.length === 0) return;
        const placeholders = `(${usernames.map(() => '?').join(', ')})`;
        // Ignore conflicts on the unique pair index from 0072.
        await this.clients.db.write(
            `${this.clients.db.insertIgnoreInto('jct_user_group')} ` +
                '(`user_id`, `group_id`) ' +
                'SELECT u.id, g.id FROM `user` u ' +
                'JOIN (SELECT id FROM `group` WHERE uid = ? AND kind IS NULL) g ON 1 = 1 ' +
                `WHERE u.username IN ${placeholders}` +
                this.clients.db.insertIgnoreSuffix(),
            [uid, ...usernames],
        );
    }

    /** Removes users from a seeded system group. No-op for a team. */
    async removeUsers(uid: string, usernames: string[]): Promise<void> {
        if (usernames.length === 0) return;
        const placeholders = `(${usernames.map(() => '?').join(', ')})`;
        await this.clients.db.write(
            'DELETE FROM `jct_user_group` ' +
                'WHERE `group_id` = (SELECT id FROM `group` WHERE uid = ? AND kind IS NULL) ' +
                'AND `user_id` IN (' +
                'SELECT u.id FROM `user` u ' +
                `WHERE u.username IN ${placeholders})`,
            [uid, ...usernames],
        );
    }
}
