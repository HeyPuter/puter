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
 * Provider registration, fallback classification, and streaming failure
 * handling for the chat driver.
 *
 * The sibling ChatCompletionDriver.test.ts runs against a driver where
 * `fake-chat` is the only registered provider. Here the driver is booted with
 * every provider credentialed, which is what exercises the registration map,
 * cross-provider fallback, and the error envelope a caller sees when a whole
 * fallback chain is exhausted. No request leaves the process: provider
 * `complete` methods are stubbed at their class boundary.
 */

import { Readable } from 'node:stream';
import {
    afterAll,
    afterEach,
    beforeAll,
    describe,
    expect,
    it,
    vi,
} from 'vitest';

import { HttpError } from '../../core/http/HttpError.js';
import { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';
import { withTestActor } from '../integrationTestUtil.js';
import { ChatCompletionDriver } from './ChatCompletionDriver.js';
import { AzureChatProvider } from './providers/azure/AzureChatProvider.js';
import { FakeChatProvider } from './providers/FakeChatProvider.js';
import { InfronProvider } from './providers/infron/InfronProvider.js';
import { NeuralwattProvider } from './providers/neuralwatt/NeuralwattProvider.js';
import { OpenAiChatProvider } from './providers/openai/OpenAiChatCompletionsProvider.js';
import { OpenRouterProvider } from './providers/openrouter/OpenRouterProvider.js';
import { TogetherAIProvider } from './providers/together/TogetherAIProvider.js';

let server: PuterServer;

/** Every provider credentialed, so the registration map is fully populated. */
const FULL_PROVIDER_CONFIG = {
    providers: {
        claude: { apiKey: 'k' },
        'azure-openai': { apiKey: 'k', apiURL: 'https://azure.test/openai/v1' },
        'openai-completion': { apiKey: 'k' },
        gemini: { apiKey: 'k' },
        groq: { apiKey: 'k' },
        deepseek: { apiKey: 'k' },
        mistral: { apiKey: 'k' },
        xai: { apiKey: 'k' },
        moonshot: { apiKey: 'k' },
        minimax: { apiKey: 'k', apiBaseUrl: 'https://minimax.test' },
        zai: { secret_key: 'k' },
        alibaba: { apiKey: 'k' },
        'together-ai': { apiKey: 'k' },
        openrouter: { apiKey: 'k', apiBaseUrl: 'https://openrouter.test' },
        infron: { apiKey: 'k' },
        byteplus: { apiKey: 'k' },
        neuralwatt: { apiKey: 'k' },
        // Suppress auto-discovery of a developer's local Ollama.
        ollama: { enabled: false },
    },
};

const makeDriver = async (config: Record<string, unknown>) => {
    const d = new ChatCompletionDriver(
        config as never,
        server.clients,
        server.stores,
        server.services,
    );
    d.onServerStart();
    // `onServerStart` kicks off the model map without awaiting it.
    for (let i = 0; i < 200; i++) {
        const models = await d.models();
        if (models.length > 1) return d;
        await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error('model map never populated');
};

let fullDriver: ChatCompletionDriver;
let fakeOnlyDriver: ChatCompletionDriver;

beforeAll(async () => {
    server = await setupTestServer();
    // The three aggregators discover their catalog over HTTP. Stub that one
    // call so registration is exercised without leaving the process; every
    // other provider ships a static catalog.
    const aggregatorCatalog = (id: string) => [
        {
            id,
            name: id,
            aliases: [],
            costs_currency: 'usd-cents',
            costs: { tokens: 1_000_000, input_tokens: 10, output_tokens: 20 },
        },
    ];
    vi.spyOn(TogetherAIProvider.prototype, 'models').mockResolvedValue(
        aggregatorCatalog('together-only-model') as never,
    );
    vi.spyOn(OpenRouterProvider.prototype, 'models').mockResolvedValue(
        aggregatorCatalog('openrouter-only-model') as never,
    );
    vi.spyOn(InfronProvider.prototype, 'models').mockResolvedValue(
        aggregatorCatalog('infron-only-model') as never,
    );
    vi.spyOn(NeuralwattProvider.prototype, 'models').mockResolvedValue(
        aggregatorCatalog('neuralwatt-only-model') as never,
    );
    fullDriver = await makeDriver(FULL_PROVIDER_CONFIG);
    fakeOnlyDriver = await makeDriver({
        providers: { ollama: { enabled: false } },
    });
});

afterAll(async () => {
    await server?.shutdown();
});

afterEach(() => {
    vi.restoreAllMocks();
});

const completeFake = (args: Record<string, unknown>) =>
    withTestActor(() =>
        fakeOnlyDriver.complete({
            model: 'fake',
            messages: [{ role: 'user', content: 'hi' }],
            ...args,
        } as never),
    );

const errorFor = async (
    thrown: unknown,
    args: Record<string, unknown> = {},
): Promise<HttpError> => {
    vi.spyOn(FakeChatProvider.prototype, 'complete').mockRejectedValue(thrown);
    try {
        await completeFake(args);
    } catch (e) {
        return e as HttpError;
    }
    throw new Error('expected the completion to reject');
};

// -- Provider registration -------------------------------------------

describe('ChatCompletionDriver provider registration', () => {
    it('registers a model surface spanning every credentialed provider', async () => {
        const models = await fullDriver.models();
        const providers = new Set(models.map((m) => m.provider));

        for (const expected of [
            'claude',
            'azure-openai',
            'openai-completion',
            'gemini',
            'groq',
            'deepseek',
            'mistral',
            'xai',
            'moonshotai',
            'minimax',
            'zai',
            'alibaba',
            'together-ai',
            'openrouter',
            'infron',
            'byteplus',
            'neuralwatt',
            'fake-chat',
        ]) {
            expect(providers).toContain(expected);
        }
        // Ollama was explicitly disabled.
        expect(providers).not.toContain('ollama');
    });

    it('registers the Responses siblings alongside the Chat Completions providers', async () => {
        const providers = new Set(
            (await fullDriver.models()).map((m) => m.provider),
        );
        // Codex-family models are Responses-only, so they can only appear
        // via the sibling providers wired during registration.
        expect(providers).toContain('azure-openai-responses');
        expect(providers).toContain('openai-responses');
    });

    it('accepts `secret_key` as an alias for `apiKey`', async () => {
        const driver = await makeDriver({
            providers: {
                claude: { secret_key: 'k' },
                ollama: { enabled: false },
            },
        });
        const providers = new Set(
            (await driver.models()).map((m) => m.provider),
        );
        expect(providers).toContain('claude');
    });

    it('registers ollama when the config does not disable it', async () => {
        const driver = await makeDriver({
            providers: {
                claude: { apiKey: 'k' },
                ollama: { apiBaseUrl: 'http://ollama.invalid:11434' },
            },
        });
        // The local server is unreachable in tests, so its catalog is empty —
        // registration still happened, which is what the config gate decides.
        expect((await driver.models()).length).toBeGreaterThan(0);
    });

    it('reports per-model cost lines for every registered provider', () => {
        const rows = fullDriver.getReportedCosts() as Array<{
            usageType: string;
            ucentsPerUnit: number;
            unit: string;
            source: string;
        }>;
        expect(rows.length).toBeGreaterThan(0);
        for (const row of rows) {
            expect(row.unit).toBe('token');
            expect(row.source.startsWith('driver:aiChat/')).toBe(true);
            expect(Number.isFinite(row.ucentsPerUnit)).toBe(true);
            // `tokens` is a scale descriptor, never a billable line.
            expect(row.usageType.endsWith(':tokens')).toBe(false);
        }
        const claudeRows = rows.filter((r) => r.source.endsWith('/claude'));
        expect(claudeRows.length).toBeGreaterThan(0);
    });
});

// -- Failure classification ------------------------------------------

describe('ChatCompletionDriver exhausted-chain classification', () => {
    it('maps an upstream 429 to 429 upstream_rate_limited', async () => {
        const err = await errorFor(
            Object.assign(new Error('slow down'), { status: 429 }),
        );
        expect(err.statusCode).toBe(429);
        expect(err).toMatchObject({ legacyCode: 'upstream_rate_limited' });
        expect(err.message).toBe('AI provider rate limit exceeded');
    });

    it('mutes the alarm when every rate-limited attempt was on a free model', async () => {
        // `fake` is priced at zero throughout: an upstream throttle there is
        // expected and costs nobody anything, so the caller still gets the
        // 429 but nothing is recorded.
        const err = await errorFor(
            Object.assign(new Error('slow down'), { status: 429 }),
        );
        expect(err.noAlarm).toBe(true);
    });

    it('keeps the alarm when a paid model is the one being rate limited', async () => {
        const err = await errorFor(
            Object.assign(new Error('slow down'), { status: 429 }),
            { model: 'costly' },
        );
        expect(err).toMatchObject({ legacyCode: 'upstream_rate_limited' });
        expect(err.noAlarm).toBe(false);
    });

    it('leaves non-rate-limit failures on a free model alarming as usual', async () => {
        const err = await errorFor(
            Object.assign(new Error('invalid api key'), { status: 401 }),
        );
        expect(err.noAlarm).toBeFalsy();
    });

    it('classifies a rate limit reported only in the message text', async () => {
        const err = await errorFor(new Error('Quota exceeded for this key'));
        expect(err.statusCode).toBe(429);
        expect(err).toMatchObject({ legacyCode: 'upstream_rate_limited' });
    });

    it('maps an upstream 401 to a 500 upstream_auth_failed — our misconfiguration, not the callerdispute', async () => {
        const err = await errorFor(
            Object.assign(new Error('invalid api key'), { statusCode: 401 }),
        );
        expect(err.statusCode).toBe(500);
        expect(err).toMatchObject({ legacyCode: 'upstream_auth_failed' });
    });

    it('maps an upstream 5xx to a 400 upstream_provider_unavailable', async () => {
        const err = await errorFor(
            Object.assign(new Error('bad gateway'), { status: 502 }),
        );
        expect(err.statusCode).toBe(400);
        expect(err).toMatchObject({
            legacyCode: 'upstream_provider_unavailable',
        });
    });

    it('sniffs a status out of the message when the provider throws a bare Error', async () => {
        const err = await errorFor(new Error('provider blew up with 503'));
        expect(err).toMatchObject({
            legacyCode: 'upstream_provider_unavailable',
        });
    });

    it('maps an upstream 4xx to a 400 upstream_bad_request carrying the provider message', async () => {
        const err = await errorFor(
            Object.assign(new Error('unsupported parameter: top_k'), {
                status: 422,
            }),
        );
        expect(err.statusCode).toBe(400);
        expect(err).toMatchObject({ legacyCode: 'upstream_bad_request' });
        expect(err.message).toBe('unsupported parameter: top_k');
    });

    it('records the structured provider code in the attempt history', async () => {
        const err = await errorFor({
            status: 400,
            message: 'bad input',
            error: { code: 'invalid_request_error' },
        });
        const attempts = (
            err as unknown as {
                fields: { attempts: Array<Record<string, unknown>> };
            }
        ).fields.attempts;
        expect(attempts).toEqual([
            {
                model: 'fake',
                provider: 'fake-chat',
                status: 400,
                code: 'invalid_request_error',
                error: 'bad input',
            },
        ]);
    });

    it('stringifies a non-Error throwable into the attempt record', async () => {
        const err = await errorFor('a bare string failure');
        const attempts = (
            err as unknown as {
                fields: { attempts: Array<{ error: string }> };
            }
        ).fields.attempts;
        expect(attempts[0]!.error).toBe('a bare string failure');
    });
});

// -- Cross-provider fallback -----------------------------------------

describe('ChatCompletionDriver cross-provider fallback', () => {
    // gpt-4o is served by both the Azure and OpenAI providers, so the
    // fallback loop has somewhere to go.
    const SHARED_MODEL = 'gpt-4o';

    const completeShared = () =>
        withTestActor(() =>
            fullDriver.complete({
                model: SHARED_MODEL,
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

    it('falls through to the second provider and returns its result', async () => {
        vi.spyOn(AzureChatProvider.prototype, 'complete').mockRejectedValue(
            Object.assign(new Error('azure down'), { status: 503 }),
        );
        vi.spyOn(OpenAiChatProvider.prototype, 'complete').mockResolvedValue({
            message: { role: 'assistant', content: 'from the fallback' },
            usage: { prompt_tokens: 1, completion_tokens: 1 },
        } as never);

        const result = (await completeShared()) as {
            message: { content: string };
            via_ai_chat_service: boolean;
        };

        expect(result.message.content).toBe('from the fallback');
        expect(result.via_ai_chat_service).toBe(true);
    });

    it('classifies a chain of only 4xx failures as upstream_bad_request', async () => {
        vi.spyOn(AzureChatProvider.prototype, 'complete').mockRejectedValue(
            Object.assign(new Error('azure rate limited'), { status: 429 }),
        );
        vi.spyOn(OpenAiChatProvider.prototype, 'complete').mockRejectedValue(
            Object.assign(new Error('openai rejected the request'), {
                status: 422,
            }),
        );

        const err = (await completeShared().catch((e) => e)) as HttpError;
        expect(err.statusCode).toBe(400);
        expect(err).toMatchObject({ legacyCode: 'upstream_bad_request' });
    });

    it('reports every attempt when the whole chain fails, and classifies a mixed chain as upstream_failed', async () => {
        vi.spyOn(AzureChatProvider.prototype, 'complete').mockRejectedValue(
            Object.assign(new Error('azure is unreachable'), { status: 503 }),
        );
        vi.spyOn(OpenAiChatProvider.prototype, 'complete').mockRejectedValue(
            new Error('something we cannot classify'),
        );

        const err = (await completeShared().catch((e) => e)) as HttpError;

        expect(err).toBeInstanceOf(HttpError);
        expect(err.statusCode).toBe(400);
        expect(err).toMatchObject({ legacyCode: 'upstream_failed' });
        const attempts = (
            err as unknown as {
                fields: {
                    attempts: Array<{ provider: string; status: number }>;
                };
            }
        ).fields.attempts;
        expect(attempts.length).toBeGreaterThanOrEqual(2);
        expect(attempts.map((a) => a.provider)).toEqual(
            expect.arrayContaining(['azure-openai', 'openai-completion']),
        );
    });

    it('aborts the chain with 402 when credits run out mid-fallback', async () => {
        vi.spyOn(AzureChatProvider.prototype, 'complete').mockRejectedValue(
            Object.assign(new Error('azure down'), { status: 503 }),
        );
        const openai = vi.spyOn(OpenAiChatProvider.prototype, 'complete');
        vi.spyOn(server.services.metering, 'getRemainingUsage')
            .mockResolvedValueOnce(1_000_000) // pre-flight
            .mockResolvedValue(0); // drained by a parallel request

        await expect(completeShared()).rejects.toMatchObject({
            statusCode: 402,
            legacyCode: 'insufficient_funds',
        });
        // The wallet check runs *before* the second upstream hit.
        expect(openai).not.toHaveBeenCalled();
    });
});

// -- Streaming failure handling --------------------------------------

describe('ChatCompletionDriver streaming failure handling', () => {
    const collect = async (stream: Readable): Promise<unknown[]> => {
        const chunks: Buffer[] = [];
        for await (const chunk of stream as AsyncIterable<Buffer>) {
            chunks.push(chunk);
        }
        return Buffer.concat(chunks)
            .toString('utf8')
            .split('\n')
            .filter(Boolean)
            .map((line) => JSON.parse(line));
    };

    it('writes an error frame and closes the stream when the provider populator throws', async () => {
        const cleanup = vi.fn();
        vi.spyOn(FakeChatProvider.prototype, 'complete').mockResolvedValue({
            stream: true,
            init_chat_stream: async () => {
                throw new Error('populator exploded');
            },
            finally_fn: cleanup,
        } as never);

        const result = (await completeFake({ stream: true })) as unknown as {
            dataType: string;
            chunked: boolean;
            stream: Readable;
        };
        expect(result.dataType).toBe('stream');
        expect(result.chunked).toBe(true);

        const events = await collect(result.stream);
        expect(events).toEqual([
            { type: 'error', message: 'populator exploded' },
        ]);
        // The provider's cleanup hook still runs on the failure path.
        expect(cleanup).toHaveBeenCalledTimes(1);
    });

    it('runs the provider cleanup hook after a successful stream', async () => {
        const cleanup = vi.fn();
        vi.spyOn(FakeChatProvider.prototype, 'complete').mockResolvedValue({
            stream: true,
            init_chat_stream: async ({
                chatStream,
            }: {
                chatStream: {
                    write: (v: string) => void;
                    end: (usage?: Record<string, number>) => void;
                };
            }) => {
                chatStream.write(
                    `${JSON.stringify({ type: 'text', text: 'hello' })}\n`,
                );
                chatStream.end({ input_tokens: 1, output_tokens: 1 });
            },
            finally_fn: cleanup,
        } as never);

        const result = (await completeFake({ stream: true })) as unknown as {
            stream: Readable;
        };
        const events = await collect(result.stream);

        expect(events).toContainEqual({ type: 'text', text: 'hello' });
        expect(cleanup).toHaveBeenCalledTimes(1);
    });
});
