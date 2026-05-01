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

/**
 * Types for the `puter-chat-completion` driver interface.
 *
 * No openai SDK type dependency. The PuterMessage type is intentionally
 * loose; each provider normalises internally.
 */

export type ModelCost = Record<string, number>;

export interface ModelModalities {
    input: string[];
    output: string[];
}

export interface IChatModel<T extends ModelCost = ModelCost> extends Record<
    string,
    unknown
> {
    id: string;
    provider?: string;
    puterId?: string;
    aliases?: string[];
    costs_currency: string;
    input_cost_key?: keyof T;
    output_cost_key?: keyof T;
    costs: T;
    context?: number;
    max_tokens: number;
    subscriberOnly?: boolean;
    minimumCredits?: number;
    modalities?: ModelModalities;
    open_weights?: boolean;
    tool_call?: boolean;
    knowledge?: string;
    release_date?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PuterMessage = any;

export interface ICompleteArguments {
    messages: PuterMessage[];
    provider?: string;
    stream?: boolean;
    model: string;
    tools?: unknown[];
    tool_choice?: unknown;
    parallel_tool_calls?: boolean;
    include?: unknown[];
    conversation?: unknown;
    previous_response_id?: string;
    instructions?: string | PuterMessage[];
    metadata?: Record<string, string>;
    prompt?: unknown;
    prompt_cache_key?: string;
    prompt_cache_retention?: 'in-memory' | '24h' | undefined;
    store?: boolean;
    top_p?: number;
    truncation?: 'auto' | 'disabled' | undefined;
    background?: boolean;
    service_tier?:
        | 'auto'
        | 'default'
        | 'flex'
        | 'scale'
        | 'priority'
        | undefined;
    max_tokens?: number;
    temperature?: number;
    reasoning?: { effort: 'low' | 'medium' | 'high' } | undefined;
    text?: string & { verbosity?: 'concise' | 'detailed' | undefined };
    reasoning_effort?: 'low' | 'medium' | 'high' | undefined;
    verbosity?: 'concise' | 'detailed' | undefined;
    moderation?: boolean;
    custom?: unknown;
    response?: {
        normalize?: boolean;
    };
    customLimitMessage?: string;
}

export interface IChatStreamResult {
    init_chat_stream: (params: { chatStream: unknown }) => Promise<void>;
    stream: true;
    finally_fn: () => Promise<void>;
    message?: never;
    usage?: never;
    finish_reason?: never;
}

export interface IChatMessageResult {
    message: PuterMessage;
    usage: Record<string, number>;
    finish_reason: string;
    init_chat_stream?: never;
    stream?: never;
    finally_fn?: never;
    normalized?: boolean;
}

export type IChatCompleteResult = IChatStreamResult | IChatMessageResult;

export interface IChatProvider {
    models(extra_params?: unknown): IChatModel[] | Promise<IChatModel[]>;
    list(): string[] | Promise<string[]>;
    getDefaultModel(): string;
    complete(arg: ICompleteArguments): Promise<IChatCompleteResult>;
}
