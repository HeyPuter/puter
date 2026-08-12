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
import { PuterStore } from '../types';

/** One row of the `app_feedback` table. Timestamps are unix seconds. */
export interface AppFeedbackRow {
    id: number;
    uid: string;
    app_id: number;
    app_uid: string;
    user_id: number;
    message: string;
    source_env: string | null;
    source_origin: string | null;
    email_sent: boolean;
    created_at: number;
}

/**
 * Persistence for user-to-developer app feedback (`app_feedback` table).
 *
 * The count methods back AppFeedbackService's durable abuse caps. They query
 * the DB rather than a cache/limiter on purpose: the rate-limit middleware
 * fails open when its backend is unreachable, and a feature that emails a third
 * party needs limits that fail closed. Both counts are served by the (user_id,
 * created_at) / (app_id, created_at) indexes.
 */
export class AppFeedbackStore extends PuterStore {
    // -- Reads --------------------------------------------------------

    /** Feedback rows this user submitted (any app) since `sinceUnixSeconds`. */
    async countByUserSince(
        userId: number,
        sinceUnixSeconds: number,
    ): Promise<number> {
        const rows = await this.clients.db.read(
            'SELECT COUNT(*) AS n FROM `app_feedback` WHERE `user_id` = ? AND `created_at` >= ?',
            [userId, sinceUnixSeconds],
        );
        return Number(rows[0]?.n ?? 0);
    }

    /** Feedback rows this user submitted for one app since `sinceUnixSeconds`. */
    async countByUserAndAppSince(
        userId: number,
        appId: number,
        sinceUnixSeconds: number,
    ): Promise<number> {
        const rows = await this.clients.db.read(
            'SELECT COUNT(*) AS n FROM `app_feedback` WHERE `user_id` = ? AND `app_id` = ? AND `created_at` >= ?',
            [userId, appId, sinceUnixSeconds],
        );
        return Number(rows[0]?.n ?? 0);
    }

    /**
     * Feedback rows for this app that were emailed to the owner since
     * `sinceUnixSeconds`. Backs the per-app daily email cap.
     */
    async countEmailedByAppSince(
        appId: number,
        sinceUnixSeconds: number,
    ): Promise<number> {
        const rows = await this.clients.db.read(
            'SELECT COUNT(*) AS n FROM `app_feedback` WHERE `app_id` = ? AND `email_sent` = ? AND `created_at` >= ?',
            [appId, this.clients.db.booleanValue(true), sinceUnixSeconds],
        );
        return Number(rows[0]?.n ?? 0);
    }

    // -- Writes -------------------------------------------------------

    /**
     * Insert one feedback row. `email_sent` starts false; the service claims it
     * with {@link markEmailSent} before sending and releases it with
     * {@link unmarkEmailSent} if the cap was breached or the send failed, so the
     * email cap fails closed under concurrent submissions.
     */
    async create(fields: {
        appId: number;
        appUid: string;
        userId: number;
        message: string;
        sourceEnv?: string | null;
        sourceOrigin?: string | null;
    }): Promise<{ id: number; uid: string }> {
        const uid = uuidv4();
        const createdAt = Math.floor(Date.now() / 1000);
        const result = await this.clients.db.write(
            'INSERT INTO `app_feedback` (`uid`, `app_id`, `app_uid`, `user_id`, `message`, `source_env`, `source_origin`, `email_sent`, `created_at`) ' +
                `VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)${this.clients.db.returningIdClause()}`,
            [
                uid,
                fields.appId,
                fields.appUid,
                fields.userId,
                fields.message,
                fields.sourceEnv ?? null,
                fields.sourceOrigin ?? null,
                this.clients.db.booleanValue(false),
                createdAt,
            ],
        );
        const insertId = result?.insertId;
        if (!insertId) {
            throw new Error(
                'Failed to record app feedback — no insertId returned',
            );
        }
        return { id: Number(insertId), uid };
    }

    /** Record that the owner email for this row was sent (claim a cap slot). */
    async markEmailSent(id: number): Promise<void> {
        await this.#setEmailSent(id, true);
    }

    /**
     * Revert {@link markEmailSent} — releases a claimed email-cap slot when the
     * cap turned out breached or the send failed.
     */
    async unmarkEmailSent(id: number): Promise<void> {
        await this.#setEmailSent(id, false);
    }

    async #setEmailSent(id: number, sent: boolean): Promise<void> {
        await this.clients.db.write(
            'UPDATE `app_feedback` SET `email_sent` = ? WHERE `id` = ?',
            [this.clients.db.booleanValue(sent), id],
        );
    }

    /** Delete one feedback row. Backs the service's cap-race rollback. */
    async deleteById(id: number): Promise<void> {
        await this.clients.db.write(
            'DELETE FROM `app_feedback` WHERE `id` = ?',
            [id],
        );
    }
}
