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

import { describe, expect, it } from 'vitest';
import {
    makeMeteringStub,
    optionalEnv,
    withTestActor,
} from '../../integrationTestUtil.js';
import type {
    IChatMessageResult,
    IChatProvider,
    ICompleteArguments,
} from '../types.js';
import { OpenAiResponsesChatProvider } from '../providers/openai/OpenAiChatResponsesProvider.js';
import { GeminiChatProvider } from '../providers/gemini/GeminiChatProvider.js';
import { MiniMaxProvider } from '../providers/minimax/MiniMaxProvider.js';
import { MoonshotProvider } from '../providers/moonshot/MoonshotProvider.js';
import { MistralAIProvider } from '../providers/mistral/MistralAiProvider.js';
import { selectServiceSpeed } from './serviceSpeed.js';

type Case = {
    name: string;
    env: string;
    provider: string;
    model: string;
    build: (key: string) => IChatProvider;
};
const cases: Case[] = [
    {
        name: 'OpenAI Ultrafast',
        env: 'PUTER_TEST_AI_OPENAI_API_KEY',
        provider: 'openai-responses',
        model: 'gpt-6.1-sol',
        build: (key) =>
            new OpenAiResponsesChatProvider(
                { apiKey: key },
                makeMeteringStub(),
            ),
    },
    {
        name: 'Gemini Priority',
        env: 'PUTER_TEST_AI_GEMINI_API_KEY',
        provider: 'gemini',
        model: 'gemini-3.8-flash',
        build: (key) =>
            new GeminiChatProvider({ apiKey: key }, makeMeteringStub()),
    },
    {
        name: 'MiniMax Priority',
        env: 'PUTER_TEST_AI_MINIMAX_API_KEY',
        provider: 'minimax',
        model: 'minimax-m3',
        build: (key) =>
            new MiniMaxProvider({ apiKey: key }, makeMeteringStub()),
    },
    {
        name: 'Moonshot Highspeed',
        env: 'PUTER_TEST_AI_MOONSHOT_API_KEY',
        provider: 'moonshotai',
        model: 'kimi-k3.1-pro',
        build: (key) =>
            new MoonshotProvider({ apiKey: key }, makeMeteringStub()),
    },
    {
        name: 'Mistral served tier',
        env: 'PUTER_TEST_AI_MISTRAL_API_KEY',
        provider: 'mistral',
        model: 'mistral-medium-latest',
        build: (key) =>
            new MistralAIProvider({ apiKey: key }, makeMeteringStub()),
    },
];

for (const testCase of cases) {
    describe.skipIf(!optionalEnv(testCase.env))(
        `serviceSpeed ${testCase.name} (integration)`,
        () => {
            it(
                'completes with a selected speed and normalized text',
                { timeout: 90_000 },
                async () => {
                    const provider = testCase.build(optionalEnv(testCase.env)!);
                    const catalog = (await provider.models()).map((model) => ({
                        ...model,
                        provider: testCase.provider,
                    }));
                    const base = catalog.find(
                        (model) =>
                            model.id === testCase.model ||
                            model.aliases?.includes(testCase.model),
                    )!;
                    expect(base).toBeDefined();
                    const args: ICompleteArguments = {
                        model: base.id,
                        messages: [
                            { role: 'user', content: 'Reply with exactly OK.' },
                        ],
                        serviceSpeed: 'ultrafast',
                        max_tokens: 256,
                        reasoning_effort: 'low',
                        normalize: true,
                    };
                    const selection = selectServiceSpeed(base, args, (id) =>
                        catalog.find((model) => model.id === id),
                    );
                    expect(selection.speed).toBe(
                        testCase.provider === 'openai-responses'
                            ? 'ultrafast'
                            : 'fast',
                    );
                    const result = (await withTestActor(() =>
                        provider.complete(
                            { ...selection.args, model: selection.model.id },
                            selection.model,
                        ),
                    )) as IChatMessageResult;
                    expect(typeof result.message.content).toBe('string');
                    expect(result.message.content.length).toBeGreaterThan(0);
                    if (
                        ['openai-responses', 'gemini', 'minimax'].includes(
                            testCase.provider,
                        )
                    )
                        expect(result.usageDetails?.serviceSpeed).toBe(
                            selection.speed,
                        );
                },
            );
        },
    );
}
