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

import { setTimeout as sleep } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';

import { isUpstreamTimeoutError } from '../../../util/upstreamErrors.js';
import { sendWithDeadline } from './sendWithDeadline.js';

describe('sendWithDeadline', () => {
    it("resolves with the call's value and never aborts afterwards", async () => {
        let signal: AbortSignal | undefined;

        const value = await sendWithDeadline(30, async (abortSignal) => {
            signal = abortSignal;
            return 'answer';
        });
        await sleep(60);

        expect(value).toBe('answer');
        expect(signal?.aborted).toBe(false);
    });

    it('passes a failure that arrives before the deadline through unchanged', async () => {
        const failure = new Error('throttled');

        await expect(
            sendWithDeadline(1000, () => Promise.reject(failure)),
        ).rejects.toBe(failure);
    });

    it('rejects with what the call throws before it returns a promise', async () => {
        const failure = new Error('bad input');

        await expect(
            sendWithDeadline(1000, () => {
                throw failure;
            }),
        ).rejects.toBe(failure);
    });

    it('rejects with a TimeoutError at the deadline and aborts the call, even when the call ignores the signal', async () => {
        let signal: AbortSignal | undefined;
        const started = Date.now();

        const err = await sendWithDeadline(50, (abortSignal) => {
            signal = abortSignal;
            return new Promise<never>(() => {});
        }).catch((e: unknown) => e);

        expect(Date.now() - started).toBeGreaterThanOrEqual(45);
        expect(isUpstreamTimeoutError(err)).toBe(true);
        expect(signal?.aborted).toBe(true);
    });
});
