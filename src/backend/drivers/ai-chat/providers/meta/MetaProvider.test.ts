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

import {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
    type MockInstance,
} from 'vitest';

import { SYSTEM_ACTOR } from '../../../../core/actor.js';
import type { MeteringService } from '../../../../services/metering/MeteringService.js';
import { PuterServer } from '../../../../server.js';
import { setupTestServer } from '../../../../testUtil.js';
import { withTestActor } from '../../../integrationTestUtil.js';
import { META_MODELS } from './models.js';
import { MetaProvider } from './MetaProvider.js';

const { createMock, openAICtor } = vi.hoisted(() => {
    const createMock = vi.fn();
    const openAICtor = vi.fn();
    return { createMock, openAICtor };
});

vi.mock('openai', () => {
    const OpenAICtor = vi.fn().mockImplementation(function (
        this: Record<string, unknown>,
        opts: unknown,
    ) {
        openAICtor(opts);
        this.chat = { completions: { create: createMock } };
    });
    return { OpenAI: OpenAICtor, default: { OpenAI: OpenAICtor } };
});

let server: PuterServer;
let recordSpy: MockInstance<MeteringService['utilRecordUsageObject']>;

beforeAll(async () => {
    server = await setupTestServer();
});

afterAll(async () => {
    await server?.shutdown();
});

const makeProvider = () => {
    const provider = new MetaProvider(
        { apiKey: 'test-meta-key' },
        server.services.metering,
    );
    return { provider };
};

beforeEach(() => {
    createMock.mockReset();
    openAICtor.mockReset();
    recordSpy = vi.spyOn(server.services.metering, 'utilRecordUsageObject');
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('MetaProvider', () => {
    it('points the OpenAI SDK at the Meta base URL with the configured key', () => {
        makeProvider();
        expect(openAICtor).toHaveBeenCalledTimes(1);
        expect(openAICtor).toHaveBeenCalledWith({
            apiKey: 'test-meta-key',
            baseURL: 'https://api.meta.ai/v1',
        });
    });

    it('returns available models', () => {
        const { provider } = makeProvider();
        const models = provider.models();
        expect(models.length).toBeGreaterThan(0);
        expect(models.some((m) => m.id === 'meta:muse-spark-1.2')).toBe(true);
    });

    it('returns default model as meta:muse-spark-1.2', () => {
        const { provider } = makeProvider();
        expect(provider.getDefaultModel()).toBe('meta:muse-spark-1.2');
    });

    it('returns model list and aliases', async () => {
        const { provider } = makeProvider();
        const list = await provider.list();
        expect(list).toContain('meta:muse-spark-1.2');
        expect(list).toContain('muse-spark-1.2');
    });

    it('completes chat request and calculates usage costs correctly using cost keys', async () => {
        const { provider } = makeProvider();
        createMock.mockResolvedValueOnce({
            choices: [
                {
                    message: { content: 'hello from muse', role: 'assistant' },
                    finish_reason: 'stop',
                },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
        });

        const result = await withTestActor(() =>
            provider.complete({
                model: 'muse-spark-1.2',
                messages: [{ role: 'user', content: 'hello' }],
            }),
        );

        expect(result).toMatchObject({
            message: { content: 'hello from muse', role: 'assistant' },
            finish_reason: 'stop',
        });

        expect(recordSpy).toHaveBeenCalledTimes(1);
        const [usage, actor, prefix, costsOverride] = recordSpy.mock.calls[0]!;
        expect(usage).toEqual({
            prompt_tokens: 10,
            completion_tokens: 5,
            cached_tokens: 0,
        });
        expect(actor).toBe(SYSTEM_ACTOR);
        expect(prefix).toBe('meta:muse-spark-1.2');
        // prompt_tokens: 10 * 125 = 1250, completion_tokens: 5 * 425 = 2125
        expect(costsOverride).toEqual({
            prompt_tokens: 1250,
            completion_tokens: 2125,
            cached_tokens: 0,
        });
    });
});
