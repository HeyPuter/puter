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

import { afterEach, describe, expect, it, vi } from 'vitest';
import { OPEN_AI_MODELS } from './models.js';
import { selectServiceSpeed } from '../../../interfaces/chat/utils/serviceSpeed.js';

afterEach(() => vi.useRealTimers());

describe('GPT-6.2 catalog', () => {
    it.each([
        ['gpt-6.2-astra', '2026-05-18', 800, 40, 4000],
        ['gpt-6.2-sol', '2026-06-01', 200, 10, 1000],
    ])('publishes %s with vendor pricing and capabilities', (id, knowledge, input, cached, output) => {
        expect(OPEN_AI_MODELS.find((model) => model.id === id)).toMatchObject({
            puterId: `openai:openai/${id}`,
            aliases: [`openai/${id}`],
            knowledge,
            responses_api: true,
            responsesSampling: 'never',
            tool_call: true,
            modalities: { input: ['text', 'image'], output: ['text'] },
            context: 1_050_000,
            max_tokens: 128_000,
            costs_currency: 'usd-cents',
            costs: {
                tokens: 1_000_000,
                prompt_tokens: input,
                cached_tokens: cached,
                cache_write_tokens: Number(input) * 1.25,
                cache_write_12h_tokens: Number(input) * 2.5,
                completion_tokens: output,
            },
            long_context_pricing: { threshold: 272_000, input_multiplier: 2, output_multiplier: 1.5 },
        });
    });

    it.each(['gpt-6.2-astra', 'gpt-6.2-sol'])('updates %s Ultrafast rates at the Pacific promotion boundary', (id) => {
        const model = OPEN_AI_MODELS.find((entry) => entry.id === id)!;
        vi.useFakeTimers();
        for (const [time, multiplier] of [
            ['2027-03-01T07:59:59.999Z', 3],
            ['2027-03-01T08:00:00.000Z', 6],
        ] as const) {
            vi.setSystemTime(new Date(time));
            const selected = selectServiceSpeed(model, {
                messages: [{ role: 'user', content: 'Hello' }],
                serviceSpeed: 'ultrafast',
            }, () => undefined);
            expect(selected.speed).toBe('ultrafast');
            expect(selected.args.service_tier).toBe('ultrafast');
            for (const key of ['prompt_tokens', 'cached_tokens', 'cache_write_tokens', 'cache_write_12h_tokens', 'completion_tokens']) {
                expect(selected.model.costs[key]).toBe(model.costs[key] * multiplier);
            }
            expect(selected.model.costs.tokens).toBe(1_000_000);
        }
    });
});
