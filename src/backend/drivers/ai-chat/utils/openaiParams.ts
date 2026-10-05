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

/**
 * Dialect mapping between the normalized `ICompleteArguments` fields and the
 * three OpenAI-shaped wire conventions we speak: Chat Completions, Responses,
 * and OpenRouter (Chat Completions plus a couple of its own extras). One
 * mapping lives here instead of being hand-rolled per provider, so
 * `tool_choice`/`reasoning_effort`/etc. translate the same way everywhere.
 */

import type { ICompleteArguments, OutputFormat, ToolChoice } from '../types.js';

export type OpenAIDialect = 'chat' | 'responses' | 'openrouter';

// -- tool_choice ------------------------------------------------------------

/** Normalized `ToolChoice` → the wire shape each dialect accepts. */
export const toolChoiceToWire = (
    tc: ToolChoice,
    dialect: OpenAIDialect,
): unknown => {
    switch (tc.type) {
        case 'auto':
            return 'auto';
        case 'none':
            return 'none';
        case 'any':
            return 'required';
        case 'tool':
            return dialect === 'responses'
                ? { type: 'function', name: tc.name }
                : { type: 'function', function: { name: tc.name } };
        default:
            return undefined;
    }
};

/** The wire `tool_choice` a request carried → normalized `ToolChoice`. */
export const toolChoiceFromWire = (
    wire: unknown,
    dialect: OpenAIDialect,
): ToolChoice | undefined => {
    if (wire === 'auto') return { type: 'auto' };
    if (wire === 'none') return { type: 'none' };
    if (wire === 'required') return { type: 'any' };
    if (!wire || typeof wire !== 'object') return undefined;
    const w = wire as Record<string, unknown>;
    if (w.type !== 'function') return undefined;
    const name =
        dialect === 'responses'
            ? w.name
            : (w.function as Record<string, unknown> | undefined)?.name;
    return typeof name === 'string' ? { type: 'tool', name } : undefined;
};

// -- outputFormat / response_format / text.format ---------------------------

const jsonSchemaOf = (of: OutputFormat): Record<string, unknown> => ({
    name: of.name ?? 'response',
    schema: of.schema,
    ...(of.strict !== undefined ? { strict: of.strict } : {}),
});

/** Normalized `OutputFormat` → Chat Completions `response_format`. */
export const outputFormatToResponseFormat = (
    of: OutputFormat,
): Record<string, unknown> => ({
    type: 'json_schema',
    json_schema: jsonSchemaOf(of),
});

/** Normalized `OutputFormat` → Responses `text.format`. */
export const outputFormatToResponsesText = (
    of: OutputFormat,
): Record<string, unknown> => ({
    format: { type: 'json_schema', ...jsonSchemaOf(of) },
});

/**
 * Chat Completions `response_format` → normalized `OutputFormat`, json_schema
 * only.
 */
export const outputFormatFromResponseFormat = (
    rf: unknown,
): OutputFormat | undefined => {
    if (!rf || typeof rf !== 'object') return undefined;
    const r = rf as Record<string, unknown>;
    if (r.type !== 'json_schema') return undefined;
    const js = (r.json_schema as Record<string, unknown> | undefined) ?? {};
    if (!js.schema || typeof js.schema !== 'object') return undefined;
    return {
        type: 'json_schema',
        schema: js.schema as Record<string, unknown>,
        ...(typeof js.name === 'string' ? { name: js.name } : {}),
        ...(typeof js.strict === 'boolean' ? { strict: js.strict } : {}),
    };
};

/** Responses `text.format` → normalized `OutputFormat`, json_schema only. */
export const outputFormatFromResponsesText = (
    text: unknown,
): OutputFormat | undefined => {
    if (!text || typeof text !== 'object') return undefined;
    const format = (text as Record<string, unknown>).format;
    if (!format || typeof format !== 'object') return undefined;
    const f = format as Record<string, unknown>;
    if (f.type !== 'json_schema' || !f.schema || typeof f.schema !== 'object') {
        return undefined;
    }
    return {
        type: 'json_schema',
        schema: f.schema as Record<string, unknown>,
        ...(typeof f.name === 'string' ? { name: f.name } : {}),
        ...(typeof f.strict === 'boolean' ? { strict: f.strict } : {}),
    };
};

// -- the combined per-dialect mapper -----------------------------------------

/**
 * Maps the shared normalized fields (`tool_choice`, `parallel_tool_calls`,
 * `stopSequences`, `outputFormat`, `top_p`, `topK`, `reasoning_effort`) to the
 * wire shape a given OpenAI-family dialect expects. Spread the result into the
 * provider's own SDK params object — every key is included only when the
 * corresponding normalized field was set, so it never clobbers a field the
 * caller builds itself.
 */
export const openAICompatParams = (
    args: ICompleteArguments,
    dialect: OpenAIDialect,
): Record<string, unknown> => {
    const out: Record<string, unknown> = {};

    if (args.tool_choice !== undefined) {
        const wire = toolChoiceToWire(args.tool_choice, dialect);
        if (wire !== undefined) out.tool_choice = wire;
    }
    if (args.parallel_tool_calls !== undefined) {
        out.parallel_tool_calls = args.parallel_tool_calls;
    }
    // Responses has no `stop` equivalent — the design drops it there rather
    // than approximating with post-hoc truncation.
    if (dialect !== 'responses' && args.stopSequences?.length) {
        out.stop = args.stopSequences;
    }
    if (args.outputFormat) {
        if (dialect === 'responses') {
            out.text = outputFormatToResponsesText(args.outputFormat);
        } else {
            out.response_format = outputFormatToResponseFormat(
                args.outputFormat,
            );
        }
    }
    if (args.top_p !== undefined) out.top_p = args.top_p;
    // top_k has no Chat Completions / Responses equivalent — OpenRouter is the
    // one dialect that forwards it to whichever upstream model supports it.
    if (dialect === 'openrouter' && args.topK !== undefined) {
        out.top_k = args.topK;
    }
    if (args.reasoning_effort) {
        if (dialect === 'chat') {
            out.reasoning_effort = args.reasoning_effort;
        } else {
            out.reasoning = { effort: args.reasoning_effort };
        }
    }

    return out;
};
