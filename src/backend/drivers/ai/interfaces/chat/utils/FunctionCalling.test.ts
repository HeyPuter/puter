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
// @ts-expect-error — sibling JS module without an adjacent .d.ts
import {
    normalize_json_schema,
    normalize_tools_object,
} from './FunctionCalling.js';

// Both exports are pure data transforms — these tests just feed
// inputs and check the normalized output, no service mocks involved.

// ── normalize_json_schema ───────────────────────────────────────────

describe('normalize_json_schema', () => {
    it('returns the schema unchanged when falsy', () => {
        expect(normalize_json_schema(undefined)).toBeUndefined();
        expect(normalize_json_schema(null)).toBeNull();
    });

    it('returns object schemas without properties unchanged', () => {
        const schema = { type: 'object' };
        const out = normalize_json_schema(schema);
        // Same reference is returned — no clone is made.
        expect(out).toBe(schema);
    });

    it('recursively normalizes object property schemas', () => {
        const schema = {
            type: 'object',
            properties: {
                items: { type: 'array' },
                nested: {
                    type: 'object',
                    properties: { inner: { type: 'array' } },
                },
            },
        };
        const out = normalize_json_schema(schema);
        // Empty `items` is filled in for every array branch reachable
        // from the root.
        expect(out.properties.items.items).toEqual({});
        expect(out.properties.nested.properties.inner.items).toEqual({});
    });

    it('fills in `items: {}` for arrays that omit it', () => {
        expect(normalize_json_schema({ type: 'array' })).toEqual({
            type: 'array',
            items: {},
        });
    });

    it('recursively normalizes the items schema of arrays', () => {
        const schema = {
            type: 'array',
            items: {
                type: 'object',
                properties: { sub: { type: 'array' } },
            },
        };
        const out = normalize_json_schema(schema);
        expect(out.items.properties.sub.items).toEqual({});
    });
});

// ── normalize_tools_object ──────────────────────────────────────────

describe('normalize_tools_object', () => {
    it('keeps OpenAI Responses web_search tools as-is', () => {
        const tools = [{ type: 'web_search' }, { type: 'web_search_preview' }];
        const out = normalize_tools_object(tools);
        expect(out).toEqual([{ type: 'web_search' }, { type: 'web_search_preview' }]);
    });

    it('passes an Anthropic server/typed tool through verbatim by its id shape', () => {
        const tools = [
            { type: 'advisor_20260301', model: 'claude-haiku-4-5-20251001', max_uses: 2 },
        ];
        const out = normalize_tools_object(tools);
        expect(out).toEqual([
            { type: 'advisor_20260301', model: 'claude-haiku-4-5-20251001', max_uses: 2 },
        ]);
    });

    it('carries Claude-only extras on the function wrapper', () => {
        const out = normalize_tools_object([
            {
                type: 'function',
                function: { name: 'lookup', parameters: { type: 'object' } },
                cache_control: { type: 'ephemeral' },
                defer_loading: true,
                eager_input_streaming: true,
                input_examples: [{ q: 'x' }],
            },
        ]);
        expect(out[0]).toMatchObject({
            cache_control: { type: 'ephemeral' },
            defer_loading: true,
            eager_input_streaming: true,
            input_examples: [{ q: 'x' }],
        });
    });

    it('moves a top-level `strict` onto function.strict', () => {
        const out = normalize_tools_object([
            {
                name: 'lookup',
                input_schema: { type: 'object' },
                strict: true,
            },
        ]);
        expect(out[0].function.strict).toBe(true);
    });

    it('wraps a Claude-style {name, input_schema} tool into OpenAI shape', () => {
        const out = normalize_tools_object([
            {
                name: 'lookup',
                description: 'Search the docs',
                input_schema: {
                    type: 'object',
                    properties: { q: { type: 'string' } },
                },
            },
        ]);
        expect(out).toEqual([
            {
                type: 'function',
                function: {
                    name: 'lookup',
                    description: 'Search the docs',
                    parameters: {
                        type: 'object',
                        properties: { q: { type: 'string' } },
                    },
                },
            },
        ]);
    });

    it('unwraps an OpenAI-style {type:"function", function:{...}} tool', () => {
        const out = normalize_tools_object([
            {
                type: 'function',
                function: {
                    name: 'lookup',
                    parameters: {
                        type: 'object',
                        properties: { q: { type: 'string' } },
                    },
                },
            },
        ]);
        expect(out[0].type).toBe('function');
        expect(out[0].function.name).toBe('lookup');
        expect(out[0].function.parameters.properties.q).toEqual({
            type: 'string',
        });
    });

    it('defaults missing `parameters` to `{type: "object"}`', () => {
        const out = normalize_tools_object([
            { type: 'function', function: { name: 'noargs' } },
        ]);
        expect(out[0].function.parameters).toEqual({ type: 'object' });
    });

    it('infers `parameters.type = "object"` when missing', () => {
        const out = normalize_tools_object([
            {
                type: 'function',
                function: {
                    name: 'lookup',
                    parameters: { properties: { q: { type: 'string' } } },
                },
            },
        ]);
        expect(out[0].function.parameters.type).toBe('object');
    });

    it('falls back to wrapping `tool` itself for bare/unknown shapes', () => {
        // No `input_schema`, no `type === "function"` — accepted as the
        // function definition itself.
        const out = normalize_tools_object([
            {
                name: 'bare',
                parameters: { type: 'object', properties: {} },
            },
        ]);
        expect(out[0].type).toBe('function');
        expect(out[0].function.name).toBe('bare');
    });

    it('mutates the array in place and returns the same reference', () => {
        const tools = [{ name: 'lookup', input_schema: { type: 'object' } }];
        const out = normalize_tools_object(tools);
        expect(out).toBe(tools);
    });

    it.each([
        ['an object', { name: 'lookup' }],
        ['a string', 'lookup'],
    ])('throws 400 when tools is %s', (_label, tools) => {
        expect(() => normalize_tools_object(tools)).toThrow(
            expect.objectContaining({ statusCode: 400 }),
        );
    });

    it.each([
        ['null', null],
        ['a string', 'lookup'],
        ['an array', [{ name: 'lookup' }]],
    ])('throws 400 when a tool entry is %s', (_label, tool) => {
        expect(() => normalize_tools_object([tool])).toThrow(
            expect.objectContaining({ statusCode: 400 }),
        );
    });

    it('leaves non-object `properties` alone instead of recursing into it', () => {
        const out = normalize_tools_object([
            { name: 'lookup', parameters: { type: 'object', properties: 'x' } },
        ]);
        expect(out[0].function.parameters.properties).toBe('x');
    });
});
