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
 * Puter is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with Puter. If not, see <https://www.gnu.org/licenses/>.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Actor } from '../../../../core/actor.js';
import type { PuterServer } from '../../../../server.js';
import { setupTestServer } from '../../../../testUtil.js';
import type { AiMeteringService } from '../../../../util/aiCostFactor.js';
import { capSecondsToRemainingCredits } from './creditCap.js';

let server: PuterServer;
let metering: AiMeteringService;
let users = 0;

beforeAll(async () => {
    server = await setupTestServer();
    const service = server.services.metering;
    metering = {
        costFactor: async () => 1,
        getRemainingUsage: (actor: Actor) => service.getRemainingUsage(actor),
        reserveCreditsIfAffordable: (
            ...args: Parameters<typeof service.reserveCreditsIfAffordable>
        ) => service.reserveCreditsIfAffordable(...args),
    } as unknown as AiMeteringService;
});

afterAll(async () => {
    await server?.shutdown();
});

/** A fresh user spent down to exactly `balance`. */
const userWithBalance = async (balance: number): Promise<Actor> => {
    const id = 9000 + ++users;
    const actor = {
        user: {
            id,
            uuid: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
            username: `video-cap-${id}`,
            email_confirmed: true,
        },
    } as unknown as Actor;
    const service = server.services.metering;
    const { remaining } = await service.getAllowedUsage(actor);
    await service.incrementUsage(actor, 'kv:read', 1, remaining - balance);
    expect((await service.getAllowedUsage(actor)).remaining).toBe(balance);
    return actor;
};

const cap = (actor: Actor, requestedSeconds: number) =>
    capSecondsToRemainingCredits({
        metering,
        actor,
        usageType: 'test-video:model:per-second',
        perSecondMicroCents: 1_000_000,
        requestedSeconds,
    });

describe('capSecondsToRemainingCredits', () => {
    it('shortens a clip to what the balance buys and holds its cost', async () => {
        const actor = await userWithBalance(5_000_000);

        const { seconds, hold } = await cap(actor, 8);

        expect(seconds).toBe(5);
        expect(await server.services.metering.getOutstandingHolds(actor)).toBe(
            5_000_000,
        );
        await hold.release();
    });

    it('holds no more than the balance for clips asked for at the same moment', async () => {
        const actor = await userWithBalance(8_000_000);

        const outcomes = await Promise.all(
            Array.from({ length: 6 }, () =>
                cap(actor, 8).catch((error) => error),
            ),
        );

        const sized = outcomes.filter((outcome) => 'seconds' in outcome);
        expect(sized.length).toBeGreaterThan(0);
        expect(
            sized.reduce((total, { seconds }) => total + seconds, 0),
        ).toBeLessThanOrEqual(8);
        expect(
            await server.services.metering.getOutstandingHolds(actor),
        ).toBeLessThanOrEqual(8_000_000);
        for (const refused of outcomes.filter((o) => !('seconds' in o))) {
            expect(refused.statusCode).toBe(402);
        }
        await Promise.all(sized.map(({ hold }) => hold.release()));
    });
});
