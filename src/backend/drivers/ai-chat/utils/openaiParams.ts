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

import { HttpError } from '../../../core/http/HttpError.js';
import type {
    ICompleteArguments,
    OutputFormat,
    ReasoningEffort,
    ToolChoice,
} from '../types.js';

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

const TOOL_CHOICE_TYPES = new Set(['auto', 'any', 'none', 'tool']);

/**
 * Whether a value is already a normalized `ToolChoice` rather than a raw wire
 * form (`'auto'`, `{type:'function', function:{name}}`, …) a direct
 * `/drivers/call` caller might still send.
 */
export const isToolChoice = (value: unknown): value is ToolChoice =>
    !!value &&
    typeof value === 'object' &&
    TOOL_CHOICE_TYPES.has((value as { type?: unknown }).type as string);

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

// -- gpt-5/6 reasoning_effort clamp ------------------------------------------

/** `none < minimal < low < medium < high < xhigh < max`. */
const REASONING_LADDER: readonly ReasoningEffort[] = [
    'none',
    'minimal',
    'low',
    'medium',
    'high',
    'xhigh',
    'max',
];

/** First matching row wins; sourced from the OpenAI model pages. */
const REASONING_EFFORT_TABLE: {
    pattern: RegExp;
    allowed: readonly ReasoningEffort[];
}[] = [
    {
        pattern: /^gpt-6-astra|^gpt-6\.1-sol/,
        allowed: ['low', 'medium', 'high', 'xhigh', 'max'],
    },
    {
        pattern: /^gpt-(6|5\.6)[.-]/,
        allowed: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
    },
    {
        pattern: /^gpt-5(\.\d+)?-pro/,
        allowed: ['medium', 'high', 'xhigh'],
    },
    {
        pattern: /^gpt-5(\.\d+)?-codex/,
        allowed: ['low', 'medium', 'high', 'xhigh'],
    },
    {
        pattern: /^gpt-5\.1([.-]|$)/,
        allowed: ['none', 'low', 'medium', 'high'],
    },
    {
        pattern: /^gpt-5\.\d/,
        allowed: ['none', 'low', 'medium', 'high', 'xhigh'],
    },
    {
        pattern: /^gpt-5([.-]|$)/,
        allowed: ['minimal', 'low', 'medium', 'high'],
    },
];

/**
 * Clamps a requested `reasoning_effort` to the nearest value `modelId` actually
 * accepts, on the ladder above — ties round down. An effort string outside the
 * ladder, or a model matching none of the rows (no reasoning controls at all),
 * drops the param instead of guessing at a value the upstream might 400 on.
 */
export const clampReasoningEffort = (
    modelId: string,
    effort: string | undefined,
): ReasoningEffort | undefined => {
    const targetIndex = REASONING_LADDER.indexOf(effort as ReasoningEffort);
    if (targetIndex === -1) return undefined;
    const row = REASONING_EFFORT_TABLE.find(({ pattern }) =>
        pattern.test(modelId),
    );
    if (!row) return undefined;

    let best: ReasoningEffort | undefined;
    let bestDiff = Number.POSITIVE_INFINITY;
    let bestIndex = Number.POSITIVE_INFINITY;
    for (const candidate of row.allowed) {
        const index = REASONING_LADDER.indexOf(candidate);
        const diff = Math.abs(index - targetIndex);
        if (diff < bestDiff || (diff === bestDiff && index < bestIndex)) {
            best = candidate;
            bestDiff = diff;
            bestIndex = index;
        }
    }
    return best;
};

// -- the combined per-dialect mapper -----------------------------------------

/**
 * Maps the shared normalized fields (`tool_choice`, `parallel_tool_calls`,
 * `stopSequences`, `outputFormat`, `top_p`, `topK`, `reasoning_effort`) to the
 * wire shape a given OpenAI-family dialect expects. Spread the result into the
 * provider's own SDK params object — every key is included only when the
 * corresponding normalized field was set, so it never clobbers a field the
 * caller builds itself.
 *
 * `args.tools` must be the tool list actually being sent: `tool_choice` and
 * `parallel_tool_calls` are only emitted alongside tools, since Chat
 * Completions rejects either one in a request without them.
 *
 * `opts.toolChoiceAutoOnly` drops a non-`auto` `tool_choice` instead of
 * forwarding it, for providers that 400 on anything else. `opts.only` keeps
 * just the named keys — for a provider that only wants this mapper for one or
 * two fields and builds the rest of its request itself.
 */
export const openAICompatParams = (
    args: ICompleteArguments,
    dialect: OpenAIDialect,
    opts: { only?: string[]; toolChoiceAutoOnly?: boolean } = {},
): Record<string, unknown> => {
    const out: Record<string, unknown> = {};

    const hasTools = Array.isArray(args.tools) && args.tools.length > 0;
    if (
        hasTools &&
        args.tool_choice !== undefined &&
        (!opts.toolChoiceAutoOnly || args.tool_choice.type === 'auto')
    ) {
        const wire = toolChoiceToWire(args.tool_choice, dialect);
        if (wire !== undefined) out.tool_choice = wire;
    }
    if (hasTools && args.parallel_tool_calls !== undefined) {
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

    if (opts.only) {
        for (const key of Object.keys(out)) {
            if (!opts.only.includes(key)) delete out[key];
        }
    }

    return out;
};

// -- Responses server-side state ---------------------------------------------

const STATEFUL_RESPONSES_FIELDS = [
    'previous_response_id',
    'conversation',
    'prompt',
    'background',
] as const;

/**
 * Rejects the Responses fields that point at OpenAI-held, org-scoped state
 * (stored responses, conversations, dashboard prompts, background runs).
 * Enforced in the providers too, since `/drivers/call` reaches them directly.
 *
 * `background` is the one field accepted at its default: `background: false`
 * just asks for a synchronous response, same as omitting it, so only a truthy
 * value is rejected. The others reject on anything but absent/`null`.
 */
export const rejectStatefulResponsesFields = (
    args: Record<string, unknown>,
): void => {
    const field = STATEFUL_RESPONSES_FIELDS.find((key) =>
        key === 'background'
            ? !!args[key]
            : args[key] !== undefined && args[key] !== null,
    );
    if (field) {
        throw new HttpError(400, `\`${field}\` is not supported`, {
            legacyCode: 'bad_request',
        });
    }
};
