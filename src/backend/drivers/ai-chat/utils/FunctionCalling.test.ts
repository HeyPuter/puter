/**
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
    make_claude_tools,
    make_openai_tools,
    normalize_json_schema,
    normalize_tools_object,
} from './FunctionCalling.js';

// All four exports are pure data transforms — these tests just feed
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
        const tools = [{ type: 'web_search' }];
        const out = normalize_tools_object(tools);
        expect(out).toEqual([{ type: 'web_search' }]);
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
        const tools = [
            { name: 'lookup', input_schema: { type: 'object' } },
        ];
        const out = normalize_tools_object(tools);
        expect(out).toBe(tools);
    });
});

// ── make_openai_tools ───────────────────────────────────────────────

describe('make_openai_tools', () => {
    it('is the identity function (normalized format already matches OpenAI)', () => {
        const tools = [
            {
                type: 'function',
                function: {
                    name: 'lookup',
                    parameters: { type: 'object' },
                },
            },
        ];
        expect(make_openai_tools(tools)).toBe(tools);
    });
});

// ── make_claude_tools ───────────────────────────────────────────────

describe('make_claude_tools', () => {
    it('returns undefined when tools is undefined', () => {
        expect(make_claude_tools(undefined)).toBeUndefined();
    });

    it('returns [] when tools is an empty array', () => {
        expect(make_claude_tools([])).toEqual([]);
    });

    it('flattens the OpenAI {function:{...}} wrapper into Claude shape', () => {
        const out = make_claude_tools([
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
        expect(out).toEqual([
            {
                name: 'lookup',
                description: 'Search the docs',
                input_schema: {
                    type: 'object',
                    properties: { q: { type: 'string' } },
                },
            },
        ]);
    });
});
