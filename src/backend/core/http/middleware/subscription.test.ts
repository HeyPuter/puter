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

import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { IConfig } from '../../../types';
import { isHttpError } from '../HttpError';
import { requireSubscriptionGate } from './subscription';

// The decision itself is covered in `services/metering/enforcement.test.ts`;
// what matters here is that the gate resolves it and hands the outcome to
// `next()` rather than leaving the request hanging or throwing async.

const runGate = (
    gate: ReturnType<typeof requireSubscriptionGate>,
    plan: string,
): Promise<unknown> =>
    new Promise((resolve) => {
        gate(
            { actor: { user: { uuid: 'u-1' } } } as unknown as Request,
            {} as Response,
            resolve as (err?: unknown) => void,
        );
    });

const metering = (id: string) => ({
    getActorSubscription: vi.fn().mockResolvedValue({ id }),
});

const config = {} as IConfig;

describe('requireSubscriptionGate', () => {
    it('calls next() with nothing for a subscriber', async () => {
        const got = await runGate(
            requireSubscriptionGate(metering('business'), config, true),
            'business',
        );
        expect(got).toBeUndefined();
    });

    it('calls next(err) with a 402 for a free account', async () => {
        const got = await runGate(
            requireSubscriptionGate(metering('user_free'), config, true),
            'user_free',
        );
        expect(isHttpError(got)).toBe(true);
        expect(got).toMatchObject({
            statusCode: 402,
            legacyCode: 'subscription_required',
        });
    });

    it('passes a rejected lookup to next() instead of leaving it unhandled', async () => {
        const broken = {
            getActorSubscription: vi
                .fn()
                .mockRejectedValue(new Error('store down')),
        };
        const got = await runGate(
            requireSubscriptionGate(broken, config, true),
            'irrelevant',
        );
        expect(got).toBeInstanceOf(Error);
    });
});
