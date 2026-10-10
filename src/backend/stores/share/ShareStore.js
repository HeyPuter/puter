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
import { HttpError } from '../../core/http/HttpError.js';
import { decodeCursor, keysetPage, openIdCursor } from '../../util/pagination';
import { escapeLike } from '../../util/sqlLike';
import { PuterStore } from '../types';

/** Default page size for the keyset listings. */
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

/** Ids per `IN` list in `getSharedFsentryIds`; a listing can run to thousands. */
const SHARED_IDS_CHUNK_SIZE = 1000;

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
 * Permissions remain the source of truth for access. This is the index — with
 * one exception: a row with `anyone` = 1 ("anyone with the link") has no holder
 * and no permission behind it, and is itself what the ACL reads.
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

    /**
     * Active shares held by a user, keyset-paginated. `id` is the tiebreaker,
     * so a row added mid-iteration can't shift earlier pages.
     *
     * Returns rows only; the caller hydrates fsentries (batched) and drops any
     * whose entry it can't resolve. Paths are deliberately not stored — a move
     * or rename would strand them.
     *
     * @param {number} holderUserId
     * @param {{ limit?: number; cursor?: string; groupIds?: number[] }} [opts]
     */
    async listByHolder(holderUserId, { limit, cursor, groupIds = [] } = {}) {
        const size = this.#pageSize(limit);
        const afterId = this.#afterId(cursor);
        const groups = [...new Set(groupIds)].filter(Boolean);

        // Same keyset page: `ORDER BY id` holds whatever the holder is. A
        // per-sender block deliberately does not apply here — a team share is
        // the team's, not one colleague's to withhold from another.
        const holderClause = groups.length
            ? `(\`holder_user_id\` = ? OR \`holder_group_id\` IN (${groups
                  .map(() => '?')
                  .join(', ')}))`
            : '`holder_user_id` = ?';
        const holderParams = [holderUserId, ...groups];

        // One extra row tells us whether another page exists.
        const rows = await this.clients.db.read(
            `SELECT * FROM \`share\` WHERE ${holderClause} AND \`id\` > ? ` +
                'ORDER BY `id` LIMIT ?',
            [...holderParams, afterId, size + 1],
        );

        const page = keysetPage(rows, size, this.config.jwt_secret_v2);
        return {
            items: page.rows.map((r) => this.#normalizeRow(r)),
            cursor: page.cursor,
        };
    }

    /**
     * Shares a user has made, keyset-paginated on `id`: the rows they issued
     * themselves, plus the rows a manage delegate issued on a node they own —
     * which is the only place those are visible, since the permission tables
     * are keyed issuer to holder.
     *
     * Separate reads rather than one `OR`, which no index can serve. Each is a
     * range scan: the issued half on `idx_share_issuer`, the delegated half on
     * `idx_share_entry_owner`, and a third covering rows written before that
     * column existed, which is empty once none remain. Unclaimed invites are
     * included (an invite is something the user sent); the legacy invite rows
     * that name no node are not.
     *
     * `appUid` narrows to one app's grants; `null` asks for the ones no app
     * issued, and omitting it asks for every app.
     *
     * @param {number} userId
     * @param {{ limit?: number; cursor?: string; appUid?: string | null }} [opts]
     */
    async listOutbound(userId, { limit, cursor, appUid } = {}) {
        const size = this.#pageSize(limit);
        const afterId = this.#afterId(cursor);
        const own = this.#appFilter(appUid, '`data`');

        const joined = this.#appFilter(appUid, '`share`.`data`');

        const [issued, delegated, unrecorded] = await Promise.all([
            this.clients.db.read(
                'SELECT * FROM `share` WHERE `issuer_user_id` = ? AND ' +
                    '`fsentry_id` IS NOT NULL AND `id` > ?' +
                    own.sql +
                    ' ORDER BY `id` LIMIT ?',
                [userId, afterId, ...own.params, size + 1],
            ),
            this.clients.db.read(
                'SELECT * FROM `share` WHERE `entry_owner_user_id` = ? AND ' +
                    '`issuer_user_id` <> ? AND `id` > ?' +
                    own.sql +
                    ' ORDER BY `id` LIMIT ?',
                [userId, userId, afterId, ...own.params, size + 1],
            ),
            // Rows left by a writer predating the column; indexed on the NULL.
            this.clients.db.read(
                'SELECT `share`.* FROM `share` JOIN `fsentries` ON ' +
                    '`fsentries`.`id` = `share`.`fsentry_id` WHERE ' +
                    '`share`.`entry_owner_user_id` IS NULL AND ' +
                    '`fsentries`.`user_id` = ? AND `share`.`issuer_user_id` <> ? ' +
                    'AND `share`.`id` > ?' +
                    joined.sql +
                    ' ORDER BY `share`.`id` LIMIT ?',
                [userId, userId, afterId, ...joined.params, size + 1],
            ),
        ]);

        // The halves are disjoint and each ordered by id, so merging them and
        // cutting at `size` is the true next page: whatever either half lost to
        // its own limit sorts after the cut and returns on the following one.
        const merged = [...issued, ...delegated, ...unrecorded].sort(
            (a, b) => Number(a.id) - Number(b.id),
        );
        const page = keysetPage(merged, size, this.config.jwt_secret_v2);
        return {
            items: page.rows.map((r) => this.#normalizeRow(r)),
            cursor: page.cursor,
        };
    }

    /**
     * How many rows `listOutbound` walks, both halves counted, under the same
     * `appUid` scope.
     *
     * @param {number} userId
     * @param {{ appUid?: string | null }} [opts]
     */
    async countOutbound(userId, { appUid } = {}) {
        const own = this.#appFilter(appUid, '`data`');
        const joined = this.#appFilter(appUid, '`share`.`data`');
        const [issued, delegated, unrecorded] = await Promise.all([
            this.clients.db.read(
                'SELECT COUNT(*) AS `count` FROM `share` WHERE ' +
                    '`issuer_user_id` = ? AND `fsentry_id` IS NOT NULL' +
                    own.sql,
                [userId, ...own.params],
            ),
            this.clients.db.read(
                'SELECT COUNT(*) AS `count` FROM `share` WHERE ' +
                    '`entry_owner_user_id` = ? AND `issuer_user_id` <> ?' +
                    own.sql,
                [userId, userId, ...own.params],
            ),
            // As `listOutbound`: rows written before the column existed.
            this.clients.db.read(
                'SELECT COUNT(*) AS `count` FROM `share` JOIN `fsentries` ON ' +
                    '`fsentries`.`id` = `share`.`fsentry_id` WHERE ' +
                    '`share`.`entry_owner_user_id` IS NULL AND ' +
                    '`fsentries`.`user_id` = ? AND `share`.`issuer_user_id` <> ?' +
                    joined.sql,
                [userId, userId, ...joined.params],
            ),
        ]);
        return (
            Number(issued[0]?.count ?? 0) +
            Number(delegated[0]?.count ?? 0) +
            Number(unrecorded[0]?.count ?? 0)
        );
    }

    /**
     * The same outbound set folded onto the app that issued each row, keyset-
     * paginated on the app uid. Rows no app issued group under the empty
     * string, which sorts first.
     *
     * Counts are index rows, as `countOutbound` is: a grant withdrawn outside
     * the share path is still counted until its row goes.
     *
     * @param {number} userId
     * @param {{ limit?: number; cursor?: string }} [opts]
     */
    async listOutboundApps(userId, { limit, cursor } = {}) {
        const size = this.#pageSize(limit);
        const decoded = decodeCursor(cursor, 'share app cursor');
        // A cursor that decodes but names no appUid — another listing's, say —
        // is refused rather than read as page one. The no-app group is the
        // empty string, so a first page cannot seek past it.
        if (decoded !== undefined && typeof decoded.appUid !== 'string') {
            throw new HttpError(400, 'invalid share app cursor', {
                legacyCode: 'bad_request',
            });
        }
        const after = decoded === undefined ? null : String(decoded.appUid);

        const rows = await this.clients.db.read(
            'SELECT `app_uid`, COUNT(*) AS `count` FROM (' +
                this.#outboundAppsSql() +
                ') AS `outbound`' +
                (after === null ? '' : ' WHERE `app_uid` > ?') +
                ' GROUP BY `app_uid` ORDER BY `app_uid` LIMIT ?',
            [
                userId,
                userId,
                userId,
                userId,
                userId,
                ...(after === null ? [] : [after]),
                size + 1,
            ],
        );

        // An app uid rather than a sequence position, so it needn't be sealed.
        const page = keysetPage(rows, size, undefined, (last) => ({
            appUid: String(last.app_uid),
        }));
        return {
            items: page.rows.map((row) => ({
                appUid: row.app_uid === '' ? null : String(row.app_uid),
                count: Number(row.count),
            })),
            cursor: page.cursor,
        };
    }

    /** How many apps `listOutboundApps` walks. */
    async countOutboundApps(userId) {
        const rows = await this.clients.db.read(
            'SELECT COUNT(*) AS `count` FROM (SELECT DISTINCT `app_uid` FROM (' +
                this.#outboundAppsSql() +
                ') AS `outbound`) AS `apps`',
            [userId, userId, userId, userId, userId],
        );
        return Number(rows[0]?.count ?? 0);
    }

    /** Everyone with an active share on one node, whoever issued it. */
    async listByFsentry(fsentryId) {
        return this.listReaching([fsentryId]);
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

    /**
     * Active shares on a directory and everything beneath it. Walks by parent
     * linkage, not path prefix — `fsentries.path` is lazily backfilled and NULL
     * on old rows, so a LIKE would skip those descendants' shares.
     *
     * @param {number} fsentryId
     */
    async listByFsentrySubtree(fsentryId) {
        const rows = await this.clients.db.read(
            this.#subtreeCte() +
                'SELECT `share`.* FROM `share` ' +
                'JOIN `subtree` ON `share`.`fsentry_id` = `subtree`.`id` ' +
                'WHERE `share`.`holder_user_id` IS NOT NULL ' +
                'ORDER BY `share`.`id`',
            [fsentryId],
        );
        return rows.map((r) => this.#normalizeRow(r));
    }

    /**
     * Team-held rows on a directory or anything beneath it. What a revoked
     * issuer re-shared to _teams_; `listByFsentrySubtree` only sees holders.
     *
     * @param {number} fsentryId
     */
    async listGroupSharesBySubtree(fsentryId) {
        const rows = await this.clients.db.read(
            this.#subtreeCte() +
                'SELECT `share`.* FROM `share` ' +
                'JOIN `subtree` ON `share`.`fsentry_id` = `subtree`.`id` ' +
                'WHERE `share`.`holder_group_id` IS NOT NULL ' +
                'ORDER BY `share`.`id`',
            [fsentryId],
        );
        return rows.map((r) => this.#normalizeRow(r));
    }

    /**
     * Every share row on a node and everything beneath it, whatever kind —
     * user, group and link shares plus unclaimed invites.
     * `listByFsentrySubtree` answers the narrower question; this one is for
     * retiring the lot.
     *
     * @param {number} fsentryId
     */
    async listAllByFsentrySubtree(fsentryId) {
        const rows = await this.clients.db.read(
            this.#subtreeCte() +
                'SELECT `share`.* FROM `share` ' +
                'JOIN `subtree` ON `share`.`fsentry_id` = `subtree`.`id` ' +
                'ORDER BY `share`.`id`',
            [fsentryId],
        );
        return rows.map((r) => this.#normalizeRow(r));
    }

    /**
     * Team shares reaching these nodes, one row per member. Members hold
     * through the group, so without this a shared folder never pushes them a
     * change and goes stale until they refresh.
     *
     * @param {number[]} fsentryIds
     */
    async listGroupReachingMembers(fsentryIds) {
        if (fsentryIds.length === 0) return [];
        const placeholders = fsentryIds.map(() => '?').join(', ');
        const rows = await this.clients.db.read(
            'SELECT `share`.*, `ug`.`user_id` AS `member_user_id` FROM `share` ' +
                'JOIN `jct_user_group` `ug` ON `ug`.`group_id` = `share`.`holder_group_id` ' +
                'JOIN `group` `g` ON `g`.`id` = `share`.`holder_group_id` ' +
                `WHERE \`share\`.\`fsentry_id\` IN (${placeholders}) ` +
                'AND `share`.`holder_group_id` IS NOT NULL ' +
                'AND `g`.`deleted_at` IS NULL ' +
                'ORDER BY `share`.`id`',
            fsentryIds,
        );
        // Shaped as a holder row, so the caller's fan-out needs no group branch.
        return rows.map((r) => ({
            ...this.#normalizeRow(r),
            holder_user_id: Number(r.member_user_id),
        }));
    }

    /**
     * Everyone who issued any share row (active, pending or team-held) on a
     * directory or anything beneath it.
     *
     * @param {number} fsentryId
     * @returns {Promise<number[]>}
     */
    async listIssuerIdsBySubtree(fsentryId) {
        const rows = await this.clients.db.read(
            this.#subtreeCte() +
                'SELECT DISTINCT `share`.`issuer_user_id` FROM `share` ' +
                'JOIN `subtree` ON `share`.`fsentry_id` = `subtree`.`id`',
            [fsentryId],
        );
        return rows.map((row) => Number(row.issuer_user_id));
    }

    /**
     * Which of `fsentryIds` carry a share, pending invites included. Link
     * shares count unless `includeAnyone` is false — what the caller passes
     * while the owner's plan has them switched off.
     *
     * @param {number[]} fsentryIds
     * @param {{ includeAnyone?: boolean }} [opts]
     * @returns {Promise<Set<number>>}
     */
    async getSharedFsentryIds(fsentryIds, { includeAnyone = true } = {}) {
        const ids = [
            ...new Set(
                fsentryIds.map(Number).filter((id) => Number.isFinite(id)),
            ),
        ];
        const shared = new Set();
        for (let i = 0; i < ids.length; i += SHARED_IDS_CHUNK_SIZE) {
            const chunk = ids.slice(i, i + SHARED_IDS_CHUNK_SIZE);
            const placeholders = chunk.map(() => '?').join(', ');
            const rows = await this.clients.db.read(
                'SELECT DISTINCT `fsentry_id` FROM `share` ' +
                    `WHERE \`fsentry_id\` IN (${placeholders})` +
                    (includeAnyone ? '' : ' AND `anyone` IS NULL'),
                chunk,
            );
            for (const row of rows) shared.add(Number(row.fsentry_id));
        }
        return shared;
    }

    /**
     * @param {number} holderUserId
     * @param {{ groupIds?: number[] }} [opts] Same union as `listByHolder`, or
     *   `includeTotal` undercounts a member's team shares.
     */
    async countByHolder(holderUserId, { groupIds = [] } = {}) {
        const groups = [...new Set(groupIds)].filter(Boolean);
        // Same union as `listByHolder`, blocks included, or the total and the
        // page disagree.
        const holderClause = groups.length
            ? `(\`holder_user_id\` = ? OR \`holder_group_id\` IN (${groups
                  .map(() => '?')
                  .join(', ')}))`
            : '`holder_user_id` = ?';
        const rows = await this.clients.db.read(
            `SELECT COUNT(*) AS \`count\` FROM \`share\` WHERE ${holderClause}`,
            [holderUserId, ...groups],
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
     * Team shares on one node. Neither `listByFsentry` (holder rows) nor the
     * invite feed matches them, so without this the share dialog shows nothing
     * for a file shared with a team.
     *
     * @param {number} fsentryId
     */
    async listGroupOnFsentry(fsentryId) {
        const rows = await this.clients.db.read(
            'SELECT `share`.* FROM `share` ' +
                'JOIN `group` `g` ON `g`.`id` = `share`.`holder_group_id` ' +
                'WHERE `share`.`fsentry_id` = ? ' +
                'AND `share`.`holder_group_id` IS NOT NULL ' +
                'AND `g`.`deleted_at` IS NULL ORDER BY `share`.`id`',
            [fsentryId],
        );
        return rows.map((r) => this.#normalizeRow(r));
    }

    /**
     * Unclaimed invites on one node, whoever sent them. What someone managing
     * the node needs to see who has been asked but has not arrived.
     *
     * A team share also has no `holder_user_id` -- its holder is the group --
     * and a link share has none at all, so all three are checked, or those are
     * listed here as invites to a blank address.
     *
     * @param {number} fsentryId
     */
    async listPendingOnFsentry(fsentryId) {
        const rows = await this.clients.db.read(
            'SELECT * FROM `share` WHERE `fsentry_id` = ? AND ' +
                '`holder_user_id` IS NULL AND `holder_group_id` IS NULL ' +
                'AND `anyone` IS NULL ORDER BY `id`',
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
            'SELECT `uid`, `data` FROM `share` WHERE `recipient_email` = ? AND ' +
                '`fsentry_id` = ? AND `issuer_user_id` = ? AND ' +
                '`holder_user_id` IS NULL LIMIT 1',
            [recipientEmail, fsentryId, issuerUserId],
        );
        // The key an active share uses, so one reader covers both.
        const attribution = existing[0]
            ? this.#keptAttribution(existing[0].data, issuerAppUid)
            : issuerAppUid
              ? { issuedByApp: issuerAppUid }
              : {};
        const data = JSON.stringify({
            ...attribution,
            ...(displayEmail && displayEmail !== recipientEmail
                ? { invitedAddress: displayEmail }
                : {}),
        });
        if (existing[0]?.uid) {
            await this.clients.db.write(
                'UPDATE `share` SET `mode` = ?, `data` = ? WHERE `uid` = ?',
                [mode, data, existing[0].uid],
            );
            return {
                row: await this.getByUid(existing[0].uid),
                created: false,
            };
        }

        const uid = uuidv4();
        await this.clients.db.write(
            'INSERT INTO `share` (`uid`, `issuer_user_id`, `recipient_email`, ' +
                '`fsentry_id`, `mode`, `data`, `entry_owner_user_id`) ' +
                'VALUES (?, ?, ?, ?, ?, ?, ' +
                '(SELECT `user_id` FROM `fsentries` WHERE `id` = ?))',
            [
                uid,
                issuerUserId,
                recipientEmail,
                fsentryId,
                mode,
                data,
                fsentryId,
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

        // The user's grant; `data` records which app asked for it.
        // No app asked, so there is nothing to keep and nothing to read for.
        const prior = issuerAppUid
            ? await this.getActive({
                  holderUserId,
                  fsentryId,
                  issuerUserId,
              })
            : null;
        const data = JSON.stringify(
            prior
                ? this.#keptAttribution(prior.data, issuerAppUid)
                : issuerAppUid
                  ? { issuedByApp: issuerAppUid }
                  : {},
        );
        await this.clients.db.write(
            'INSERT INTO `share` (`uid`, `issuer_user_id`, `recipient_email`, ' +
                '`holder_user_id`, `fsentry_id`, `mode`, `data`, ' +
                '`entry_owner_user_id`, `applied_at`) ' +
                'VALUES (?, ?, ?, ?, ?, ?, ?, ' +
                '(SELECT `user_id` FROM `fsentries` WHERE `id` = ?), ' +
                'CURRENT_TIMESTAMP) ' +
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
                fsentryId,
                mode,
                data,
            ],
        );
        return this.getActive({ holderUserId, fsentryId, issuerUserId });
    }

    /**
     * The team-holder form; `holder_user_id` stays NULL, so `0077`'s group
     * index constrains these rows rather than the user-holder one.
     *
     * @param {object} input
     * @param {number} input.issuerUserId
     * @param {number} input.holderGroupId
     * @param {number} input.fsentryId
     * @param {string} input.mode
     * @param {string | null} [input.issuerAppUid]
     */
    async upsertActiveGroup({
        issuerUserId,
        holderGroupId,
        fsentryId,
        mode,
        issuerAppUid = null,
    }) {
        if (!issuerUserId || !holderGroupId || !fsentryId || !mode) {
            throw new Error(
                'upsertActiveGroup: issuerUserId, holderGroupId, fsentryId and mode are required',
            );
        }
        // No app asked, so there is nothing to keep and nothing to read for.
        const prior = issuerAppUid
            ? await this.getActiveGroup({
                  holderGroupId,
                  fsentryId,
                  issuerUserId,
              })
            : null;
        const data = JSON.stringify(
            prior
                ? this.#keptAttribution(prior.data, issuerAppUid)
                : issuerAppUid
                  ? { issuedByApp: issuerAppUid }
                  : {},
        );
        await this.clients.db.write(
            'INSERT INTO `share` (`uid`, `issuer_user_id`, `recipient_email`, ' +
                '`holder_group_id`, `fsentry_id`, `mode`, `data`, ' +
                '`entry_owner_user_id`, `applied_at`) ' +
                'VALUES (?, ?, ?, ?, ?, ?, ?, ' +
                '(SELECT `user_id` FROM `fsentries` WHERE `id` = ?), ' +
                'CURRENT_TIMESTAMP) ' +
                this.clients.db.upsertClause(
                    ['holder_group_id', 'fsentry_id', 'issuer_user_id'],
                    ['mode', 'data'],
                ),
            [
                uuidv4(),
                issuerUserId,
                // NOT NULL since `0067`; a team has no address.
                '',
                holderGroupId,
                fsentryId,
                mode,
                data,
                fsentryId,
                mode,
                data,
            ],
        );
        return this.getActiveGroup({ holderGroupId, fsentryId, issuerUserId });
    }

    /**
     * @param {object} input
     * @param {number} input.holderGroupId
     * @param {number} input.fsentryId
     * @param {number} input.issuerUserId
     */
    async getActiveGroup({ holderGroupId, fsentryId, issuerUserId }) {
        const rows = await this.clients.db.read(
            'SELECT * FROM `share` WHERE `holder_group_id` = ? AND ' +
                '`fsentry_id` = ? AND `issuer_user_id` = ? LIMIT 1',
            [holderGroupId, fsentryId, issuerUserId],
        );
        return this.#normalizeRow(rows[0]) ?? null;
    }

    /** Every team-held share of this node, whoever issued it. */
    async listGroupSharesByFsentry(fsentryId) {
        const rows = await this.clients.db.read(
            'SELECT * FROM `share` WHERE `fsentry_id` = ? AND `holder_group_id` IS NOT NULL',
            [fsentryId],
        );
        return rows.map((row) => this.#normalizeRow(row)).filter(Boolean);
    }

    /**
     * @param {object} input
     * @param {number} input.holderGroupId
     * @param {number} input.fsentryId
     * @param {number | null} [input.issuerUserId]
     */
    async deleteActiveGroup({ holderGroupId, fsentryId, issuerUserId = null }) {
        const scoped = issuerUserId !== null && issuerUserId !== undefined;
        const result = await this.clients.db.write(
            'DELETE FROM `share` WHERE `holder_group_id` = ? AND `fsentry_id` = ?' +
                (scoped ? ' AND `issuer_user_id` = ?' : ''),
            scoped
                ? [holderGroupId, fsentryId, issuerUserId]
                : [holderGroupId, fsentryId],
        );
        return result.anyRowsAffected;
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

    /**
     * Drop the unclaimed invites `issuerUserId` sent on a directory and
     * everything beneath it. Used when an issuer loses their authority over the
     * node: nothing else retires their invites — the claim path drops them one
     * by one, but only when the recipient shows up.
     *
     * @param {number} issuerUserId
     * @param {number} fsentryId
     */
    /**
     * Re-point `entry_owner_user_id` at `newOwnerId` for every share on `path`
     * or anything under it. A move into someone else's tree re-owns the whole
     * subtree, and a stale owner here silently drops rows from the outbound
     * listing it keys.
     *
     * @param {number} newOwnerId @param {string} path
     */
    async reassignEntryOwnerUnder(newOwnerId, path) {
        await this.clients.db.write(
            'UPDATE `share` SET `entry_owner_user_id` = ? WHERE `fsentry_id` ' +
                'IN (SELECT `id` FROM `fsentries` WHERE `path` = ? OR ' +
                "`path` LIKE ? ESCAPE '!')",
            [newOwnerId, path, `${escapeLike(path)}/%`],
        );
    }

    /**
     * @param {number} issuerUserId @param {number} fsentryId
     * @param {{ exemptFsentryIds?: number[] }} [opts]
     */
    async deletePendingByIssuerSubtree(
        issuerUserId,
        fsentryId,
        { exemptFsentryIds = [] } = {},
    ) {
        // Read-then-delete rather than a CTE inside the DELETE, which the
        // dialects disagree on. The gap between the two only ever leaves an
        // invite standing, and the claim path re-checks authority anyway.
        const exempt = new Set(exemptFsentryIds.map(Number));
        const rows = await this.clients.db.read(
            this.#subtreeCte() +
                'SELECT `share`.`uid`, `share`.`fsentry_id` FROM `share` ' +
                'JOIN `subtree` ON `share`.`fsentry_id` = `subtree`.`id` ' +
                // Group and link rows also have no holder user; deleting one
                // here would drop the index row and leave its grant standing.
                'WHERE `share`.`holder_user_id` IS NULL AND ' +
                '`share`.`holder_group_id` IS NULL AND ' +
                '`share`.`anyone` IS NULL AND ' +
                '`share`.`issuer_user_id` = ?',
            [fsentryId, issuerUserId],
        );
        // Not the ones on a node they manage in their own right.
        const retired = rows.filter(
            (row) => !exempt.has(Number(row.fsentry_id)),
        );
        if (retired.length === 0) return 0;
        const placeholders = retired.map(() => '?').join(', ');
        const result = await this.clients.db.write(
            `DELETE FROM \`share\` WHERE \`uid\` IN (${placeholders})`,
            retired.map((row) => row.uid),
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

    // -- Anyone with the link -----------------------------------------
    //
    // One row per node with `anyone` = 1 and no holder of any kind. Unlike
    // every other row here it is not an index over a permission: nothing in
    // the permission tables stands behind it, and ACLService reads it directly.

    /**
     * The link share on one node, if any.
     *
     * @param {number} fsentryId
     */
    /** How long after a link is withdrawn these reads go to the primary. */
    static REVOKED_LINK_PRIMARY_WINDOW_SECONDS = 30;

    #revokedLinkKey() {
        return 'share:anyone:revoked-recently';
    }

    /** Past the replica while a link has just been withdrawn. */
    async #readAnyone(sql, params) {
        let recent = false;
        try {
            recent = !!(await this.clients.redis.get(this.#revokedLinkKey()));
        } catch {
            // Unreadable marker reads as no revoke; the row is still checked.
        }
        return recent
            ? this.clients.db.pread(sql, params)
            : this.clients.db.read(sql, params);
    }

    async getAnyone(fsentryId) {
        const rows = await this.#readAnyone(
            'SELECT * FROM `share` WHERE `fsentry_id` = ? AND `anyone` = 1 LIMIT 1',
            [fsentryId],
        );
        return this.#normalizeRow(rows[0]) ?? null;
    }

    /**
     * Link shares on any of `fsentryIds` — a node plus its ancestors.
     *
     * @param {number[]} fsentryIds
     */
    async listAnyoneOnFsentries(fsentryIds) {
        if (fsentryIds.length === 0) return [];
        const placeholders = fsentryIds.map(() => '?').join(', ');
        const rows = await this.#readAnyone(
            `SELECT * FROM \`share\` WHERE \`fsentry_id\` IN (${placeholders}) ` +
                'AND `anyone` = 1 ORDER BY `id`',
            fsentryIds,
        );
        return rows.map((r) => this.#normalizeRow(r));
    }

    /**
     * Link shares reaching any of `uuids`, with who owns each node. The ACL
     * knows an entry's ancestors by uuid rather than row id, so the join is
     * done here instead of asking it to resolve them first.
     *
     * @param {string[]} uuids
     * @returns {Promise<
     *     { mode: string; entryUuid: string; ownerUserId: number }[]
     * >}
     */
    async listAnyoneReaching(uuids) {
        if (uuids.length === 0) return [];
        const placeholders = uuids.map(() => '?').join(', ');
        const rows = await this.#readAnyone(
            'SELECT `share`.`mode`, `fsentries`.`uuid` AS `entry_uuid`, ' +
                '`fsentries`.`user_id` AS `owner_user_id` FROM `share` ' +
                'JOIN `fsentries` ON `fsentries`.`id` = `share`.`fsentry_id` ' +
                `WHERE \`fsentries\`.\`uuid\` IN (${placeholders}) ` +
                'AND `share`.`anyone` = 1',
            uuids,
        );
        return rows.map((row) => ({
            mode: String(row.mode),
            entryUuid: String(row.entry_uuid),
            ownerUserId: Number(row.owner_user_id),
        }));
    }

    /**
     * Record a link share, or move the node's existing one to a new mode. One
     * statement on the (fsentry, anyone) key, so two owners' sessions setting
     * it at once settle on one row.
     *
     * @param {object} input
     * @param {number} input.issuerUserId
     * @param {number} input.fsentryId
     * @param {string} input.mode
     * @param {string | null} [input.issuerAppUid]
     */
    async upsertAnyone({ issuerUserId, fsentryId, mode, issuerAppUid = null }) {
        if (!issuerUserId || !fsentryId || !mode) {
            throw new Error(
                'upsertAnyone: issuerUserId, fsentryId and mode are required',
            );
        }
        // As the other upserts: re-issuing may lose the app, never switch it.
        const prior = issuerAppUid ? await this.getAnyone(fsentryId) : null;
        const data = JSON.stringify(
            prior
                ? this.#keptAttribution(prior.data, issuerAppUid)
                : issuerAppUid
                  ? { issuedByApp: issuerAppUid }
                  : {},
        );
        await this.clients.db.write(
            'INSERT INTO `share` (`uid`, `issuer_user_id`, `recipient_email`, ' +
                '`fsentry_id`, `anyone`, `mode`, `data`, ' +
                '`entry_owner_user_id`, `applied_at`) ' +
                'VALUES (?, ?, ?, ?, 1, ?, ?, ' +
                '(SELECT `user_id` FROM `fsentries` WHERE `id` = ?), ' +
                'CURRENT_TIMESTAMP) ' +
                this.clients.db.upsertClause(
                    ['fsentry_id', 'anyone'],
                    ['mode', 'data', 'issuer_user_id'],
                ),
            [
                uuidv4(),
                issuerUserId,
                // NOT NULL since `0067`; nobody in particular has an address.
                '',
                fsentryId,
                mode,
                data,
                fsentryId,
                mode,
                data,
                issuerUserId,
            ],
        );
        return this.getAnyone(fsentryId);
    }

    /**
     * Drop the link share on one node.
     *
     * @param {number} fsentryId
     */
    async deleteAnyone(fsentryId) {
        const result = await this.clients.db.write(
            'DELETE FROM `share` WHERE `fsentry_id` = ? AND `anyone` = 1',
            [fsentryId],
        );
        const removed = (result?.affectedRows ?? result?.changes ?? 0) > 0;
        if (removed) await this.#markLinkRevoked();
        return removed;
    }

    /** Open the window in which link reads go to the primary. */
    async #markLinkRevoked() {
        try {
            await this.clients.redis.set(
                this.#revokedLinkKey(),
                '1',
                'EX',
                ShareStore.REVOKED_LINK_PRIMARY_WINDOW_SECONDS,
            );
        } catch (e) {
            console.warn('[share] link-revoke marker not set:', e);
        }
    }

    // -- Daily quota --------------------------------------------------
    // Counted in KV, not by querying `share`: the ceiling is on shares
    // *created*, so a COUNT of live rows would let a revoke recycle the slot.

    /**
     * @param {number} userId
     * @param {number} [amount]
     * @returns {Promise<number>} The count after incrementing
     */
    async incrementDailyShareCount(userId, amount = 1, scope = 'quota') {
        const { res } = await this.stores.kv.incr({
            key: this.#dailyQuotaKey(userId, scope),
            pathAndAmountMap: { count: amount },
            // Two days, so a counter written just before midnight still ages
            // out on its own.
            expireAt: Math.floor(Date.now() / 1000) + 2 * 24 * 60 * 60,
        });
        const count = /** @type {{ count?: unknown } | null} */ (res)?.count;
        return typeof count === 'number' ? count : amount;
    }

    /**
     * Who a re-issued share stays credited to: only the same app re-issuing
     * keeps it, so a share may lose attribution but never gain or switch it.
     */
    #keptAttribution(existingData, issuerAppUid) {
        let prior = existingData ?? {};
        if (typeof prior === 'string') {
            // `data` is not always JSON on sqlite; `#normalizeRow` says so too.
            try {
                prior = JSON.parse(prior || '{}');
            } catch {
                prior = {};
            }
        }
        // `issuerAppUid` is the older spelling, read in two other places.
        const priorApp = prior?.issuedByApp ?? prior?.issuerAppUid;
        return issuerAppUid && priorApp === issuerAppUid
            ? { issuedByApp: issuerAppUid }
            : {};
    }

    /** @param {number} userId @param {string} scope */
    #dailyQuotaKey(userId, scope = 'quota') {
        const day = new Date().toISOString().slice(0, 10);
        return `share:${scope}:${userId}:${day}`;
    }

    // -- Internals ----------------------------------------------------

    /** The recursive walk of a directory's row ids, by parent linkage. */
    #subtreeCte() {
        return (
            'WITH RECURSIVE `subtree`(`id`) AS (' +
            'SELECT `id` FROM `fsentries` WHERE `id` = ? ' +
            'UNION ALL ' +
            'SELECT `f`.`id` FROM `fsentries` `f` ' +
            'JOIN `subtree` `s` ON `f`.`parent_id` = `s`.`id`' +
            ') '
        );
    }

    /** @param {number} [limit] */
    #pageSize(limit) {
        return Math.min(
            Math.max(1, Math.floor(Number(limit) || DEFAULT_PAGE_SIZE)),
            MAX_PAGE_SIZE,
        );
    }

    /**
     * The id a keyset page resumes after; 0 for the first page. A cursor
     * without a usable id is refused rather than read as page one, which would
     * silently restart a client's iteration from the top.
     */
    #afterId(cursor) {
        return (
            openIdCursor(cursor, this.config.jwt_secret_v2, {
                label: 'share cursor',
                strict: true,
            }) ?? 0
        );
    }

    /**
     * The app recorded on a row, as a SQL expression over its `data`. Two
     * spellings in the wild — pending rows were written with `issuerAppUid`
     * before the keys were unified on `issuedByApp`, and claiming carries
     * `data` forward — so both are read, matching the service-side reader.
     *
     * The column is typed JSON on mysql and postgres, but sqlite stores
     * whatever it was handed and legacy rows carry plain strings — extracting
     * from one of those aborts the whole query, so there the read is guarded.
     */
    #issuedByAppExpr(dataColumn) {
        const extracts = ['issuedByApp', 'issuerAppUid'].map((key) =>
            this.clients.db.jsonTextExtract(dataColumn, [key]),
        );
        const coalesced = `COALESCE(${extracts.join(', ')})`;
        return this.clients.db.case({
            sqlite: `CASE WHEN json_valid(${dataColumn}) THEN ${coalesced} END`,
            otherwise: coalesced,
        });
    }

    /**
     * `WHERE` fragment scoping a listing to one app. `undefined` means every
     * app, `null` the rows no app issued.
     *
     * @param {string | null | undefined} appUid
     * @param {string} dataColumn
     */
    #appFilter(appUid, dataColumn) {
        if (appUid === undefined) return { sql: '', params: [] };
        const expr = this.#issuedByAppExpr(dataColumn);
        if (appUid === null) return { sql: ` AND ${expr} IS NULL`, params: [] };
        return { sql: ` AND ${expr} = ?`, params: [appUid] };
    }

    /**
     * Both outbound halves projected onto their issuing app. Takes the same
     * five bound user ids as `listOutbound`, in that order.
     */
    #outboundAppsSql() {
        const own = this.clients.db.nullCoalesce(
            this.#issuedByAppExpr('`data`'),
            "''",
        );
        const joined = this.clients.db.nullCoalesce(
            this.#issuedByAppExpr('`share`.`data`'),
            "''",
        );
        return (
            `SELECT ${own} AS \`app_uid\` FROM \`share\` WHERE ` +
            '`issuer_user_id` = ? AND `fsentry_id` IS NOT NULL UNION ALL ' +
            `SELECT ${own} AS \`app_uid\` FROM \`share\` WHERE ` +
            '`entry_owner_user_id` = ? AND `issuer_user_id` <> ? UNION ALL ' +
            `SELECT ${joined} AS \`app_uid\` FROM \`share\` JOIN \`fsentries\` ` +
            'ON `fsentries`.`id` = `share`.`fsentry_id` WHERE ' +
            '`share`.`entry_owner_user_id` IS NULL AND ' +
            '`fsentries`.`user_id` = ? AND `share`.`issuer_user_id` <> ?'
        );
    }

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
