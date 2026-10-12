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
import type { Actor } from '../../../core/actor.js';
import { ALIBABA_MODELS } from '../providers/alibaba/models.js';
import { BYTEPLUS_MODELS } from '../providers/byteplus/models.js';
import { DEEPSEEK_MODELS } from '../providers/deepseek/models.js';
import { GROQ_MODELS } from '../providers/groq/models.js';
import { HOONIFY_MODELS } from '../providers/hoonify/models.js';
import { MINIMAX_MODELS } from '../providers/minimax/models.js';
import { MISTRAL_MODELS } from '../providers/mistral/models.js';
import { MOONSHOT_MODELS } from '../providers/moonshot/models.js';
import { ZAI_MODELS } from '../providers/zai/models.js';
import type { IChatModel } from '../types.js';
import { meterChatUsage } from './meterChatUsage.js';
import { splitCachedPrompt } from './OpenAIUtil.js';
import { usageCost } from './pricing.js';

type Recorded = [Record<string, number>, string, Record<string, number>];

const recordingMetering = () => {
    const calls: Recorded[] = [];
    return {
        calls,
        metering: {
            utilRecordUsageObject: (
                usage: Record<string, number>,
                _actor: Actor,
                key: string,
                costs?: Record<string, number>,
            ) => {
                calls.push([usage, key, costs ?? {}]);
                return Promise.resolve({ total: 0 } as never);
            },
        },
    };
};

const actor = {} as Actor;
const model = {
    id: 'm',
    costs_currency: 'usd-cents',
    input_cost_key: 'prompt_tokens',
    output_cost_key: 'completion_tokens',
    costs: { tokens: 1_000_000, prompt_tokens: 3, completion_tokens: 15 },
    max_tokens: 1024,
} as IChatModel;

/** Priced like a gateway catalog entry (OpenRouter, Infron). */
const gatewayModel = {
    id: 'gw',
    costs_currency: 'usd-cents',
    input_cost_key: 'prompt',
    output_cost_key: 'completion',
    costs: {
        tokens: 1_000_000,
        prompt: 200,
        completion: 1000,
        input_cache_read: 20,
        request: 0,
    },
    max_tokens: 1024,
} as IChatModel;

describe('meterChatUsage', () => {
    it('records the usage at the model rates and returns what it recorded', () => {
        const { calls, metering } = recordingMetering();
        const usage = { prompt_tokens: 10, completion_tokens: 2 };

        const result = meterChatUsage(metering, actor, 'p:m', model, usage);

        expect(calls).toEqual([
            [usage, 'p:m', { prompt_tokens: 30, completion_tokens: 30 }],
        ]);
        expect(result).toEqual({
            usage,
            costs: { prompt_tokens: 30, completion_tokens: 30 },
        });
    });

    it('lets a cost override win over the model rates', () => {
        const { calls, metering } = recordingMetering();
        meterChatUsage(
            metering,
            actor,
            'p:m',
            model,
            { prompt_tokens: 10, web_search_calls: 2 },
            { costOverrides: { web_search_calls: 1000 } },
        );
        expect(calls[0]![2]).toEqual({
            prompt_tokens: 30,
            web_search_calls: 1000,
        });
    });

    it('bills an authoritative USD cost as one line and zeroes the tokens', () => {
        const { calls, metering } = recordingMetering();
        const result = meterChatUsage(
            metering,
            actor,
            'gw:m',
            model,
            { prompt: 10, completion: 2 },
            { authoritativeUsd: 0.25 },
        );

        expect(calls).toEqual([
            [
                { prompt: 10, completion: 2, billedUsage: 1 },
                'gw:m',
                { prompt: 0, completion: 0, billedUsage: 25_000_000 },
            ],
        ]);
        expect(result.usage).toEqual({
            prompt: 10,
            completion: 2,
            billedUsage: 1,
            usd_cents: 25,
        });
    });

    it('reports an authoritative bill split across input and output at the model rates', () => {
        const { metering } = recordingMetering();
        // 600·200 + 400·20 + 1·0 on the input side, 100·1000 on the output.
        const result = meterChatUsage(
            metering,
            actor,
            'gw:m',
            gatewayModel,
            { prompt: 600, completion: 100, input_cache_read: 400, request: 1 },
            { authoritativeUsd: 0.0123 },
        );

        const cost = usageCost(result.usage, gatewayModel, result.costs);
        expect(cost).toEqual({
            inputMicroCents: 1_230_000 - 539_474,
            outputMicroCents: Math.round((1_230_000 * 100_000) / 228_000),
        });
    });

    it('reports exactly the billed µ¢ however the bill divides', () => {
        const { metering } = recordingMetering();
        for (const usd of [0.000012345, 0.0000001, 0.987654321]) {
            const result = meterChatUsage(
                metering,
                actor,
                'gw:m',
                gatewayModel,
                { prompt: 7, completion: 3, input_cache_read: 1, request: 1 },
                { authoritativeUsd: usd },
            );
            const cost = usageCost(result.usage, gatewayModel, result.costs)!;
            expect(cost.inputMicroCents + cost.outputMicroCents).toBe(
                Math.round(usd * 100_000_000),
            );
            expect(cost.outputMicroCents).toBeGreaterThan(0);
        }
    });

    it('reports a free authoritative bill as free', () => {
        const { metering } = recordingMetering();
        const result = meterChatUsage(
            metering,
            actor,
            'gw:m',
            gatewayModel,
            { prompt: 10, completion: 2 },
            { authoritativeUsd: 0 },
        );
        expect(usageCost(result.usage, gatewayModel, result.costs)).toEqual({
            inputMicroCents: 0,
            outputMicroCents: 0,
        });
    });

    it('keeps an authoritative bill on the input side when the model has no rates', () => {
        const { metering } = recordingMetering();
        const unpriced = { ...gatewayModel, costs: {} } as IChatModel;
        const result = meterChatUsage(
            metering,
            actor,
            'gw:m',
            unpriced,
            { prompt: 10, completion: 2 },
            { authoritativeUsd: 0.25 },
        );
        expect(usageCost(result.usage, unpriced, result.costs)).toEqual({
            inputMicroCents: 25_000_000,
            outputMicroCents: 0,
        });
    });
});

// Every catalog the hand-rolled `amount * costs[key]` pricing used to bill.
// A cached read is priced once, at the model's cache rate, or at its input
// rate when it publishes none; it is never free on a paid model.
describe('cached reads on OpenAI-compatible catalogs', () => {
    const catalogs: [string, readonly IChatModel[]][] = [
        ['alibaba', ALIBABA_MODELS],
        ['byteplus', BYTEPLUS_MODELS],
        ['deepseek', DEEPSEEK_MODELS],
        ['groq', GROQ_MODELS],
        ['hoonify', HOONIFY_MODELS],
        ['minimax', MINIMAX_MODELS],
        ['mistral', MISTRAL_MODELS],
        ['moonshotai', MOONSHOT_MODELS],
        ['zai', ZAI_MODELS],
    ];
    const cases = catalogs.flatMap(([provider, models]) =>
        models.map((m) => [`${provider}:${m.id}`, m] as const),
    );

    it.each(cases)('%s', (_name, m) => {
        const { calls, metering } = recordingMetering();
        meterChatUsage(
            metering,
            actor,
            'k',
            m,
            splitCachedPrompt({
                prompt_tokens: 1_000_000,
                completion_tokens: 100_000,
                prompt_tokens_details: { cached_tokens: 200_000 },
                total_tokens: 1_100_000,
            }),
        );
        const costs = m.costs as Record<string, number>;
        const cachedRate = costs.cached_tokens ?? costs.prompt_tokens;
        expect(calls[0]![2]).toEqual({
            prompt_tokens: 800_000 * costs.prompt_tokens,
            completion_tokens: 100_000 * costs.completion_tokens,
            cached_tokens: 200_000 * cachedRate,
        });
        if (costs.prompt_tokens > 0) expect(cachedRate).toBeGreaterThan(0);
    });
});


it('uses the request instant for scheduled prices even when usage is recorded later', () => {
    const { metering, calls } = recordingMetering();
    const scheduled = { ...gatewayModel, pricingOverrides: [{ utcStart: 1630, utcEnd: 30, costs: { prompt: 400, completion: 1500 } }] };
    meterChatUsage(metering, actor, 'scheduled', scheduled, { prompt: 100, completion: 10 },
        { pricingTime: new Date('2026-10-12T16:30:00Z') });
    expect(calls[0][2]).toEqual({ prompt: 40000, completion: 15000 });
});
