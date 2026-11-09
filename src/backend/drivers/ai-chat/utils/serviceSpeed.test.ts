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
import { Writable } from 'node:stream';
import { AIChatStream } from './Streaming.js';
import {
    handle_completion_output,
    handle_completion_output_responses_api,
} from './OpenAIUtil.js';
import type { IChatModel, ServiceSpeed } from '../types.js';
import {
    selectServiceSpeed,
    servedServiceSpeed,
    serviceSpeedBillingModel,
    isServiceSpeedUnavailable,
} from './serviceSpeed.js';
import { meterChatUsage } from './meterChatUsage.js';
import { OPEN_AI_MODELS } from '../providers/openai/models.js';
import { XAI_MODELS } from '../providers/xai/models.js';
import { GEMINI_MODELS } from '../providers/gemini/models.js';
import { CLAUDE_MODELS } from '../providers/claude/models.js';

const model = (provider: string, id: string): IChatModel => ({
    provider,
    id,
    serviceSpeedRates: [...OPEN_AI_MODELS, ...XAI_MODELS, ...GEMINI_MODELS, ...CLAUDE_MODELS]
        .find((entry) => entry.id === id)?.serviceSpeedRates,
    costs_currency: 'usd-cents',
    input_cost_key: 'prompt_tokens',
    output_cost_key: 'completion_tokens',
    max_tokens: 1000,
    costs: {
        tokens: 1_000_000,
        prompt_tokens: 200,
        completion_tokens: 1000,
        cached_tokens: 10,
        web_search_requests: 1_000_000,
    },
});
const request = (serviceSpeed?: ServiceSpeed) => ({
    model: 'test',
    messages: [{ role: 'user', content: 'Hello' }],
    serviceSpeed,
});
const noVariant = () => undefined;

describe('service speed selection', () => {
    it.each([2, { prompt_tokens: 400, completion_tokens: 2000 }])(
        'uses catalog rates independently of provider and model names: %j',
        (rates) => {
            const entry = {
                ...model('catalog-provider', 'renamed-model'),
                serviceSpeedRates: { fast: rates },
            };
            const selected = selectServiceSpeed(entry, request('ultrafast'), noVariant);
            expect(selected.speed).toBe('fast');
            expect(selected.model.costs.prompt_tokens).toBe(400);
            expect(selected.model.costs.completion_tokens).toBe(2000);
            expect(entry.costs.prompt_tokens).toBe(200);
        },
    );
    it('preserves an omitted option and native parameters', () => {
        const entry = model('openai-responses', 'gpt-6.1-sol');
        const args = { ...request(), service_tier: 'flex' as const };
        const selected = selectServiceSpeed(entry, args, noVariant);
        expect(selected.model).toBe(entry);
        expect(selected.args).toBe(args);
    });
    it.each([
        'deepseek',
        'zai',
        'groq',
        'byteplus',
        'together-ai',
        'meta',
        'ollama',
        'hoonify',
        'neuralwatt',
        'fake-chat',
    ])('uses standard when %s has no verified faster offering', (provider) => {
        const selected = selectServiceSpeed(
            model(provider, 'some-model'),
            request('ultrafast'),
            noVariant,
        );
        expect(selected.speed).toBe('standard');
        expect(selected.args.service_tier).toBeUndefined();
    });
    it.each(['standard', 'fast', 'ultrafast'] as const)(
        'selects %s without changing the model or catalog prices',
        (speed) => {
            const entry = model('openai-responses', 'gpt-6.1-sol');
            const selected = selectServiceSpeed(
                entry,
                request(speed),
                noVariant,
            );
            expect(selected.speed).toBe(speed);
            expect(selected.model.id).toBe(entry.id);
            expect(selected.model.costs.prompt_tokens).toBe(
                200 * { standard: 1, fast: 2, ultrafast: 6 }[speed],
            );
            expect(selected.model.costs.web_search_requests).toBe(1_000_000);
            expect(entry.costs.prompt_tokens).toBe(200);
        },
    );
    it('downgrades ultrafast to fast on a model without ultrafast', () => {
        const selected = selectServiceSpeed(
            model('xai', 'grok-4.7'),
            request('ultrafast'),
            noVariant,
        );
        expect(selected.speed).toBe('fast');
        expect(selected.args.service_tier).toBe('priority');
    });
    it('keeps a compatibility-only Gemini deployment at standard speed', () => {
        const entry = {
            ...model('gemini', 'gemini-3.8-flash'),
            serviceSpeeds: ['standard'] as ServiceSpeed[],
        };
        expect(
            selectServiceSpeed(entry, request('ultrafast'), noVariant).speed,
        ).toBe('standard');
    });
    it('uses Claude speed independently of its service tier', () => {
        const entry = model('claude', 'claude-opus-5-5');
        expect(
            selectServiceSpeed(entry, request('ultrafast'), noVariant).args
                .speed,
        ).toBe('fast');
        expect(
            selectServiceSpeed(entry, request('ultrafast'), noVariant).args
                .service_tier,
        ).toBeUndefined();
        expect(
            servedServiceSpeed({
                usage: { speed: 'fast', service_tier: 'standard' },
            }),
        ).toBe('fast');
    });
    it.each([
        ['minimax', 'minimax-m2.7', 'minimax-m2.7-highspeed'],
        ['moonshotai', 'kimi-k3.1-pro', 'kimi-k3.1-pro-highspeed'],
        ['alibaba', 'glm-5.3', 'glm-5.3-prime'],
        ['alibaba', 'glm-5.2', 'glm-5.2-fast-preview'],
        ['infron', 'infron:vendor/model', 'infron:vendor/model:priority'],
    ])(
        'selects an equivalent %s variant and preserves normalization policy',
        (provider, id, variantId) => {
            const base = {
                ...model(provider, id),
                serviceSpeedVariants: { fast: variantId },
                release_date: '2026-08-01',
            };
            const variant = {
                ...model(provider, variantId),
                release_date: '2026-10-01',
            };
            const selected = selectServiceSpeed(
                base,
                request('ultrafast'),
                (candidate) => (candidate === variantId ? variant : undefined),
            );
            expect(selected.model.id).toBe(variantId);
            expect(selected.model.release_date).toBe(base.release_date);
            expect(selected.speed).toBe('fast');
            expect(
                selectServiceSpeed(base, request('fast'), noVariant).speed,
            ).toBe('standard');
        },
    );
    it('keeps caller media on Gemini compatibility when native speed cannot carry it', () => {
        const args = {
            ...request('fast'),
            messages: [
                {
                    role: 'user',
                    content: [
                        {
                            type: 'video_url',
                            video_url: { url: 'data:video/mp4;base64,AA==' },
                        },
                    ],
                },
            ],
        };
        expect(
            selectServiceSpeed(
                model('gemini', 'gemini-3.8-flash'),
                args,
                noVariant,
            ).speed,
        ).toBe('standard');
    });
});

describe('served speed billing', () => {
    it.each(['standard', 'fast', 'ultrafast'] as const)(
        'settles an ultrafast hold at the served %s rate',
        (speed) => {
            const selected = selectServiceSpeed(
                model('openai-responses', 'gpt-6.1-sol'),
                request('ultrafast'),
                noVariant,
            ).model;
            const recorded: Array<Record<string, number> | undefined> = [];
            const meter = {
                utilRecordUsageObject: (
                    _usage: Record<string, number>,
                    _actor: unknown,
                    _key: string,
                    costs?: Record<string, number>,
                ) => {
                    recorded.push(costs);
                },
            };
            const result = meterChatUsage(
                meter as never,
                undefined,
                'openai:gpt-6.1-sol',
                selected,
                { prompt_tokens: 10, completion_tokens: 5, cached_tokens: 20 },
                { serviceSpeed: speed },
            );
            expect(result.costs.prompt_tokens).toBe(
                2000 * { standard: 1, fast: 2, ultrafast: 6 }[speed],
            );
            expect(result.costs.cached_tokens).toBe(
                200 * { standard: 1, fast: 2, ultrafast: 6 }[speed],
            );
            expect(recorded).toEqual([result.costs]);
        },
    );
    it('restores standard scheduled and long-context rates after a downgrade', () => {
        const entry = model('openai-responses', 'gpt-6.1-sol');
        entry.pricingOverrides = [
            {
                minPromptTokens: 100,
                costs: { prompt_tokens: 400, completion_tokens: 1500 },
            },
        ];
        const selected = selectServiceSpeed(
            entry,
            request('ultrafast'),
            noVariant,
        ).model;
        expect(
            serviceSpeedBillingModel(selected, 'standard').pricingOverrides,
        ).toEqual(entry.pricingOverrides);
        expect(
            serviceSpeedBillingModel(selected, 'fast').pricingOverrides?.[0]
                .costs.prompt_tokens,
        ).toBe(800);
    });
    it.each([
        [{ service_tier: 'priority' }, 'fast'],
        [{ usage: { serviceTier: 'priority' } }, 'fast'],
        [{ usage: { service_tier: 'standard' } }, 'standard'],
        [{ service_tier: 'ultrafast' }, 'ultrafast'],
        [{}, 'standard'],
    ])('reads actual speed from %j', (source, speed) => {
        expect(servedServiceSpeed(source)).toBe(speed);
    });
});

describe('speed admission failures', () => {
    it.each([
        [{ status: 429, message: 'Fast mode rate limit exceeded' }, true],
        [{ status: 403, message: 'Ultrafast access unavailable' }, true],
        [{ status: 400, message: 'service_tier is not supported' }, true],
        [{ status: 401, message: 'Invalid API key' }, false],
        [{ status: 429, message: 'Rate limit exceeded' }, false],
        [{ status: 400, message: 'Invalid messages' }, false],
    ])('classifies %j without swallowing unrelated errors', (error, retry) => {
        expect(isServiceSpeedUnavailable(error)).toBe(retry);
    });
    it('downgrades a missing speed variant without retrying an invalid base model', () => {
        const error = { status: 404, message: 'Model not found' };
        expect(isServiceSpeedUnavailable(error, true)).toBe(true);
        expect(isServiceSpeedUnavailable(error)).toBe(false);
    });
});

describe('streamed service tier metadata', () => {
    it('retains a tier from an earlier Chat Completions chunk until usage arrives', async () => {
        let servedTier: string | undefined;
        const result = await handle_completion_output({
            stream: true,
            completion: (async function* () {
                yield {
                    service_tier: 'priority',
                    choices: [{ index: 0, delta: { content: 'OK' } }],
                };
                yield {
                    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
                };
                yield {
                    choices: [],
                    usage: { prompt_tokens: 10, completion_tokens: 1 },
                };
            })(),
            usage_calculator: (source) => {
                servedTier = source.service_tier;
                return source.usage;
            },
        });
        const chatStream = new AIChatStream({
            stream: new Writable({
                write(_chunk, _encoding, callback) {
                    callback();
                },
            }),
        });
        await result.init_chat_stream!({ chatStream });
        expect(servedTier).toBe('priority');
    });

    it('uses the final Responses tier when the provider downgrades a stream', async () => {
        let servedTier: string | undefined;
        const result = await handle_completion_output_responses_api({
            stream: true,
            completion: (async function* () {
                yield {
                    type: 'response.created',
                    response: { service_tier: 'ultrafast' },
                };
                yield { type: 'response.output_text.delta', delta: 'OK' };
                yield {
                    type: 'response.completed',
                    response: {
                        service_tier: 'default',
                        usage: { input_tokens: 10, output_tokens: 1 },
                    },
                };
            })(),
            usage_calculator: (source) => {
                servedTier = source.service_tier;
                return source.usage;
            },
        });
        const chatStream = new AIChatStream({
            stream: new Writable({
                write(_chunk, _encoding, callback) {
                    callback();
                },
            }),
        });
        await result.init_chat_stream!({ chatStream });
        expect(servedTier).toBe('default');
    });
});
