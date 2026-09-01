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
import { describe, expect, it } from 'vitest';
import type { IConfig } from '../../../types';
import { isHttpError } from '../HttpError';
import { requireReputationGate } from './reputation';

// The decision itself is covered in `core/reputation.test.ts`; what matters
// here is that the gate resolves it and hands the outcome to `next()` rather
// than leaving the request hanging or throwing async.

const config = {
    reputationGate: { tiers: { standard: 60 } },
} as unknown as IConfig;

const runGate = (
    gate: ReturnType<typeof requireReputationGate>,
    reputation?: number,
): Promise<unknown> =>
    new Promise((resolve) => {
        gate(
            {
                actor: { user: { uuid: 'u-1', reputation } },
            } as unknown as Request,
            {} as Response,
            resolve as (err?: unknown) => void,
        );
    });

describe('requireReputationGate', () => {
    it('calls next() with nothing for an account that clears the tier', async () => {
        const got = await runGate(
            requireReputationGate(config, 'standard'),
            80,
        );
        expect(got).toBeUndefined();
    });

    it('calls next(err) with a 403 for an account that does not', async () => {
        const got = await runGate(
            requireReputationGate(config, 'standard'),
            20,
        );
        expect(isHttpError(got)).toBe(true);
        expect(got).toMatchObject({
            statusCode: 403,
            legacyCode: 'reputation_required',
        });
    });

    it('passes everyone through for a tier the deployment never defined', async () => {
        const got = await runGate(
            requireReputationGate(config, 'unheard-of'),
            0,
        );
        expect(got).toBeUndefined();
    });
});
