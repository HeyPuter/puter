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

import { describe, expect, it } from 'vitest';
import type { IChatModel, ServiceSpeed } from '../types.js';
import { ALIBABA_MODELS } from '../providers/alibaba/models.js';
import { AZURE_MODELS } from '../providers/azure/models.js';
import { BYTEPLUS_MODELS } from '../providers/byteplus/models.js';
import { CLAUDE_MODELS } from '../providers/claude/models.js';
import { DEEPSEEK_MODELS } from '../providers/deepseek/models.js';
import { GEMINI_MODELS } from '../providers/gemini/models.js';
import { GROQ_MODELS } from '../providers/groq/models.js';
import { HOONIFY_MODELS } from '../providers/hoonify/models.js';
import { META_MODELS } from '../providers/meta/models.js';
import { MINIMAX_MODELS } from '../providers/minimax/models.js';
import { MISTRAL_MODELS } from '../providers/mistral/models.js';
import { MOONSHOT_MODELS } from '../providers/moonshot/models.js';
import { OPEN_AI_MODELS } from '../providers/openai/models.js';
import { XAI_MODELS } from '../providers/xai/models.js';
import { ZAI_MODELS } from '../providers/zai/models.js';
import { shouldPresentAsOpenAI } from './normalizeToOpenAI.js';
import {
    isServiceSpeedUnavailable,
    lowerServiceSpeed,
    selectServiceSpeed,
    servedServiceSpeed,
    serviceSpeedBillingModel,
} from './serviceSpeed.js';

const catalogs: Array<[string, IChatModel[]]> = [
    ['alibaba', ALIBABA_MODELS],
    ['azure-openai', AZURE_MODELS],
    ['byteplus', BYTEPLUS_MODELS],
    ['claude', CLAUDE_MODELS],
    ['deepseek', DEEPSEEK_MODELS],
    ['gemini', GEMINI_MODELS],
    ['groq', GROQ_MODELS],
    ['hoonify', HOONIFY_MODELS],
    ['meta', META_MODELS],
    ['minimax', MINIMAX_MODELS],
    ['mistral', MISTRAL_MODELS],
    ['moonshotai', MOONSHOT_MODELS],
    ['openai-completion', OPEN_AI_MODELS],
    ['openai-responses', OPEN_AI_MODELS],
    ['xai', XAI_MODELS],
    ['zai', ZAI_MODELS],
];
const speeds: ServiceSpeed[] = ['standard', 'fast', 'ultrafast'];

describe('service speed seeded fuzzing', () => {
    it('preserves catalog, request, normalization, and billing invariants across model changes', () => {
        let seed = 0x51eed;
        const pick = <T>(values: T[]): T => {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            return values[seed % values.length]!;
        };
        const seenProviders = new Set<string>();
        for (let index = 0; index < 10_000; index++) {
            const [provider, catalog] = pick(catalogs);
            seenProviders.add(provider);
            const base = { ...structuredClone(pick(catalog)), provider };
            const before = structuredClone(base);
            Object.freeze(base.costs);
            Object.freeze(base);
            const args = Object.freeze({
                model: base.id,
                messages: [{ role: 'user', content: `Case ${index}` }],
                serviceSpeed: pick([...speeds, undefined]),
                normalize: pick([true, false, undefined]),
                temperature: pick([0, 0.5, 1]),
                service_tier: pick(['flex' as const, 'ultrafast' as const, undefined]),
                speed: pick(['standard' as const, 'fast' as const, undefined]),
            });
            const selected = selectServiceSpeed(base, args, (id) => {
                const variant = catalog.find((entry) => entry.id === id);
                return variant && { ...variant, provider };
            });
            expect(base).toEqual(before);
            expect(selected.args.messages).toBe(args.messages);
            expect(selected.args.temperature).toBe(args.temperature);
            expect(selected.model.provider).toBe(provider);
            expect(selected.model.release_date).toBe(base.release_date);
            expect(
                shouldPresentAsOpenAI(selected.args, selected.model.release_date),
            ).toBe(shouldPresentAsOpenAI(args, base.release_date));
            if (args.serviceSpeed === undefined) {
                expect(selected.args).toBe(args);
                expect(selected.model).toBe(base);
                continue;
            }
            expect(speeds.indexOf(selected.speed)).toBeLessThanOrEqual(
                speeds.indexOf(args.serviceSpeed),
            );
            expect(selected.args.serviceSpeed).toBe(selected.speed);
            if (args.serviceSpeed === 'standard') {
                expect(selected.args.speed).not.toBe('fast');
                expect(selected.args.service_tier).not.toBe('ultrafast');
            }
            for (const cost of Object.values(selected.model.costs)) {
                expect(Number.isFinite(cost)).toBe(true);
                expect(cost).toBeGreaterThanOrEqual(0);
            }
            if (selected.model.serviceSpeedPricing) {
                const settled = serviceSpeedBillingModel(selected.model, 'standard');
                expect(settled.costs).toEqual(base.costs);
                expect(settled.pricingOverrides).toEqual(base.pricingOverrides);
            }
            let speed = selected.speed;
            for (let attempts = 0; speed !== 'standard'; attempts++) {
                expect(attempts).toBeLessThan(2);
                speed = lowerServiceSpeed(speed);
            }
        }
        expect([...seenProviders].sort()).toEqual(catalogs.map(([provider]) => provider).sort());
    });

    it('handles malformed upstream tier and admission-error metadata without coercion or retries', () => {
        const values = [null, false, 0, 429, '', 'unrelated', [], {},
            ['service_tier capacity unavailable'],
            { toString: null }, { toString: 'priority capacity unavailable' }];
        for (const value of values) {
            expect(isServiceSpeedUnavailable(value)).toBe(false);
            for (const status of [undefined, 400, 401, 403, 404, 429, 500, 503]) {
                for (const variant of [false, true]) {
                    expect(isServiceSpeedUnavailable({ status, message: value }, variant)).toBe(false);
                    expect(isServiceSpeedUnavailable({ status, error: { message: value } }, variant)).toBe(false);
                }
            }
            expect(servedServiceSpeed({ usage: value })).toBe('standard');
            expect(servedServiceSpeed({ service_tier: value })).toBe('standard');
            expect(servedServiceSpeed({ usage: { speed: value, service_tier: value } })).toBe('standard');
        }
    });
});
