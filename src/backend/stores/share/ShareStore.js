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
import { encodeCursor, decodeCursor } from '../../util/pagination';
import { PuterStore } from '../types';

/** Default page size for `listByHolder`. */
const DEFAULT_HOLDER_PAGE_SIZE = 50;
const MAX_HOLDER_PAGE_SIZE = 200;

/**
 * CRUD over the `share` table.
 *
 * Columns: id, uid (unique), issuer_user_id, recipient_email, holder_user_id,
 * fsentry_id, mode, data (JSON), created_at, applied_at.
 *
 * The table carries two related things. A row with a `holder_user_id` is an
 * **active share** — the index that makes shares listable and ties them to an
 * fsentry so they die with the file. A row without one is a **pending invite**
 * to an email that has no account yet; claiming it fills in the holder rather
 * than deleting the row, so the share stays queryable afterwards.
 *
 * Permissions remain the source of truth for access. This is the index.
 */
export class ShareStore extends PuterStore {
    // -- Reads --------------------------------------------------------

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

    /**
     * Active shares held by a user, keyset-paginated. `id` is the tiebreaker,
     * so a row added mid-iteration can't shift earlier pages.
     *
     * Returns rows only; the caller hydrates fsentries (batched) and drops any
     * whose entry it can't resolve. Paths are deliberately not stored — a move
     * or rename would strand them.
     */
    async listByHolder(holderUserId, { limit, cursor } = {}) {
        const size = Math.min(
            Math.max(1, Math.floor(Number(limit) || DEFAULT_HOLDER_PAGE_SIZE)),
            MAX_HOLDER_PAGE_SIZE,
        );
        const decoded = decodeCursor(cursor, 'share cursor');
        const afterId = Number(decoded?.id ?? 0) || 0;

        // One extra row tells us whether another page exists.
        const rows = await this.clients.db.read(
            'SELECT * FROM `share` WHERE `holder_user_id` = ? AND `id` > ? ' +
                'ORDER BY `id` LIMIT ?',
            [holderUserId, afterId, size + 1],
        );

        const hasMore = rows.length > size;
        const items = (hasMore ? rows.slice(0, size) : rows).map((r) =>
            this.#normalizeRow(r),
        );
        const last = items[items.length - 1];
        return {
            items,
            cursor: hasMore && last ? encodeCursor({ id: last.id }) : undefined,
        };
    }

    /** Everyone with an active share on one node, whoever issued it. */
    async listByFsentry(fsentryId) {
        return this.listByFsentries([fsentryId]);
    }

    /** As above, across several nodes in one query. */
    async listByFsentries(fsentryIds) {
        if (fsentryIds.length === 0) return [];
        const placeholders = fsentryIds.map(() => '?').join(', ');
        const rows = await this.clients.db.read(
            `SELECT * FROM \`share\` WHERE \`fsentry_id\` IN (${placeholders}) ` +
                'AND `holder_user_id` IS NOT NULL ORDER BY `id`',
            fsentryIds,
        );
        return rows.map((r) => this.#normalizeRow(r));
    }

    /**
     * Every active share the holder has on any of `fsentryIds`. Used to find
     * which shared root an entry was reached through, in one round trip.
     */
    async listByHolderAndFsentries(holderUserId, fsentryIds) {
        if (fsentryIds.length === 0) return [];
        const placeholders = fsentryIds.map(() => '?').join(', ');
        const rows = await this.clients.db.read(
            `SELECT * FROM \`share\` WHERE \`holder_user_id\` = ? AND ` +
                `\`fsentry_id\` IN (${placeholders}) ORDER BY \`id\``,
            [holderUserId, ...fsentryIds],
        );
        return rows.map((r) => this.#normalizeRow(r));
    }

    /**
     * Active shares on a directory and everything beneath it. Walks by parent
     * linkage, not path prefix — `fsentries.path` is lazily backfilled and NULL
     * on old rows, so a LIKE would skip those descendants' shares.
     *
     * @param {number} fsentryId
     */
    async listByFsentrySubtree(fsentryId) {
        const rows = await this.clients.db.read(
            'WITH RECURSIVE `subtree`(`id`) AS (' +
                'SELECT `id` FROM `fsentries` WHERE `id` = ? ' +
                'UNION ALL ' +
                'SELECT `f`.`id` FROM `fsentries` `f` ' +
                'JOIN `subtree` `s` ON `f`.`parent_id` = `s`.`id`' +
                ') ' +
                'SELECT `share`.* FROM `share` ' +
                'JOIN `subtree` ON `share`.`fsentry_id` = `subtree`.`id` ' +
                'WHERE `share`.`holder_user_id` IS NOT NULL ' +
                'ORDER BY `share`.`id`',
            [fsentryId],
        );
        return rows.map((r) => this.#normalizeRow(r));
    }

    /**
     * Active shares on any of `fsentryIds` — a node plus its ancestors, which
     * the caller has already resolved to row ids.
     *
     * This sits behind every file-write event, so it must stay on
     * `idx_share_fsentry`: a plain `IN` does, whereas joining `fsentries` and
     * OR-ing a path match does not, and the optimizer falls back to a scan of
     * `share`.
     *
     * @param {number[]} fsentryIds
     */
    async listReaching(fsentryIds) {
        if (fsentryIds.length === 0) return [];
        const placeholders = fsentryIds.map(() => '?').join(', ');
        const rows = await this.clients.db.read(
            `SELECT * FROM \`share\` WHERE \`fsentry_id\` IN (${placeholders}) ` +
                'AND `holder_user_id` IS NOT NULL ORDER BY `id`',
            fsentryIds,
        );
        return rows.map((r) => this.#normalizeRow(r));
    }

    async countByHolder(holderUserId) {
        const rows = await this.clients.db.read(
            'SELECT COUNT(*) AS `count` FROM `share` WHERE `holder_user_id` = ?',
            [holderUserId],
        );
        return Number(rows[0]?.count ?? 0);
    }

    /**
     * Pending invites for one address: a share aimed at someone who had no
     * account when it was made. `fsentry_id` distinguishes these from the
     * legacy invite rows, which name no node.
     *
     * @param {string} recipientEmail
     */
    async listPendingByEmail(recipientEmail) {
        const rows = await this.clients.db.read(
            'SELECT * FROM `share` WHERE `recipient_email` = ? AND ' +
                '`holder_user_id` IS NULL AND `fsentry_id` IS NOT NULL ' +
                'ORDER BY `id`',
            [recipientEmail],
        );
        return rows.map((r) => this.#normalizeRow(r));
    }

    /**
     * Unclaimed invites on one node, whoever sent them. What someone managing
     * the node needs to see who has been asked but has not arrived.
     *
     * @param {number} fsentryId
     */
    async listPendingOnFsentry(fsentryId) {
        const rows = await this.clients.db.read(
            'SELECT * FROM `share` WHERE `fsentry_id` = ? AND ' +
                '`holder_user_id` IS NULL ORDER BY `id`',
            [fsentryId],
        );
        return rows.map((r) => this.#normalizeRow(r));
    }

    // -- Writes -------------------------------------------------------

    /**
     * Record an invite for an address with no account yet, or move an existing
     * one to a new mode.
     *
     * Deduped on (email, node, issuer) in code: the unique index covers
     * `holder_user_id`, which is NULL here, and SQL treats NULLs as distinct —
     * so re-inviting would otherwise pile up rows.
     *
     * `recipientEmail` is the canonical form claims match on; `displayEmail` is
     * what the sharer typed, kept for the dialog and nothing else.
     *
     * @param {object} input
     * @param {number} input.issuerUserId
     * @param {string} input.recipientEmail
     * @param {string} [input.displayEmail]
     * @param {number} input.fsentryId
     * @param {string} input.mode
     * @param {string | null} [input.issuerAppUid]
     */
    async upsertPending({
        issuerUserId,
        recipientEmail,
        displayEmail,
        fsentryId,
        mode,
        issuerAppUid = null,
    }) {
        if (!issuerUserId || !recipientEmail || !fsentryId || !mode) {
            throw new Error(
                'upsertPending: issuerUserId, recipientEmail, fsentryId and mode are required',
            );
        }

        const existing = await this.clients.db.read(
            'SELECT `uid` FROM `share` WHERE `recipient_email` = ? AND ' +
                '`fsentry_id` = ? AND `issuer_user_id` = ? AND ' +
                '`holder_user_id` IS NULL LIMIT 1',
            [recipientEmail, fsentryId, issuerUserId],
        );
        if (existing[0]?.uid) {
            await this.clients.db.write(
                'UPDATE `share` SET `mode` = ? WHERE `uid` = ?',
                [mode, existing[0].uid],
            );
            return {
                row: await this.getByUid(existing[0].uid),
                created: false,
            };
        }

        const uid = uuidv4();
        await this.clients.db.write(
            'INSERT INTO `share` (`uid`, `issuer_user_id`, `recipient_email`, ' +
                '`fsentry_id`, `mode`, `data`) VALUES (?, ?, ?, ?, ?, ?)',
            [
                uid,
                issuerUserId,
                recipientEmail,
                fsentryId,
                mode,
                JSON.stringify({
                    ...(issuerAppUid ? { issuerAppUid } : {}),
                    ...(displayEmail && displayEmail !== recipientEmail
                        ? { invitedAddress: displayEmail }
                        : {}),
                }),
            ],
        );
        return { row: await this.getByUid(uid), created: true };
    }

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

    /**
     * Record an active share, or move an existing one to a new mode. Keyed on
     * (holder, fsentry, issuer), so two people with manage rights keep their
     * own rows. One statement, so concurrent shares of the same triple settle
     * on one row rather than one of them failing the unique key.
     *
     * @param {object} input
     * @param {number} input.issuerUserId
     * @param {number} input.holderUserId
     * @param {number} input.fsentryId
     * @param {string} input.mode
     * @param {string | null} [input.recipientEmail]
     * @param {string | null} [input.issuerAppUid]
     */
    async upsertActive({
        issuerUserId,
        holderUserId,
        fsentryId,
        mode,
        recipientEmail = null,
        issuerAppUid = null,
    }) {
        if (!issuerUserId || !holderUserId || !fsentryId || !mode) {
            throw new Error(
                'upsertActive: issuerUserId, holderUserId, fsentryId and mode are required',
            );
        }

        // A share issued through an app is attributed to the user, because the
        // grant is theirs. `data` records which app asked for it, so the owner
        // can tell an app-issued share from one they made themselves.
        const data = JSON.stringify(
            issuerAppUid ? { issuedByApp: issuerAppUid } : {},
        );
        await this.clients.db.write(
            'INSERT INTO `share` (`uid`, `issuer_user_id`, `recipient_email`, ' +
                '`holder_user_id`, `fsentry_id`, `mode`, `data`, `applied_at`) ' +
                'VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP) ' +
                this.clients.db.upsertClause(
                    ['holder_user_id', 'fsentry_id', 'issuer_user_id'],
                    ['mode', 'data'],
                ),
            [
                uuidv4(),
                issuerUserId,
                recipientEmail ?? '',
                holderUserId,
                fsentryId,
                mode,
                data,
                mode,
                data,
            ],
        );
        return this.getActive({ holderUserId, fsentryId, issuerUserId });
    }

    /**
     * @param {object} input
     * @param {number} input.holderUserId
     * @param {number} input.fsentryId
     * @param {number} input.issuerUserId
     */
    async getActive({ holderUserId, fsentryId, issuerUserId }) {
        const rows = await this.clients.db.read(
            'SELECT * FROM `share` WHERE `holder_user_id` = ? AND ' +
                '`fsentry_id` = ? AND `issuer_user_id` = ? LIMIT 1',
            [holderUserId, fsentryId, issuerUserId],
        );
        return this.#normalizeRow(rows[0]) ?? null;
    }

    /**
     * Drop one active share. Omit `issuerUserId` to clear every issuer's share
     * of that node with that holder — what an owner revoking access wants.
     *
     * @param {object} input
     * @param {number} input.holderUserId
     * @param {number} input.fsentryId
     * @param {number | null} [input.issuerUserId]
     */
    async deleteActive({ holderUserId, fsentryId, issuerUserId = null }) {
        const scoped = issuerUserId !== null && issuerUserId !== undefined;
        const result = await this.clients.db.write(
            'DELETE FROM `share` WHERE `holder_user_id` = ? AND `fsentry_id` = ?' +
                (scoped ? ' AND `issuer_user_id` = ?' : ''),
            scoped
                ? [holderUserId, fsentryId, issuerUserId]
                : [holderUserId, fsentryId],
        );
        return (result?.affectedRows ?? result?.changes ?? 0) > 0;
    }

    /**
     * Claim a pending invite for the user who signed up. Updates rather than
     * deletes, so the share survives as an index row.
     *
     * @param {object} input
     * @param {string} input.uid
     * @param {number} input.holderUserId
     * @param {number | null} [input.fsentryId]
     * @param {string | null} [input.mode]
     */
    async applyPending({ uid, holderUserId, fsentryId = null, mode = null }) {
        if (!uid || !holderUserId) {
            throw new Error('applyPending: uid and holderUserId are required');
        }
        const result = await this.clients.db.write(
            'UPDATE `share` SET `holder_user_id` = ?, `applied_at` = CURRENT_TIMESTAMP' +
                (fsentryId === null ? '' : ', `fsentry_id` = ?') +
                (mode === null ? '' : ', `mode` = ?') +
                ' WHERE `uid` = ? AND `holder_user_id` IS NULL',
            [
                holderUserId,
                ...(fsentryId === null ? [] : [fsentryId]),
                ...(mode === null ? [] : [mode]),
                uid,
            ],
        );
        if ((result?.affectedRows ?? result?.changes ?? 0) === 0) return null;
        return this.getByUid(uid);
    }

    /**
     * Drop every active share on any of `fsentryIds`. Used when a node changes
     * hands: the fsentry survives, so the delete cascade that normally retires
     * its shares never fires.
     *
     * @param {number[]} fsentryIds
     */
    async deleteByFsentryIds(fsentryIds) {
        if (fsentryIds.length === 0) return 0;
        const placeholders = fsentryIds.map(() => '?').join(', ');
        const result = await this.clients.db.write(
            `DELETE FROM \`share\` WHERE \`fsentry_id\` IN (${placeholders})`,
            fsentryIds,
        );
        return result?.affectedRows ?? result?.changes ?? 0;
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

    // -- Daily quota --------------------------------------------------
    // Counted in KV, not by querying `share`: the ceiling is on shares
    // *created*, so a COUNT of live rows would let a revoke recycle the slot.

    /** @param {number} userId */
    async getDailyShareCount(userId) {
        const { res } = await this.stores.kv.get({
            key: this.#dailyQuotaKey(userId),
        });
        const count = /** @type {{ count?: unknown } | null} */ (res)?.count;
        return typeof count === 'number' ? count : 0;
    }

    /**
     * @param {number} userId
     * @param {number} [amount]
     * @returns {Promise<number>} The count after incrementing
     */
    async incrementDailyShareCount(userId, amount = 1) {
        const { res } = await this.stores.kv.incr({
            key: this.#dailyQuotaKey(userId),
            pathAndAmountMap: { count: amount },
            // Two days, so a counter written just before midnight still ages
            // out on its own.
            expireAt: Math.floor(Date.now() / 1000) + 2 * 24 * 60 * 60,
        });
        const count = /** @type {{ count?: unknown } | null} */ (res)?.count;
        return typeof count === 'number' ? count : amount;
    }

    /** @param {number} userId */
    #dailyQuotaKey(userId) {
        const day = new Date().toISOString().slice(0, 10);
        return `share:quota:${userId}:${day}`;
    }

    // -- Internals ----------------------------------------------------

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
