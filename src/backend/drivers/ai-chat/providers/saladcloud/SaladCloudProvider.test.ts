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

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actor } from '../../../../core/actor.js';
import type { MeteringService } from '../../../../services/metering/MeteringService.js';
import {
    makeMeteringStub,
    withTestActor,
} from '../../../integrationTestUtil.js';
import type { ICompleteArguments } from '../../types.js';
import { SALADCLOUD_MODELS } from './models.js';
import { SaladCloudProvider } from './SaladCloudProvider.js';

const { createMock, openAICtor } = vi.hoisted(() => ({
    createMock: vi.fn(),
    openAICtor: vi.fn(),
}));

vi.mock('openai', () => {
    const OpenAICtor = vi.fn().mockImplementation(function (
        this: Record<string, unknown>,
        options: unknown,
    ) {
        openAICtor(options);
        this.chat = { completions: { create: createMock } };
    });
    return { OpenAI: OpenAICtor, default: { OpenAI: OpenAICtor } };
});

const completion = {
    choices: [
        {
            message: { content: 'hello', role: 'assistant' },
            finish_reason: 'stop',
        },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1 },
};

let metering: MeteringService;

const stores = {} as ConstructorParameters<typeof SaladCloudProvider>[2];
const fsService = {} as ConstructorParameters<typeof SaladCloudProvider>[3];

const makeProvider = (apiBaseUrl?: string) =>
    new SaladCloudProvider(
        { apiKey: 'test-key', apiBaseUrl },
        metering,
        stores,
        fsService,
    );

beforeEach(() => {
    createMock.mockReset();
    openAICtor.mockReset();
    metering = makeMeteringStub();
});

describe('SaladCloudProvider construction', () => {
    it('uses the SaladCloud API URL by default', () => {
        makeProvider();
        expect(openAICtor).toHaveBeenCalledWith({
            apiKey: 'test-key',
            baseURL: 'https://ai.salad.cloud/v1',
        });
    });

    it('accepts an API URL override', () => {
        makeProvider('https://salad.test/v1');
        expect(openAICtor).toHaveBeenCalledWith({
            apiKey: 'test-key',
            baseURL: 'https://salad.test/v1',
        });
    });
});

describe('SaladCloudProvider model catalog', () => {
    it('exposes only Qwen3.6 35B-A3B with SaladCloud pricing', async () => {
        const provider = makeProvider();
        expect(provider.models()).toBe(SALADCLOUD_MODELS);
        expect(provider.models()).toHaveLength(1);
        expect(provider.models()[0]).toMatchObject({
            id: 'saladcloud:qwen3.6-35b-a3b',
            context: 262_144,
            max_tokens: 262_144,
            costs: {
                tokens: 1_000_000,
                prompt_tokens: 9,
                completion_tokens: 60,
                cached_tokens: 9,
            },
            modalities: { input: ['text', 'image'], output: ['text'] },
            tool_call: true,
        });
        expect(await provider.list()).toEqual([
            'saladcloud:qwen3.6-35b-a3b',
            'saladcloud/qwen3.6-35b-a3b',
        ]);
    });
});

describe('SaladCloudProvider.complete', () => {
    it('strips the provider prefix and forwards supported options', async () => {
        const provider = makeProvider();
        createMock.mockResolvedValueOnce(completion);
        const tools = [
            {
                type: 'function',
                function: { name: 'lookup', parameters: {} },
            },
        ];

        await withTestActor(() =>
            provider.complete({
                model: 'saladcloud:qwen3.6-35b-a3b',
                messages: [{ role: 'user', content: 'hello' }],
                tools,
                tool_choice: 'auto',
                parallel_tool_calls: true,
                max_tokens: 32,
                temperature: 0,
                top_p: 0.8,
                reasoning: { effort: 'medium' },
                text: {
                    verbosity: 'low',
                } as ICompleteArguments['text'],
            }),
        );

        expect(createMock).toHaveBeenCalledWith({
            model: 'qwen3.6-35b-a3b',
            messages: [{ role: 'user', content: 'hello' }],
            tools,
            tool_choice: 'auto',
            parallel_tool_calls: true,
            max_tokens: 32,
            temperature: 0,
            top_p: 0.8,
            reasoning_effort: 'medium',
            verbosity: 'low',
            stream: false,
        });
    });

    it('resolves puter_path parts before sending image input upstream', async () => {
        const provider = makeProvider();
        createMock.mockResolvedValueOnce(completion);
        const part: Record<string, unknown> = {
            puter_path: '/system/picture.png',
        };

        await withTestActor(() =>
            provider.complete({
                model: 'saladcloud:qwen3.6-35b-a3b',
                messages: [{ role: 'user', content: [part] }],
            }),
        );

        expect(part).toEqual({
            type: 'text',
            text: '{error: unauthenticated caller cannot resolve puter_path; the user did not write this message}',
        });
        expect(createMock.mock.calls[0]![0].messages).toEqual([
            { role: 'user', content: [part] },
        ]);
    });

    it('identifies the Puter actor without sending OpenAI-only safety fields', async () => {
        const provider = makeProvider();
        createMock.mockResolvedValueOnce(completion);
        const actor = {
            user: { id: 42 },
            app: { uid: 'example-app' },
        } as Actor;

        await withTestActor(
            () =>
                provider.complete({
                    model: 'saladcloud:qwen3.6-35b-a3b',
                    messages: [{ role: 'user', content: 'hello' }],
                }),
            actor,
        );

        expect(createMock.mock.calls[0]![0]).toMatchObject({
            user: '42:example-app',
        });
        expect('safety_identifier' in createMock.mock.calls[0]![0]).toBe(false);
    });

    it('requests usage in streamed responses', async () => {
        const provider = makeProvider();
        createMock.mockReturnValueOnce({
            async *[Symbol.asyncIterator]() {
                yield { choices: [], usage: null };
            },
        });

        await withTestActor(() =>
            provider.complete({
                model: 'saladcloud/qwen3.6-35b-a3b',
                messages: [{ role: 'user', content: 'hello' }],
                stream: true,
            }),
        );

        expect(createMock.mock.calls[0]![0]).toMatchObject({
            model: 'qwen3.6-35b-a3b',
            stream: true,
            stream_options: { include_usage: true },
        });
    });

    it('meters uncached, cached, and completion tokens at published rates', async () => {
        const provider = makeProvider();
        const recordSpy = vi.spyOn(metering, 'utilRecordUsageObject');
        createMock.mockResolvedValueOnce({
            ...completion,
            usage: {
                prompt_tokens: 100,
                completion_tokens: 20,
                prompt_tokens_details: { cached_tokens: 10 },
            },
        });

        const result = await withTestActor(() =>
            provider.complete({
                model: 'saladcloud:qwen3.6-35b-a3b',
                messages: [{ role: 'user', content: 'hello' }],
            }),
        );

        expect((result as { usage: unknown }).usage).toEqual({
            prompt_tokens: 90,
            completion_tokens: 20,
            cached_tokens: 10,
        });
        expect(recordSpy).toHaveBeenCalledWith(
            {
                prompt_tokens: 90,
                completion_tokens: 20,
                cached_tokens: 10,
            },
            expect.anything(),
            'saladcloud:qwen3.6-35b-a3b',
            {
                prompt_tokens: 810,
                completion_tokens: 1200,
                cached_tokens: 90,
            },
        );
    });
});

describe('SaladCloudProvider moderation', () => {
    it('reports that moderation is not implemented', () => {
        expect(() => makeProvider().checkModeration('text')).toThrow(
            'Method not implemented.',
        );
    });
});
