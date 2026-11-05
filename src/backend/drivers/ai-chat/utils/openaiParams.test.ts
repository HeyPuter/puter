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

import type { ICompleteArguments } from '../types.js';
import {
    clampReasoningEffort,
    messagesHaveCacheBreakpointTtl,
    openAICompatParams,
    outputFormatFromResponseFormat,
    outputFormatFromResponsesText,
    outputFormatToResponseFormat,
    outputFormatToResponsesText,
    promptCacheOptionsToWire,
    promptCacheRetentionToWire,
    rejectStatefulResponsesFields,
    toolChoiceFromWire,
    toolChoiceToWire,
} from './openaiParams.js';

const args = (partial: Partial<ICompleteArguments>): ICompleteArguments =>
    ({ messages: [], model: 'x', ...partial }) as ICompleteArguments;

// -- tool_choice ------------------------------------------------------

describe('toolChoiceToWire', () => {
    it.each(['chat', 'openrouter'] as const)(
        'maps auto/none/any to the flat string vocabulary (%s)',
        (dialect) => {
            expect(toolChoiceToWire({ type: 'auto' }, dialect)).toBe('auto');
            expect(toolChoiceToWire({ type: 'none' }, dialect)).toBe('none');
            expect(toolChoiceToWire({ type: 'any' }, dialect)).toBe(
                'required',
            );
        },
    );

    it('maps a named tool to {type:function,function:{name}} for chat/openrouter', () => {
        expect(
            toolChoiceToWire({ type: 'tool', name: 'lookup' }, 'chat'),
        ).toEqual({ type: 'function', function: { name: 'lookup' } });
    });

    it('maps a named tool to {type:function,name} for responses (no nested function)', () => {
        expect(
            toolChoiceToWire({ type: 'tool', name: 'lookup' }, 'responses'),
        ).toEqual({ type: 'function', name: 'lookup' });
        expect(toolChoiceToWire({ type: 'auto' }, 'responses')).toBe('auto');
    });
});

describe('toolChoiceFromWire', () => {
    it('maps the flat string vocabulary back to normalized ToolChoice', () => {
        expect(toolChoiceFromWire('auto', 'chat')).toEqual({ type: 'auto' });
        expect(toolChoiceFromWire('none', 'chat')).toEqual({ type: 'none' });
        expect(toolChoiceFromWire('required', 'chat')).toEqual({
            type: 'any',
        });
    });

    it('maps a chat-dialect function object back to a named tool', () => {
        expect(
            toolChoiceFromWire(
                { type: 'function', function: { name: 'lookup' } },
                'chat',
            ),
        ).toEqual({ type: 'tool', name: 'lookup' });
    });

    it('maps a responses-dialect function object (no nested function) back to a named tool', () => {
        expect(
            toolChoiceFromWire({ type: 'function', name: 'lookup' }, 'responses'),
        ).toEqual({ type: 'tool', name: 'lookup' });
    });

    it('returns undefined for an unrecognized shape', () => {
        expect(toolChoiceFromWire(undefined, 'chat')).toBeUndefined();
        expect(toolChoiceFromWire(42, 'chat')).toBeUndefined();
        expect(toolChoiceFromWire({ type: 'unknown' }, 'chat')).toBeUndefined();
    });
});

// -- outputFormat / response_format / text.format --------------------

describe('outputFormatToResponseFormat / outputFormatFromResponseFormat', () => {
    it('round-trips a json_schema OutputFormat through the chat response_format shape', () => {
        const of = {
            type: 'json_schema' as const,
            name: 'weather',
            schema: { type: 'object', properties: {} },
            strict: true,
        };
        const wire = outputFormatToResponseFormat(of);
        expect(wire).toEqual({
            type: 'json_schema',
            json_schema: {
                name: 'weather',
                schema: of.schema,
                strict: true,
            },
        });
        expect(outputFormatFromResponseFormat(wire)).toEqual(of);
    });

    it('defaults the schema name to "response" when none is given', () => {
        const wire = outputFormatToResponseFormat({
            type: 'json_schema',
            schema: { type: 'object' },
        });
        expect((wire.json_schema as Record<string, unknown>).name).toBe(
            'response',
        );
    });

    it('returns undefined for a non-json_schema or malformed response_format', () => {
        expect(outputFormatFromResponseFormat({ type: 'json_object' })).toBeUndefined();
        expect(outputFormatFromResponseFormat(undefined)).toBeUndefined();
        expect(
            outputFormatFromResponseFormat({ type: 'json_schema', json_schema: {} }),
        ).toBeUndefined();
    });
});

describe('outputFormatToResponsesText / outputFormatFromResponsesText', () => {
    it('round-trips a json_schema OutputFormat through the Responses text.format shape', () => {
        const of = {
            type: 'json_schema' as const,
            name: 'weather',
            schema: { type: 'object', properties: {} },
        };
        const wire = outputFormatToResponsesText(of);
        expect(wire).toEqual({
            format: { type: 'json_schema', name: 'weather', schema: of.schema },
        });
        expect(outputFormatFromResponsesText(wire)).toEqual(of);
    });

    it('returns undefined when there is no format or it is not json_schema', () => {
        expect(outputFormatFromResponsesText({})).toBeUndefined();
        expect(
            outputFormatFromResponsesText({ format: { type: 'text' } }),
        ).toBeUndefined();
    });
});

// -- openAICompatParams -----------------------------------------------

describe('openAICompatParams', () => {
    it('maps tool_choice, parallel_tool_calls, stop and response_format for the chat dialect', () => {
        const out = openAICompatParams(
            args({
                tools: [{ type: 'function', function: { name: 'lookup' } }],
                tool_choice: { type: 'tool', name: 'lookup' },
                parallel_tool_calls: false,
                stopSequences: ['STOP', 'END'],
                outputFormat: {
                    type: 'json_schema',
                    schema: { type: 'object' },
                },
                top_p: 0.9,
            }),
            'chat',
        );
        expect(out).toEqual({
            tool_choice: { type: 'function', function: { name: 'lookup' } },
            parallel_tool_calls: false,
            stop: ['STOP', 'END'],
            response_format: {
                type: 'json_schema',
                json_schema: { name: 'response', schema: { type: 'object' } },
            },
            top_p: 0.9,
        });
    });

    it('drops stop for the responses dialect and nests format under text', () => {
        const out = openAICompatParams(
            args({
                stopSequences: ['STOP'],
                outputFormat: {
                    type: 'json_schema',
                    schema: { type: 'object' },
                },
            }),
            'responses',
        );
        expect(out.stop).toBeUndefined();
        expect(out.text).toEqual({
            format: { type: 'json_schema', name: 'response', schema: { type: 'object' } },
        });
    });

    it('maps reasoning_effort flat for chat, nested under reasoning for responses/openrouter', () => {
        expect(
            openAICompatParams(args({ reasoning_effort: 'high' }), 'chat'),
        ).toEqual({ reasoning_effort: 'high' });
        expect(
            openAICompatParams(args({ reasoning_effort: 'high' }), 'responses'),
        ).toEqual({ reasoning: { effort: 'high' } });
        expect(
            openAICompatParams(args({ reasoning_effort: 'high' }), 'openrouter'),
        ).toEqual({ reasoning: { effort: 'high' } });
    });

    it('only forwards top_k for the openrouter dialect', () => {
        expect(openAICompatParams(args({ topK: 40 }), 'chat').top_k).toBeUndefined();
        expect(
            openAICompatParams(args({ topK: 40 }), 'openrouter').top_k,
        ).toBe(40);
    });

    it('omits tool_choice and parallel_tool_calls when no tool is sent', () => {
        for (const tools of [undefined, []]) {
            const out = openAICompatParams(
                args({
                    tools,
                    tool_choice: { type: 'auto' },
                    parallel_tool_calls: true,
                }),
                'chat',
            );
            expect(out).toEqual({});
        }
    });

    it('returns an empty object when nothing in args needs mapping', () => {
        expect(openAICompatParams(args({}), 'chat')).toEqual({});
    });

    it('keeps only the named keys when opts.only is set', () => {
        const out = openAICompatParams(
            args({
                tools: [{ type: 'function', function: { name: 'lookup' } }],
                tool_choice: { type: 'any' },
                parallel_tool_calls: true,
                stopSequences: ['STOP'],
                outputFormat: {
                    type: 'json_schema',
                    schema: { type: 'object' },
                },
                reasoning_effort: 'high',
            }),
            'chat',
            { only: ['tool_choice'] },
        );
        expect(out).toEqual({ tool_choice: 'required' });
    });

    it('drops a non-auto tool_choice when toolChoiceAutoOnly is set, keeps auto', () => {
        const toolArgs = (tool_choice: ICompleteArguments['tool_choice']) =>
            args({
                tools: [{ type: 'function', function: { name: 'lookup' } }],
                tool_choice,
            });
        expect(
            openAICompatParams(toolArgs({ type: 'any' }), 'chat', {
                toolChoiceAutoOnly: true,
            }),
        ).toEqual({});
        expect(
            openAICompatParams(toolArgs({ type: 'auto' }), 'chat', {
                toolChoiceAutoOnly: true,
            }),
        ).toEqual({ tool_choice: 'auto' });
    });
});

// -- clampReasoningEffort ----------------------------------------------

describe('clampReasoningEffort', () => {
    it.each([
        ['gpt-5.1', 'minimal', 'none'],
        ['gpt-5-nano', 'none', 'minimal'],
        ['gpt-5-pro', 'low', 'medium'],
        ['gpt-5.5', 'max', 'xhigh'],
        ['gpt-5', 'high', 'high'],
        ['gpt-6-astra-1', 'none', 'low'],
        ...(['none', 'low', 'medium', 'high', 'xhigh', 'max'] as const).map(
            (effort) => ['gpt-6.1-terra', effort, effort] as const,
        ),
    ] as const)(
        'clamps %s requesting %s to %s',
        (modelId, requested, expected) => {
            expect(clampReasoningEffort(modelId, requested)).toBe(expected);
        },
    );

    it('drops an unrecognized effort string', () => {
        expect(clampReasoningEffort('gpt-5', 'ultra')).toBeUndefined();
    });

    it('drops the param for a model with no reasoning controls at all', () => {
        expect(clampReasoningEffort('gpt-4o', 'high')).toBeUndefined();
    });

    it('drops the param when no effort was requested', () => {
        expect(clampReasoningEffort('gpt-5', undefined)).toBeUndefined();
    });
});

// -- rejectStatefulResponsesFields --------------------------------------

describe('rejectStatefulResponsesFields', () => {
    it('accepts background:false, the same as omitting it', () => {
        expect(() =>
            rejectStatefulResponsesFields({ background: false }),
        ).not.toThrow();
        expect(() => rejectStatefulResponsesFields({})).not.toThrow();
    });

    it('rejects a truthy background', () => {
        expect(() =>
            rejectStatefulResponsesFields({ background: true }),
        ).toThrow(/background/);
    });

    it('still rejects the other stateful fields on any non-null value', () => {
        expect(() =>
            rejectStatefulResponsesFields({ previous_response_id: 'resp_1' }),
        ).toThrow(/previous_response_id/);
    });
});

describe('promptCacheRetentionToWire', () => {
    it('spells the in-memory retention the way the upstreams expect', () => {
        expect(promptCacheRetentionToWire('in-memory')).toBe('in_memory');
        expect(promptCacheRetentionToWire('in_memory')).toBe('in_memory');
        expect(promptCacheRetentionToWire('24h')).toBe('24h');
        expect(promptCacheRetentionToWire(undefined)).toBeUndefined();
    });
});

describe('promptCacheOptionsToWire', () => {
    it('forwards mode and ttl and nothing else', () => {
        expect(
            promptCacheOptionsToWire({
                mode: 'explicit',
                ttl: '12h',
                prewarm: true,
                comparison_response_id: 'resp_1',
            }),
        ).toEqual({ mode: 'explicit', ttl: '12h' });
        expect(promptCacheOptionsToWire({ ttl: '30m' })).toEqual({
            ttl: '30m',
        });
    });

    it('sends nothing for an absent or empty object', () => {
        expect(promptCacheOptionsToWire(undefined)).toBeUndefined();
        expect(promptCacheOptionsToWire(null)).toBeUndefined();
        expect(promptCacheOptionsToWire({})).toBeUndefined();
        expect(promptCacheOptionsToWire({ prewarm: true })).toBeUndefined();
    });

    it('rejects a lifetime or mode OpenAI does not offer', () => {
        expect(() => promptCacheOptionsToWire({ ttl: '2h' })).toThrow(
            expect.objectContaining({ statusCode: 400 }),
        );
        expect(() => promptCacheOptionsToWire({ ttl: '24h' })).toThrow(
            /30m.*12h/,
        );
        expect(() => promptCacheOptionsToWire({ mode: 'auto' })).toThrow(
            /implicit.*explicit/,
        );
        expect(() => promptCacheOptionsToWire('12h')).toThrow(
            /must be an object/,
        );
    });
});

describe('messagesHaveCacheBreakpointTtl', () => {
    it('finds a breakpoint lifetime on any content part', () => {
        expect(
            messagesHaveCacheBreakpointTtl([
                { role: 'user', content: 'plain' },
                {
                    role: 'system',
                    content: [
                        { type: 'text', text: 'a' },
                        {
                            type: 'text',
                            text: 'b',
                            prompt_cache_breakpoint: {
                                mode: 'explicit',
                                ttl: '30m',
                            },
                        },
                    ],
                },
            ]),
        ).toBe(true);
        expect(
            messagesHaveCacheBreakpointTtl([
                {
                    role: 'user',
                    content: {
                        type: 'text',
                        text: 'a',
                        prompt_cache_breakpoint: { ttl: '12h' },
                    },
                },
            ]),
        ).toBe(true);
    });

    it('ignores breakpoints without a lifetime and odd message shapes', () => {
        expect(
            messagesHaveCacheBreakpointTtl([
                {
                    role: 'system',
                    content: [
                        {
                            type: 'text',
                            text: 'a',
                            prompt_cache_breakpoint: { mode: 'explicit' },
                        },
                        'bare string part',
                        null,
                    ],
                },
                { role: 'user', content: null },
                null,
            ]),
        ).toBe(false);
        expect(messagesHaveCacheBreakpointTtl(undefined)).toBe(false);
        expect(messagesHaveCacheBreakpointTtl('nope')).toBe(false);
    });
});
