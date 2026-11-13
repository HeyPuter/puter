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

import { Readable } from 'node:stream';
import type { Actor } from '../../../core/actor.js';
import { insufficientCreditsError } from '../../../services/metering/enforcement.js';
import type { AiMeteringService } from '../../../util/aiCostFactor.js';
import type { DriverStreamResult } from '../../meta.js';

// Under the hold store's default TTL, so a renewal always lands first.
const STREAM_HOLD_RENEW_MS = 5 * 60 * 1000;

/**
 * Holds `amount` while `open` starts an upstream audio stream, then charges it
 * through `record` once the first byte arrives, or once the caller hangs up. An
 * upstream that fails or ends before its first byte is not charged. The hold is
 * renewed until the charge lands, however long a slow reader takes.
 */
export async function withStreamedAiCharge(
    metering: AiMeteringService,
    actor: Actor,
    usageType: string,
    amount: number,
    open: () => Promise<DriverStreamResult>,
    record: () => unknown,
): Promise<DriverStreamResult> {
    const hold = await metering.reserveAiCredits(actor, usageType, amount);
    if (!hold) throw insufficientCreditsError();
    // Started before `open`, which can itself run as long as the hold's TTL.
    const renew = setInterval(async () => {
        try {
            await hold.extend?.();
        } catch {
            // The next tick retries.
        }
    }, STREAM_HOLD_RENEW_MS);
    renew.unref?.();
    let result: DriverStreamResult;
    try {
        result = await open();
    } catch (e) {
        clearInterval(renew);
        await hold.release();
        throw e;
    }

    let settled = false;
    const settle = (charge: boolean) => {
        if (settled) return;
        settled = true;
        // The relay runs outside the request, so the hold waits on the charge
        // itself. A failed release leaves the hold to its TTL.
        const release = async () => {
            clearInterval(renew);
            try {
                await hold.release();
            } catch {
                // ignored
            }
        };
        void Promise.resolve()
            .then(() => (charge ? record() : undefined))
            .then(release, release);
    };
    const source = result.stream;
    let chunks: AsyncIterator<unknown> | undefined;
    const relay = new Readable({
        async read() {
            try {
                chunks ??= source[Symbol.asyncIterator]();
                const next = await chunks.next();
                if (next.done) {
                    settle(false);
                    this.push(null);
                    return;
                }
                settle(true);
                this.push(next.value);
            } catch (e) {
                settle(false);
                this.destroy(e as Error);
            }
        },
        // Reached first by a caller hanging up, who is charged in full.
        destroy(error, callback) {
            settle(true);
            source.destroy();
            callback(error);
        },
    });
    return { ...result, stream: relay };
}
