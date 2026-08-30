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

import { mintKvHandleId } from '../../services/events/kvShares.js';
import { PuterStore } from '../types.js';

/**
 * Opaque names for shared regions of a user's key-value namespace.
 *
 * A handle is an addressing alias, not an authorization: the user-to-user grant
 * it mirrors is what any check actually reads. What the row adds is a name the
 * grantee can use that says nothing about who the owner is, and a record the
 * owner can audit — which is why revoking marks rather than deletes.
 */

const TABLE = 'kv_share_handles';

export interface KvShareHandle {
    handle: string;
    ownerUserId: number;
    granteeUserId: number;
    appUid: string;
    /** The granted root, ending on the key delimiter. */
    keyPrefix: string;
    /** The user-to-user grant this handle mirrors. */
    permission: string;
    createdAt: number;
    revokedAt: number | null;
}

export interface MintKvShareHandleInput {
    ownerUserId: number;
    granteeUserId: number;
    appUid: string;
    keyPrefix: string;
    permission: string;
}

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

const toRow = (row: Record<string, unknown>): KvShareHandle => ({
    handle: String(row.handle),
    ownerUserId: Number(row.owner_user_id),
    granteeUserId: Number(row.grantee_user_id),
    appUid: String(row.app_uid),
    keyPrefix: String(row.key_prefix),
    permission: String(row.permission),
    createdAt: Number(row.created_at) || 0,
    revokedAt: row.revoked_at === null ? null : Number(row.revoked_at),
});

const SELECT_COLUMNS =
    '`handle`, `owner_user_id`, `grantee_user_id`, `app_uid`, ' +
    '`key_prefix`, `permission`, `created_at`, `revoked_at`';

export class KvShareHandleStore extends PuterStore {
    async mint(input: MintKvShareHandleInput): Promise<KvShareHandle> {
        const row: KvShareHandle = {
            handle: mintKvHandleId(),
            ownerUserId: input.ownerUserId,
            granteeUserId: input.granteeUserId,
            appUid: input.appUid,
            keyPrefix: input.keyPrefix,
            permission: input.permission,
            createdAt: nowSeconds(),
            revokedAt: null,
        };
        await this.clients.db.insert(TABLE, {
            handle: row.handle,
            owner_user_id: row.ownerUserId,
            grantee_user_id: row.granteeUserId,
            app_uid: row.appUid,
            key_prefix: row.keyPrefix,
            permission: row.permission,
            created_at: row.createdAt,
            revoked_at: null,
        });
        return row;
    }

    /** Live handles this owner is holding out, for the per-account ceiling. */
    async countLiveForOwner(ownerUserId: number): Promise<number> {
        const [row] = await this.clients.db.pread(
            `SELECT COUNT(*) AS \`total\` FROM \`${TABLE}\` ` +
                'WHERE `owner_user_id` = ? AND `revoked_at` IS NULL',
            [ownerUserId],
        );
        return Number(row?.total ?? 0);
    }

    /**
     * One handle by name. Primary: this is what a subscribe resolves against,
     * and a replica a moment behind would report a handle that was just minted
     * as absent, or a revoked one as live.
     */
    async getByHandle(handle: string): Promise<KvShareHandle | null> {
        const rows = await this.clients.db.pread(
            `SELECT ${SELECT_COLUMNS} FROM \`${TABLE}\` WHERE \`handle\` = ?`,
            [handle],
        );
        return rows.length > 0 ? toRow(rows[0]) : null;
    }
}
