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
import type { MeteringService } from '../../../services/metering/MeteringService.js';
import type {
    IChatMessageResult,
    IChatModel,
    ICompleteArguments,
} from '../types.js';
import {
    type OpenAICompatOptions,
    OpenAICompatProvider,
} from './OpenAICompatProvider.js';

const CATALOG: IChatModel[] = [
    {
        id: 'acme:Org/Model-X',
        aliases: ['model-x'],
        context: 1000,
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 10,
            completion_tokens: 20,
            cached_tokens: 1,
        },
        max_tokens: 500,
    },
];

const completion = {
    choices: [
        {
            message: { role: 'assistant', content: 'hi' },
            finish_reason: 'stop',
        },
    ],
    usage: {
        prompt_tokens: 100,
        completion_tokens: 10,
        prompt_tokens_details: { cached_tokens: 40 },
    },
};

/** An upstream that records what it was sent and answers from `replies`. */
const fakeUpstream = (...replies: unknown[]) => {
    const sent: Record<string, unknown>[] = [];
    return {
        sent,
        client: {
            chat: {
                completions: {
                    create: async (params: Record<string, unknown>) => {
                        sent.push(params);
                        const reply = replies.shift() ?? completion;
                        if (reply instanceof Error) throw reply;
                        return reply;
                    },
                },
            },
        },
    };
};

const recordingMetering = () => {
    const calls: unknown[][] = [];
    const metering = {
        utilRecordUsageObject: (...args: unknown[]) => {
            calls.push(args);
            return Promise.resolve({ total: 0 });
        },
    } as unknown as MeteringService;
    return { calls, metering };
};

const makeProvider = (
    options: Partial<OpenAICompatOptions>,
    ...replies: unknown[]
) => {
    const upstream = fakeUpstream(...replies);
    const { calls, metering } = recordingMetering();
    const provider = new OpenAICompatProvider(metering, {
        client: upstream.client as never,
        defaultModel: 'acme:Org/Model-X',
        models: () => CATALOG,
        ...options,
    });
    return { provider, sent: upstream.sent, meteringCalls: calls };
};

const complete = (
    provider: OpenAICompatProvider,
    args: Partial<ICompleteArguments>,
) =>
    provider.complete({
        messages: [{ role: 'user', content: 'hi' }],
        model: 'model-x',
        ...args,
    } as ICompleteArguments) as Promise<IChatMessageResult>;

describe('OpenAICompatProvider', () => {
    it('resolves an id case-insensitively and sends the catalog casing without the id prefix', async () => {
        const { provider, sent } = makeProvider({ idPrefix: 'acme:' });
        // The driver lowercases ids when it builds its model map.
        await complete(provider, { model: 'acme:org/model-x' });
        expect(sent[0]!.model).toBe('Org/Model-X');
    });

    it('builds the shared request from the vendor options', async () => {
        const { provider, sent } = makeProvider({
            defaultMaxTokens: 1000,
            maxTokensParam: 'max_completion_tokens',
            passthrough: ['temperature'],
        });
        await complete(provider, { temperature: 0.3, top_p: 0.9 });
        expect(sent[0]).toEqual({
            messages: [{ role: 'user', content: 'hi' }],
            model: 'acme:Org/Model-X',
            max_completion_tokens: 1000,
            temperature: 0.3,
            stream: false,
        });
    });

    it('sends function tools without Anthropic-only extras and drops server tools', async () => {
        const { provider, sent } = makeProvider({});
        const fn = {
            type: 'function',
            function: { name: 'lookup', parameters: { type: 'object' } },
        };
        await complete(provider, {
            tools: [
                { ...fn, cache_control: { type: 'ephemeral' } },
                { type: 'web_search_20250305', name: 'web_search' },
            ],
        });
        expect(sent[0]!.tools).toEqual([fn]);

        await complete(provider, {
            tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        });
        expect('tools' in sent[1]!).toBe(false);
    });

    it('asks for stream usage only when the vendor reports it in-band', async () => {
        const stream = { async *[Symbol.asyncIterator]() {} };
        const reporting = makeProvider({}, stream);
        await complete(reporting.provider, { stream: true });
        expect(reporting.sent[0]!.stream_options).toEqual({
            include_usage: true,
        });

        const own = makeProvider({ streamUsage: false }, stream);
        await complete(own.provider, { stream: true });
        expect('stream_options' in own.sent[0]!).toBe(false);
    });

    it('maps the normalized fields only for a vendor that takes them', async () => {
        const args = {
            tools: [{ type: 'function', function: { name: 'f' } }],
            tool_choice: { type: 'any' as const },
            stopSequences: ['END'],
        };
        const none = makeProvider({});
        await complete(none.provider, args);
        expect(none.sent[0]).not.toHaveProperty('tool_choice');
        expect(none.sent[0]).not.toHaveProperty('stop');

        const toolChoiceOnly = makeProvider({
            compatParams: { only: ['tool_choice'] },
        });
        await complete(toolChoiceOnly.provider, args);
        expect(toolChoiceOnly.sent[0]!.tool_choice).toBe('required');
        expect(toolChoiceOnly.sent[0]).not.toHaveProperty('stop');
    });

    it('retries a context-length rejection only when the vendor opts in', async () => {
        const overflow = Object.assign(
            new Error(
                'The maximum context length (1000) is exceeded: input token count (300) plus max_tokens (1000).',
            ),
            { status: 400 },
        );

        const retrying = makeProvider(
            { retryOnContextLength: true },
            overflow,
            completion,
        );
        await complete(retrying.provider, { max_tokens: 1000 });
        expect(retrying.sent).toHaveLength(2);
        expect(retrying.sent[1]!.max_tokens).toBe(700);

        const plain = makeProvider({}, overflow);
        await expect(
            complete(plain.provider, { max_tokens: 1000 }),
        ).rejects.toBe(overflow);
        expect(plain.sent).toHaveLength(1);
    });

    it('meters cached reads once and reports the recorded costs', async () => {
        const { provider, meteringCalls } = makeProvider({
            meteringPrefix: 'acme',
        });
        const result = await complete(provider, {});

        expect(meteringCalls).toEqual([
            [
                { prompt_tokens: 60, completion_tokens: 10, cached_tokens: 40 },
                undefined,
                'acme:acme:Org/Model-X',
                {
                    prompt_tokens: 600,
                    completion_tokens: 200,
                    cached_tokens: 40,
                },
            ],
        ]);
        expect(result.usage).toEqual({
            prompt_tokens: 60,
            completion_tokens: 10,
            cached_tokens: 40,
        });
        expect(result.usageCosts).toEqual({
            prompt_tokens: 600,
            completion_tokens: 200,
            cached_tokens: 40,
        });
    });

    it('lets a vendor adjust the request last', async () => {
        class Vendor extends OpenAICompatProvider {
            protected override vendorParams(params: Record<string, unknown>) {
                return { ...params, model: 'wire-name', extra: true };
            }
        }
        const upstream = fakeUpstream();
        const provider = new Vendor(recordingMetering().metering, {
            client: upstream.client as never,
            defaultModel: 'acme:Org/Model-X',
            models: () => CATALOG,
        });
        await complete(provider, {});
        expect(upstream.sent[0]).toMatchObject({
            model: 'wire-name',
            extra: true,
        });
    });
});
