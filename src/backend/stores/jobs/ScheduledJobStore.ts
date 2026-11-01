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

/** A job as a poll sees it on the read replica. */
export interface ScheduledJobSummary {
    name: string;
    nextRunAt: number;
    leaseUntil: number | null;
}

/** The claimed row, read on the primary right after the claim. */
export interface ClaimedJob {
    state: string | null;
    nextRunAt: number;
    failures: number;
    /** The primary's clock at the read. */
    dbNowMs: number;
}

export interface JobClaim {
    token: string;
    owner: string;
    leaseMs: number;
    /** How long past `next_run_at` the job must be before this claim may win. */
    graceMs: number;
    updatedAt: number;
}

export interface JobFinish {
    nextRunAt: number;
    lastRunAt: number;
    lastDurationMs: number;
    lastError: string | null;
    failures: number;
    updatedAt: number;
}

/**
 * Persistence for `scheduled_jobs`, one row per (namespace, job name). Lease
 * times compare the primary's clock (`nowMsExpr`), never a node's, and every
 * write after the claim is fenced on the run's lease token.
 */
export class ScheduledJobStore extends PuterStore {
    // -- Reads --------------------------------------------------------

    /**
     * The named jobs' rows in `namespace`, from the replica, with the replica's
     * clock. Only a hint for which jobs to try claiming.
     */
    async listForNamespace(
        namespace: string,
        names: readonly string[],
    ): Promise<{ jobs: ScheduledJobSummary[]; dbNowMs: number | null }> {
        if (names.length === 0) return { jobs: [], dbNowMs: null };
        const db = this.clients.db;
        const rows = await db.read(
            `SELECT \`name\`, \`next_run_at\`, \`lease_until\`, ${db.nowMsExpr()} AS \`now_ms\` ` +
                'FROM `scheduled_jobs` WHERE `namespace` = ? ' +
                `AND \`name\` IN (${names.map(() => '?').join(', ')})`,
            [namespace, ...names],
        );
        return {
            jobs: rows.map((row) => ({
                name: String(row.name),
                nextRunAt: Number(row.next_run_at),
                leaseUntil:
                    row.lease_until === null ? null : Number(row.lease_until),
            })),
            dbNowMs: rows.length > 0 ? Number(rows[0].now_ms) : null,
        };
    }

    /** The row a claim just won, read on the primary. */
    async readClaimed(
        namespace: string,
        name: string,
    ): Promise<ClaimedJob | null> {
        const db = this.clients.db;
        const [row] = await db.pread(
            `SELECT \`state\`, \`next_run_at\`, \`failures\`, ${db.nowMsExpr()} AS \`now_ms\` ` +
                'FROM `scheduled_jobs` WHERE `namespace` = ? AND `name` = ?',
            [namespace, name],
        );
        if (!row) return null;
        return {
            state: row.state === null ? null : String(row.state),
            nextRunAt: Number(row.next_run_at),
            failures: Number(row.failures),
            dbNowMs: Number(row.now_ms),
        };
    }

    // -- Writes -------------------------------------------------------

    /**
     * Insert the job's row, due `delayMs` from now by the primary's clock.
     * Leaves an existing row alone, so a redeploy never resets a cadence.
     */
    async register(
        namespace: string,
        name: string,
        delayMs: number,
        updatedAt: number,
    ): Promise<void> {
        const db = this.clients.db;
        await db.write(
            `${db.insertIgnoreInto('scheduled_jobs')} ` +
                '(`namespace`, `name`, `next_run_at`, `failures`, `updated_at`) ' +
                `VALUES (?, ?, ${db.nowMsExpr()} + ?, 0, ?)${db.insertIgnoreSuffix()}`,
            [namespace, name, delayMs, updatedAt],
        );
    }

    /** Take the lease if the job is due and nobody holds it. */
    async claim(
        namespace: string,
        name: string,
        claim: JobClaim,
    ): Promise<boolean> {
        const db = this.clients.db;
        const now = db.nowMsExpr();
        const result = await db.write(
            'UPDATE `scheduled_jobs` ' +
                `SET \`lease_until\` = ${now} + ?, \`lease_token\` = ?, \`lease_owner\` = ?, \`updated_at\` = ? ` +
                `WHERE \`namespace\` = ? AND \`name\` = ? AND \`next_run_at\` <= ${now} - ? ` +
                `AND (\`lease_until\` IS NULL OR \`lease_until\` < ${now})`,
            [
                claim.leaseMs,
                claim.token,
                claim.owner,
                claim.updatedAt,
                namespace,
                name,
                claim.graceMs,
            ],
        );
        return result.anyRowsAffected;
    }

    /** Extend the lease. False once another run holds the job. */
    async renew(
        namespace: string,
        name: string,
        token: string,
        leaseMs: number,
        updatedAt: number,
    ): Promise<boolean> {
        const db = this.clients.db;
        const result = await db.write(
            `UPDATE \`scheduled_jobs\` SET \`lease_until\` = ${db.nowMsExpr()} + ?, \`updated_at\` = ? ` +
                'WHERE `namespace` = ? AND `name` = ? AND `lease_token` = ?',
            [leaseMs, updatedAt, namespace, name, token],
        );
        return result.anyRowsAffected;
    }

    /** Store the job's state JSON. False once another run holds the job. */
    async saveState(
        namespace: string,
        name: string,
        token: string,
        state: string,
        updatedAt: number,
    ): Promise<boolean> {
        const result = await this.clients.db.write(
            'UPDATE `scheduled_jobs` SET `state` = ?, `updated_at` = ? ' +
                'WHERE `namespace` = ? AND `name` = ? AND `lease_token` = ?',
            [state, updatedAt, namespace, name, token],
        );
        return result.anyRowsAffected;
    }

    /**
     * Record the run and release the lease. False once another run holds the
     * job.
     */
    async finish(
        namespace: string,
        name: string,
        token: string,
        finish: JobFinish,
    ): Promise<boolean> {
        const result = await this.clients.db.write(
            'UPDATE `scheduled_jobs` SET `next_run_at` = ?, `lease_until` = NULL, ' +
                '`lease_token` = NULL, `lease_owner` = NULL, `last_run_at` = ?, ' +
                '`last_duration_ms` = ?, `last_error` = ?, `failures` = ?, `updated_at` = ? ' +
                'WHERE `namespace` = ? AND `name` = ? AND `lease_token` = ?',
            [
                finish.nextRunAt,
                finish.lastRunAt,
                finish.lastDurationMs,
                finish.lastError,
                finish.failures,
                finish.updatedAt,
                namespace,
                name,
                token,
            ],
        );
        return result.anyRowsAffected;
    }
}
