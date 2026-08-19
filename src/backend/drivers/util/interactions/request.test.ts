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
    messagesToInteractionsInput,
    toGenerationConfig,
    toolsToInteractionsTools,
} from './request.js';

describe('messagesToInteractionsInput', () => {
    it('hoists system messages into system_instruction', () => {
        const { input, system_instruction } = messagesToInteractionsInput([
            { role: 'system', content: 'be terse' },
            { role: 'system', content: 'be kind' },
            { role: 'user', content: 'hi' },
        ]);

        expect(system_instruction).toBe('be terse\n\nbe kind');
        expect(input).toEqual([
            { role: 'user', content: [{ type: 'text', text: 'hi' }] },
        ]);
    });

    it('maps assistant turns to the model role', () => {
        const { input } = messagesToInteractionsInput([
            { role: 'user', content: 'hi' },
            { role: 'assistant', content: 'hello' },
        ]);

        expect(input.map((turn) => turn.role)).toEqual(['user', 'model']);
    });

    it('splits a data url into inline bytes and a mime type', () => {
        const { input } = messagesToInteractionsInput([
            {
                role: 'user',
                content: [
                    { type: 'text', text: 'what is this' },
                    {
                        type: 'image_url',
                        image_url: { url: 'data:image/jpeg;base64,QUJD' },
                    },
                ],
            },
        ]);

        expect(input[0].content).toEqual([
            { type: 'text', text: 'what is this' },
            { type: 'image', data: 'QUJD', mime_type: 'image/jpeg' },
        ]);
    });

    it('passes a remote image through as a uri', () => {
        const { input } = messagesToInteractionsInput([
            {
                role: 'user',
                content: [
                    {
                        type: 'image_url',
                        image_url: { url: 'https://example.com/cat.png' },
                    },
                ],
            },
        ]);

        expect(input[0].content).toEqual([
            { type: 'image', uri: 'https://example.com/cat.png' },
        ]);
    });

    it('converts tool calls to function_call blocks with parsed arguments', () => {
        const { input } = messagesToInteractionsInput([
            {
                role: 'assistant',
                content: null,
                tool_calls: [
                    {
                        id: 'call_1',
                        type: 'function',
                        function: {
                            name: 'get_weather',
                            arguments: '{"city":"Zagreb"}',
                        },
                    },
                ],
            },
        ]);

        expect(input[0]).toEqual({
            role: 'model',
            content: [
                {
                    type: 'function_call',
                    id: 'call_1',
                    name: 'get_weather',
                    arguments: { city: 'Zagreb' },
                },
            ],
        });
    });

    it('round-trips a thought signature back to the model', () => {
        const { input } = messagesToInteractionsInput([
            {
                role: 'assistant',
                content: null,
                tool_calls: [
                    {
                        id: 'call_1',
                        type: 'function',
                        function: { name: 'f', arguments: '{}' },
                        extra_content: { signature: 'sig-abc' },
                    },
                ],
            },
        ]);

        expect(
            (input[0].content as Record<string, unknown>[])[0],
        ).toMatchObject({ signature: 'sig-abc' });
    });

    it('degrades unparseable tool arguments to an empty object', () => {
        const { input } = messagesToInteractionsInput([
            {
                role: 'assistant',
                content: null,
                tool_calls: [
                    {
                        id: 'call_1',
                        type: 'function',
                        function: { name: 'f', arguments: '{"a":' },
                    },
                ],
            },
        ]);

        expect(
            (input[0].content as Record<string, unknown>[])[0],
        ).toMatchObject({ arguments: {} });
    });

    it('merges consecutive tool results into one user turn', () => {
        const { input } = messagesToInteractionsInput([
            { role: 'tool', tool_call_id: 'call_1', content: 'sunny' },
            { role: 'tool', tool_call_id: 'call_2', content: 'warm' },
        ]);

        expect(input).toHaveLength(1);
        expect(input[0]).toEqual({
            role: 'user',
            content: [
                { type: 'function_result', call_id: 'call_1', result: 'sunny' },
                { type: 'function_result', call_id: 'call_2', result: 'warm' },
            ],
        });
    });

    it('drops empty messages rather than emitting contentless turns', () => {
        const { input } = messagesToInteractionsInput([
            { role: 'user', content: '' },
            { role: 'user', content: 'real' },
        ]);

        expect(input).toEqual([
            { role: 'user', content: [{ type: 'text', text: 'real' }] },
        ]);
    });
});

describe('toolsToInteractionsTools', () => {
    it('flattens OpenAI function declarations', () => {
        expect(
            toolsToInteractionsTools([
                {
                    type: 'function',
                    function: {
                        name: 'get_weather',
                        description: 'looks up weather',
                        parameters: { type: 'object' },
                    },
                },
            ]),
        ).toEqual([
            {
                type: 'function',
                name: 'get_weather',
                description: 'looks up weather',
                parameters: { type: 'object' },
            },
        ]);
    });

    it('passes native Interactions tools through untouched', () => {
        const googleSearch = { type: 'google_search' };
        expect(toolsToInteractionsTools([googleSearch])).toEqual([
            googleSearch,
        ]);
    });

    it('returns undefined for an empty tool list', () => {
        expect(toolsToInteractionsTools([])).toBeUndefined();
        expect(toolsToInteractionsTools(undefined)).toBeUndefined();
    });
});

describe('toGenerationConfig', () => {
    it('returns undefined when the caller set nothing', () => {
        expect(toGenerationConfig({})).toBeUndefined();
    });

    it('maps sampling knobs onto their Interactions names', () => {
        expect(
            toGenerationConfig({
                max_tokens: 100,
                temperature: 0.2,
                top_p: 0.9,
            }),
        ).toEqual({
            max_output_tokens: 100,
            temperature: 0.2,
            top_p: 0.9,
        });
    });

    it("translates OpenAI 'required' tool choice to 'any'", () => {
        expect(toGenerationConfig({ tool_choice: 'required' })).toEqual({
            tool_choice: 'any',
        });
    });

    it('narrows a named tool choice to that tool', () => {
        expect(
            toGenerationConfig({
                tool_choice: { type: 'function', function: { name: 'f' } },
            }),
        ).toEqual({
            tool_choice: { allowed_tools: { mode: 'any', tools: ['f'] } },
        });
    });

    it('asks for thought summaries whenever an effort level is set', () => {
        expect(toGenerationConfig({ reasoning_effort: 'high' })).toEqual({
            thinking_level: 'high',
            thinking_summaries: 'auto',
        });
    });
});
