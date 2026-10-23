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

import { PuterService } from '../types.js';

const DEFAULT_DEVICE_RETENTION_DAYS = 60;
const STALE_SWEEP_INTERVAL_MS = 60 * 60 * 1000;
/** Rows one delete takes. Small enough not to hold a lock anyone waits on. */
const STALE_BATCH_SIZE = 500;
/** Batches one sweep takes, so a large backlog drains over several passes. */
const STALE_MAX_BATCHES = 50;

/** Keeps push devices in step with their sessions; runs even with push off. */
export class PushService extends PuterService {
    #staleSweep: ReturnType<typeof setInterval> | null = null;

    override onServerStart(): void {
        this.#armStaleSweep();

        this.clients.event.on(
            'outer.auth.sessions.revoked',
            (_key: string, data: unknown, meta: unknown) => {
                // The node that revoked the sessions already removed the rows.
                if ((meta as { from_outside?: boolean })?.from_outside) return;
                const { user_id, session_uids } = data as {
                    user_id?: number;
                    session_uids?: string[];
                };
                if (!user_id || !session_uids?.length) return;
                void this.stores.pushDevice
                    .removeBySessions(user_id, session_uids)
                    .catch((err: unknown) => {
                        console.warn(
                            '[push] session device cleanup failed',
                            err,
                        );
                    });
            },
        );
    }

    override onServerPrepareShutdown(): void {
        if (this.#staleSweep) clearInterval(this.#staleSweep);
        this.#staleSweep = null;
    }

    /** Every node sweeps; an overlap costs only empty indexed batches. */
    async sweepStaleDevices(): Promise<number> {
        const days = this.#retentionDays();
        if (days <= 0) return 0;
        const cutoff = Math.floor(Date.now() / 1000) - days * 86_400;

        let removed = 0;
        for (let pass = 0; pass < STALE_MAX_BATCHES; pass++) {
            const batch = await this.stores.pushDevice.removeUnseenSince(
                cutoff,
                { limit: STALE_BATCH_SIZE },
            );
            removed += batch;
            if (batch < STALE_BATCH_SIZE) break;
        }
        return removed;
    }

    #retentionDays(): number {
        const configured = Number(
            this.config.push?.deviceRetentionDays ??
                DEFAULT_DEVICE_RETENTION_DAYS,
        );
        return Number.isFinite(configured) && configured > 0 ? configured : 0;
    }

    #armStaleSweep(): void {
        if (this.#retentionDays() <= 0) return;
        const sweep = setInterval(() => {
            void this.sweepStaleDevices().catch((err) => {
                console.warn('[push] stale device sweep failed', err);
            });
        }, STALE_SWEEP_INTERVAL_MS);
        sweep.unref?.();
        this.#staleSweep = sweep;
    }
}
