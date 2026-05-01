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

import { v4 as uuidv4 } from 'uuid';
import { PuterStore } from '../types';

/**
 * CRUD over the `share` table.
 *
 * Columns: id, uid (unique), issuer_user_id, recipient_email, data (JSON),
 * created_at.
 *
 * Shares are pending permission grants sent to an email address. Once
 * the recipient applies the share, the permissions are granted and the
 * row is deleted.
 */
export class ShareStore extends PuterStore {
    // ── Reads ────────────────────────────────────────────────────────

    async getByUid(uid) {
        const rows = await this.clients.db.read(
            'SELECT * FROM `share` WHERE `uid` = ? LIMIT 1',
            [uid],
        );
        return this.#normalizeRow(rows[0]) ?? null;
    }

    async listByRecipientEmail(email) {
        const rows = await this.clients.db.read(
            'SELECT * FROM `share` WHERE `recipient_email` = ? ORDER BY `created_at` DESC',
            [email],
        );
        return rows.map((r) => this.#normalizeRow(r));
    }

    async listByIssuer(issuerUserId) {
        const rows = await this.clients.db.read(
            'SELECT * FROM `share` WHERE `issuer_user_id` = ? ORDER BY `created_at` DESC',
            [issuerUserId],
        );
        return rows.map((r) => this.#normalizeRow(r));
    }

    // ── Writes ───────────────────────────────────────────────────────

    async create({ issuerUserId, recipientEmail, data }) {
        if (!issuerUserId || !recipientEmail) {
            throw new Error(
                'create: issuerUserId and recipientEmail are required',
            );
        }
        const uid = uuidv4();
        const serialized =
            typeof data === 'string' ? data : JSON.stringify(data ?? {});
        await this.clients.db.write(
            'INSERT INTO `share` (`uid`, `issuer_user_id`, `recipient_email`, `data`) VALUES (?, ?, ?, ?)',
            [uid, issuerUserId, recipientEmail, serialized],
        );
        return this.getByUid(uid);
    }

    async deleteByUid(uid) {
        const result = await this.clients.db.write(
            'DELETE FROM `share` WHERE `uid` = ?',
            [uid],
        );
        return (result?.affectedRows ?? result?.changes ?? 0) > 0;
    }

    async deleteByRecipientEmail(email) {
        const result = await this.clients.db.write(
            'DELETE FROM `share` WHERE `recipient_email` = ?',
            [email],
        );
        return (result?.affectedRows ?? result?.changes ?? 0) > 0;
    }

    // ── Internals ────────────────────────────────────────────────────

    #normalizeRow(row) {
        if (!row) return null;
        if (typeof row.data === 'string') {
            try {
                row.data = JSON.parse(row.data);
            } catch {
                /* keep string */
            }
        }
        return row;
    }
}
