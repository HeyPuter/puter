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

/** One row of `user_block`. `created_at` is unix seconds. */
export interface UserBlockRow {
    id: number;
    blocker_user_id: number;
    blocked_user_id: number;
    created_at: number;
}

/**
 * Persistence for one user refusing contact from another (`user_block`).
 *
 * Both queries stay on `idx_user_block_pair`, since the check runs on the share
 * path. Uncached: a block has to bite immediately, and one indexed lookup per
 * share isn't worth trading that for.
 */
export class UserBlockStore extends PuterStore {
    // -- Reads --------------------------------------------------------

    /** Whether `blockerUserId` refuses shares from `blockedUserId`. */
    async isBlocked(
        blockerUserId: number,
        blockedUserId: number,
    ): Promise<boolean> {
        const rows = await this.clients.db.read(
            'SELECT 1 AS hit FROM `user_block` WHERE `blocker_user_id` = ? AND `blocked_user_id` = ? LIMIT 1',
            [blockerUserId, blockedUserId],
        );
        return rows.length > 0;
    }

    /** Everyone `blockerUserId` has blocked, most recent first. */
    async listByBlocker(blockerUserId: number): Promise<UserBlockRow[]> {
        const rows = await this.clients.db.read(
            'SELECT * FROM `user_block` WHERE `blocker_user_id` = ? ORDER BY `id` DESC',
            [blockerUserId],
        );
        return rows as unknown as UserBlockRow[];
    }

    // -- Writes -------------------------------------------------------

    /** Idempotent. Returns whether this call is what created the block. */
    async create(
        blockerUserId: number,
        blockedUserId: number,
    ): Promise<boolean> {
        if (await this.isBlocked(blockerUserId, blockedUserId)) return false;
        try {
            await this.clients.db.write(
                'INSERT INTO `user_block` (`blocker_user_id`, `blocked_user_id`, `created_at`) VALUES (?, ?, ?)',
                [blockerUserId, blockedUserId, Math.floor(Date.now() / 1000)],
            );
            return true;
        } catch (err) {
            // Two clicks can race past the check above; the unique index
            // decides, and losing that race is the outcome the caller wanted.
            if (await this.isBlocked(blockerUserId, blockedUserId))
                return false;
            throw err;
        }
    }

    /** Lift a block. Returns whether there was one to lift. */
    async deleteByPair(
        blockerUserId: number,
        blockedUserId: number,
    ): Promise<boolean> {
        const result = await this.clients.db.write(
            'DELETE FROM `user_block` WHERE `blocker_user_id` = ? AND `blocked_user_id` = ?',
            [blockerUserId, blockedUserId],
        );
        return (
            ((result as { affectedRows?: number; changes?: number })
                ?.affectedRows ??
                (result as { changes?: number })?.changes ??
                0) > 0
        );
    }
}
