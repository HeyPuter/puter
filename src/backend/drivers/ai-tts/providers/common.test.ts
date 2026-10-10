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
import {
    afterAll,
    afterEach,
    beforeAll,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { makeActor } from '../../../core/actor.js';
import type { DriverStreamResult } from '../../meta.js';
import { PuterServer } from '../../../server.js';
import { setupTestServer } from '../../../testUtil.js';
import { withAiCostFactor } from '../../util/aiCostFactor.js';
import { characterCostReport, meterPerCharacter } from './common.js';

let server: PuterServer;
beforeAll(async () => {
    server = await setupTestServer();
});
afterAll(async () => {
    await server?.shutdown();
});
afterEach(() => {
    vi.restoreAllMocks();
});

const audio = (): Promise<DriverStreamResult> =>
    Promise.resolve({
        dataType: 'stream',
        content_type: 'audio/mpeg',
        stream: Readable.from([]),
    });

describe('meterPerCharacter', () => {
    const actor = makeActor({
        user: { id: 7, uuid: 'tts-meter-user', username: 'tts-meter' },
    });
    const metering = () =>
        withAiCostFactor(
            server.services.metering,
            server.clients.event,
            'ai-tts',
        );

    it('holds and then meters exactly text length × price', async () => {
        const check = vi
            .spyOn(server.services.metering, 'hasEnoughCredits')
            .mockResolvedValue(true);
        const record = vi.spyOn(server.services.metering, 'incrementUsage');

        await meterPerCharacter(
            metering(),
            actor,
            'openai:tts-1:character',
            1500,
            'hello',
            audio,
        );

        expect(check).toHaveBeenCalledWith(actor, 7500);
        expect(record).toHaveBeenCalledWith(
            actor,
            'openai:tts-1:character',
            5,
            7500,
        );
        expect(await server.services.metering.getOutstandingHolds(actor)).toBe(
            0,
        );
    });

    it('meters nothing when synthesis fails', async () => {
        vi.spyOn(
            server.services.metering,
            'hasEnoughCredits',
        ).mockResolvedValue(true);
        const record = vi.spyOn(server.services.metering, 'incrementUsage');
        const boom = new Error('vendor down');

        await expect(
            meterPerCharacter(
                metering(),
                actor,
                'openai:tts-1:character',
                1500,
                'hello',
                () => Promise.reject(boom),
            ),
        ).rejects.toBe(boom);
        expect(record).not.toHaveBeenCalled();
    });

    it('refuses with a 402 before synthesizing when unaffordable', async () => {
        vi.spyOn(
            server.services.metering,
            'hasEnoughCredits',
        ).mockResolvedValue(false);
        const synthesize = vi.fn(audio);

        await expect(
            meterPerCharacter(
                metering(),
                actor,
                'openai:tts-1:character',
                1500,
                'hello',
                synthesize,
            ),
        ).rejects.toMatchObject({ statusCode: 402 });
        expect(synthesize).not.toHaveBeenCalled();
    });
});

describe('characterCostReport', () => {
    it('emits one per-character line per cost-table entry', () => {
        expect(
            characterCostReport('aws-polly', { standard: 400, neural: 1600 }),
        ).toEqual([
            {
                usageType: 'aws-polly:standard:character',
                ucentsPerUnit: 400,
                unit: 'character',
                source: 'driver:aiTts/aws-polly',
            },
            {
                usageType: 'aws-polly:neural:character',
                ucentsPerUnit: 1600,
                unit: 'character',
                source: 'driver:aiTts/aws-polly',
            },
        ]);
    });
});
