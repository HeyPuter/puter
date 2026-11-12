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
        // wrapper so `claudeToolPolicy` can forward them; a top-level
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
