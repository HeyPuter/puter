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

import { HttpError } from '@heyputer/backend/src/core/http';
import { claudeToolPolicy } from '../providers/claude/anthropicPolicy.js';

// Anthropic server/typed tool ids (`web_search_20250305`,
// `advisor_20260301`, …) and the OpenAI Responses `web_search` tool pass
// through this normalizer untouched — they carry their own wire shape, not
// an OpenAI function definition.
const SERVER_TOOL_TYPE = /^[a-z_]+_\d{8}$/;

export const normalize_json_schema = (schema) => {
    if (!schema) return schema;

    if (schema.type === 'object') {
        if (!schema.properties || typeof schema.properties !== 'object') {
            return schema;
        }

        const keys = Object.keys(schema.properties);
        for (const key of keys) {
            schema.properties[key] = normalize_json_schema(
                schema.properties[key],
            );
        }
    }

    if (schema.type === 'array') {
        if (!schema.items) {
            schema.items = {};
        } else {
            schema.items = normalize_json_schema(schema.items);
        }
    }

    return schema;
};

/**
 * Normalizes the 'tools' object in-place.
 *
 * This function will accept an array of tools provided by the user, and produce
 * a normalized object that can then be converted to the apprpriate
 * representation for another service.
 *
 * We will accept conventions from either service that a user might expect to
 * work, prioritizing the OpenAI convention when conflicting conventions are
 * present.
 *
 * @param {any} tools
 */
export const normalize_tools_object = (tools) => {
    if (!Array.isArray(tools)) {
        throw new HttpError(400, '`tools` must be an array', {
            legacyCode: 'bad_request',
        });
    }
    for (let i = 0; i < tools.length; i++) {
        const tool = tools[i];
        if (!tool || typeof tool !== 'object' || Array.isArray(tool)) {
            throw new HttpError(400, 'each tool must be an object', {
                legacyCode: 'bad_request',
            });
        }

        if (tool.type === 'web_search' || tool.type === 'web_search_preview') {
            // OpenAI Responses specific
            continue;
        }
        // Anthropic server/typed tool — stays in its own wire shape; policy
        // (clamps, allowlist, rejects) is applied per-provider downstream
        // (`claudeToolPolicy`), not here.
        if (typeof tool.type === 'string' && SERVER_TOOL_TYPE.test(tool.type)) {
            continue;
        }
        let normalized_tool = {};

        const normalize_function = (fn) => {
            const normal_fn = {};
            let parameters = fn.parameters || fn.input_schema;

            if (!parameters || typeof parameters !== 'object') {
                parameters = { type: 'object' };
            } else if (!parameters.type) {
                parameters.type = 'object';
            }

            normal_fn.parameters = parameters;

            if (parameters.properties) {
                parameters = normalize_json_schema(parameters);
            }

            if (fn.name) {
                normal_fn.name = fn.name;
            }

            if (fn.description) {
                normal_fn.description = fn.description;
            }

            if (fn.strict !== undefined) {
                normal_fn.strict = fn.strict;
            }

            return normal_fn;
        };

        // Claude-only extras, carried on the `{type:'function', ...}`
        // wrapper so `make_claude_tools` can forward them; a top-level
        // `strict` (Claude's own convention) moves onto `function.strict`.
        const extras = {};
        if (tool.cache_control !== undefined)
            extras.cache_control = tool.cache_control;
        if (tool.defer_loading !== undefined)
            extras.defer_loading = tool.defer_loading;
        if (tool.eager_input_streaming !== undefined) {
            extras.eager_input_streaming = tool.eager_input_streaming;
        }
        if (tool.input_examples !== undefined)
            extras.input_examples = tool.input_examples;

        const buildFunction = (fn) => {
            const normal_fn = normalize_function(fn);
            if (tool.strict !== undefined && normal_fn.strict === undefined) {
                normal_fn.strict = tool.strict;
            }
            return normal_fn;
        };

        if (tool.input_schema) {
            normalized_tool = {
                type: 'function',
                function: buildFunction(tool),
                ...extras,
            };
        } else if (tool.type === 'function') {
            normalized_tool = {
                type: 'function',
                function: buildFunction(tool.function || tool),
                ...extras,
            };
        } else {
            normalized_tool = {
                type: 'function',
                function: buildFunction(tool),
                ...extras,
            };
        }

        tools[i] = normalized_tool;
    }
    return tools;
};

// OpenAI's own tool conventions pass through untouched.
const OPENAI_NATIVE_WEB_SEARCH = new Set(['web_search', 'web_search_preview']);
const ANTHROPIC_WEB_SEARCH_TYPE = (type) =>
    type === 'web_search_20250305' || /^web_search_2026/.test(type ?? '');

/**
 * Converts a normalized tools object to the format expected by an OpenAI-family
 * dialect: function tools drop their Anthropic-only extras (`cache_control`,
 * `defer_loading`, `eager_input_streaming`, `input_examples`); every other
 * Anthropic typed/server tool (`web_search_20250305`, `advisor_20260301`,
 * `bash_*`, …) is dropped, since none of it is a wire shape OpenAI recognizes.
 * The one exception: an Anthropic web-search tool is translated to OpenAI's own
 * `web_search` tool for the Responses dialect, which supports it natively.
 *
 * @param {any} tools
 * @param {{ dialect?: 'chat' | 'responses' }} [opts]
 * @returns {any[] | undefined}
 */
export const make_openai_tools = (tools, opts = {}) => {
    if (!tools) return tools;
    const dialect = opts.dialect ?? 'chat';
    const out = [];
    for (const tool of tools) {
        if (!tool || typeof tool !== 'object') continue;
        if (tool.type === 'function') {
            const stripped = { ...tool };
            delete stripped.cache_control;
            delete stripped.defer_loading;
            delete stripped.eager_input_streaming;
            delete stripped.input_examples;
            out.push(stripped);
            continue;
        }
        if (OPENAI_NATIVE_WEB_SEARCH.has(tool.type)) {
            out.push(tool);
            continue;
        }
        if (dialect === 'responses' && ANTHROPIC_WEB_SEARCH_TYPE(tool.type)) {
            out.push({
                type: 'web_search',
                ...(tool.allowed_domains
                    ? { filters: { allowed_domains: tool.allowed_domains } }
                    : {}),
                ...(tool.user_location
                    ? { user_location: tool.user_location }
                    : {}),
            });
            continue;
        }
        // Any other Anthropic typed/server tool (web_search_* on the chat
        // dialect, advisor, bash, memory, web_fetch, tool_search, …) has no
        // OpenAI equivalent — drop it rather than forward an unrecognized type.
    }
    return out;
};

/**
 * This function will convert a normalized tools object to the format expected
 * by Claude: function tools become `{name, description, input_schema, ...}`,
 * and typed/server tools (`web_search`, `web_search_20250305`,
 * `advisor_20260301`, …) go through the allowlist/clamp/reject policy in
 * `claudeToolPolicy` instead of being treated as malformed function
 * definitions.
 *
 * @param {any} tools
 * @param {{ models?: import('../types.js').IChatModel[] }} [opts]
 * @returns {any[] | undefined}
 */
export const make_claude_tools = (tools, opts = {}) => {
    if (!tools) return undefined;
    return claudeToolPolicy(tools, opts.models ?? []).tools;
};
