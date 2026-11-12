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
import { responseSamplingParams } from './responseSampling.js';

describe('responseSamplingParams', () => {
    it('preserves supported options and does not mutate include', () => {
        const params = {
            temperature: 0,
            top_p: 0,
            include: ['message.output_text.logprobs'],
        };
        expect(responseSamplingParams({}, params, undefined)).toEqual(params);
    });

    it.each([undefined, 'low', 'medium', 'high'] as const)(
        'omits sampling with reasoning effort %s',
        (effort) => {
            const params = {
                temperature: 0.4,
                top_p: 0.9,
                include: [
                    'message.output_text.logprobs',
                    'file_search_call.results',
                ],
            };
            expect(
                responseSamplingParams(
                    { responsesSampling: 'reasoningDisabled' },
                    params,
                    effort,
                ),
            ).toEqual({ include: ['file_search_call.results'] });
            expect(params.include).toEqual([
                'message.output_text.logprobs',
                'file_search_call.results',
            ]);
        },
    );

    it('omits sampling for an unrestricted model with reasoning enabled', () => {
        expect(
            responseSamplingParams(
                {},
                { temperature: 0.4, top_p: 0.9 },
                'high',
            ),
        ).toEqual({});
    });

    it('preserves sampling when reasoning is explicitly disabled', () => {
        const params = { temperature: 0.4, top_p: 0.9 };
        expect(
            responseSamplingParams(
                { responsesSampling: 'reasoningDisabled' },
                params,
                'none',
            ),
        ).toEqual(params);
    });

    it('omits sampling for models that never support it even with effort none', () => {
        expect(
            responseSamplingParams(
                { responsesSampling: 'never' },
                {
                    temperature: 0.4,
                    top_p: 0.9,
                    include: ['message.output_text.logprobs'],
                },
                'none',
            ),
        ).toEqual({ include: [] });
    });

    it.each([{}, { responsesSampling: 'never' } as const])(
        'omits absent options for %j',
        (model) => {
            expect(responseSamplingParams(model, {}, undefined)).toEqual({});
        },
    );
});
