/**
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify it under the
 * terms of the GNU Affero General Public License as published by the Free
 * Software Foundation, either version 3 of the License, or (at your option) any
 * later version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
 * FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License for more
 * details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see
 * [https://www.gnu.org/licenses/](https://www.gnu.org/licenses/).
 */

/**
 * Which provider actually serves a model that several providers advertise.
 *
 * Lives apart from ChatCompletionDriver.test.ts because `vi.mock` is
 * file-scoped and hoisted — mocking the OpenAI SDK and axios here would
 * otherwise leak into every test in that file. Both mocks sit at the real
 * network egress points, so the driver's registration, model-map build and
 * resolution all run for real.
 */

import {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
    type MockInstance,
} from 'vitest';

import type { Request } from 'express';
import {
    renderAnthropicError,
    renderOpenAIError,
} from '../../controllers/puterai/wireErrors.js';
import { Context } from '../../core/context.js';
import { HttpError } from '../../core/http/HttpError.js';
import { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';
import { withTestActor } from '../integrationTestUtil.js';
import { ChatCompletionDriver } from './ChatCompletionDriver.js';
import { OPEN_AI_MODELS } from './providers/openai/models.js';
import {
    clearUnhealthyRoutes,
    isRouteUnhealthy,
    markRouteUnhealthy,
} from './utils/providerHealth.js';
import { InfronProvider } from './providers/infron/InfronProvider.js';
import { UpstreamDeadlineError } from '../util/upstreamErrors.js';

// -- OpenAI SDK mock ------------------------------------------------
// Gemini reaches Google through `new openai.OpenAI()` (default export) and
// the gateway through the named one, so both must resolve to the same ctor.

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));

vi.mock('openai', () => {
    const OpenAICtor = vi.fn().mockImplementation(function (
        this: Record<string, unknown>,
    ) {
        this.chat = { completions: { create: createMock } };
    });
    return { OpenAI: OpenAICtor, default: { OpenAI: OpenAICtor } };
});

// -- axios mock (gateway model catalog) -----------------------------

const { axiosRequestMock } = vi.hoisted(() => ({ axiosRequestMock: vi.fn() }));

vi.mock('axios', () => ({
    default: { request: axiosRequestMock },
    request: axiosRequestMock,
}));

// -- Harness --------------------------------------------------------

let server: PuterServer;
let driver: ChatCompletionDriver;

// Google lists gemini-2.5-flash input at $0.30/MTok. The gateway quotes a
// floor price across its upstream routes, so it undercuts — which is exactly
// the condition that used to hand it the traffic.
const GATEWAY_CATALOG = [
    {
        id: 'google/gemini-2.5-flash',
        display_name: 'Google: Gemini 2.5 Flash',
        category_type: 'LLM',
        supported_endpoint_types: ['openai'],
        context_length: 1_048_576,
        max_output_tokens: 65_536,
        min_prompt_price: 0.15,
        min_completion_price: 1.0,
    },
    {
        // Only the gateway carries this one — no first-party counterpart.
        id: 'google/gemini-2.5-flash-image-preview',
        display_name: 'Google: Gemini 2.5 Flash Image Preview',
        category_type: 'LLM',
        supported_endpoint_types: ['openai'],
        context_length: 32_768,
        max_output_tokens: 8_192,
        min_prompt_price: 0.3,
        min_completion_price: 2.5,
    },
    {
        // A gateway id with capitals, which the driver's map lowercases.
        id: 'Qwen/QwQ-Max',
        display_name: 'Qwen: QwQ Max',
        category_type: 'LLM',
        supported_endpoint_types: ['openai'],
        context_length: 131_072,
        max_output_tokens: 8_192,
        min_prompt_price: 1.6,
        min_completion_price: 6.4,
    },
    {
        // A vendor we integrate with directly that isn't Google — the case
        // resold duplicates used to be dropped for.
        id: 'deepseek/deepseek-v4-pro',
        display_name: 'DeepSeek: V4 Pro',
        category_type: 'LLM',
        supported_endpoint_types: ['openai'],
        context_length: 1_000_000,
        max_output_tokens: 65_536,
        min_prompt_price: 0.1,
        min_completion_price: 0.5,
    },
];

// OpenRouter's catalog is shaped differently, and it carries the same model
// under two upstream orgs — four routes total for deepseek-v4-pro once the
// vendor and Infron are counted.
const OPENROUTER_CATALOG = [
    'deepseek/deepseek-v4-pro',
    'deepseek-ai/deepseek-v4-pro',
    'google/gemini-2.5-flash',
    // OpenRouter really does carry Muse Spark under Meta's own id, which is
    // also the alias the Meta provider publishes — the two have to land in
    // one bucket rather than becoming separate models.
    'meta/muse-spark-1.2',
    'openai/o1-pro',
].map((id) => ({
    id,
    name: `${id} (via OpenRouter)`,
    pricing: { prompt: '0.0000001', completion: '0.0000005' },
    context_length: 1_000_000,
    top_provider: { max_completion_tokens: 65_536 },
    created: 1_700_000_000,
}));

const catalogResponse = ({ url }: { url: string }) => ({
    data: {
        data: url.includes('openrouter') ? OPENROUTER_CATALOG : GATEWAY_CATALOG,
    },
});

beforeAll(async () => {
    server = await setupTestServer();
    axiosRequestMock.mockImplementation(catalogResponse);

    // Built once, not per-test: `#buildModelMap` mutates the catalogs
    // providers hand back (lowercasing ids, pushing `puterId` onto the
    // shared `aliases` array), and GeminiChatProvider returns its
    // module-level GEMINI_MODELS by reference.
    driver = new ChatCompletionDriver(
        {
            providers: {
                gemini: { apiKey: 'test-key' },
                deepseek: { apiKey: 'test-key' },
                meta: { apiKey: 'test-key' },
                infron: { apiKey: 'test-key' },
                openrouter: { apiKey: 'test-key' },
                ollama: { enabled: false },
            },
        } as never,
        server.clients,
        server.stores,
        server.services,
    );
    await driver.onServerStart();
});

// Every failure in this file marks the route it hit. Without this the first
// test would decide where the second one starts.
beforeEach(() => clearUnhealthyRoutes());

afterAll(async () => {
    await server?.shutdown();
    clearUnhealthyRoutes();
});

/**
 * Route a request and report who was tried, in order. Forcing the upstream to
 * reject is what makes the whole chain observable: the driver records every
 * attempt on the thrown error, and `attempts[0]` is who it chose first.
 */
const attemptsFor = async (
    model: string,
    thrown: unknown = new Error('upstream down'),
    provider?: string,
) => {
    createMock.mockRejectedValue(thrown);
    let caught: HttpError | undefined;
    try {
        await withTestActor(() =>
            driver.complete({
                model,
                ...(provider ? { provider } : {}),
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );
    } catch (e) {
        caught = e as HttpError;
    }
    expect(caught).toBeInstanceOf(HttpError);
    return (
        caught as unknown as {
            fields: { attempts: { model: string; provider: string }[] };
        }
    ).fields.attempts;
};

// Shaped like the Stainless SDKs' connection error: no status, only the class.
class APIConnectionError extends Error {
    constructor() {
        super('Connection error.');
    }
}

describe('ChatCompletionDriver gemini routing', () => {
    it('serves gemini models from Google, with the gateway only as fallback', async () => {
        const attempts = await attemptsFor('gemini-2.5-flash');

        expect(attempts[0]).toMatchObject({
            provider: 'gemini',
            model: 'gemini-2.5-flash',
        });
        expect(attempts[1]).toMatchObject({
            provider: 'infron',
            model: 'infron:google/gemini-2.5-flash',
        });
    });

    it('routes the prefixed and puterId forms to Google too', async () => {
        for (const alias of [
            'google/gemini-2.5-flash',
            'google:google/gemini-2.5-flash',
        ]) {
            const attempts = await attemptsFor(alias);
            expect(attempts[0].provider).toBe('gemini');
        }
    });

    it('still routes models only the gateway carries to the gateway', async () => {
        const attempts = await attemptsFor(
            'google/gemini-2.5-flash-image-preview',
        );

        expect(attempts[0]).toMatchObject({ provider: 'infron' });
    });
});

describe('ChatCompletionDriver hands providers their own catalog entry', () => {
    it('sends a gateway model under its own casing, not the lowercased map id', async () => {
        createMock.mockResolvedValueOnce({
            choices: [
                {
                    message: { role: 'assistant', content: 'hi' },
                    finish_reason: 'stop',
                },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
        });
        const record = vi.spyOn(
            server.services.metering,
            'utilRecordUsageObject',
        );

        await withTestActor(() =>
            driver.complete({
                model: 'qwen/qwq-max',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        expect(createMock.mock.calls.at(-1)![0].model).toBe('Qwen/QwQ-Max');
        expect(record.mock.calls.at(-1)![2]).toBe('infron:Qwen/QwQ-Max');
        record.mockRestore();
    });

    it('leaves the provider nothing to look up per request', async () => {
        createMock.mockResolvedValueOnce({
            choices: [
                {
                    message: { role: 'assistant', content: 'hi' },
                    finish_reason: 'stop',
                },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
        });
        const catalog = vi.spyOn(InfronProvider.prototype, 'models');

        await withTestActor(() =>
            driver.complete({
                model: 'qwen/qwq-max',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        expect(catalog).not.toHaveBeenCalled();
        catalog.mockRestore();
    });
});

describe('ChatCompletionDriver while a gateway catalog is loading', () => {
    const SLOW_GATEWAY = 'https://slow-gateway.test/v1';

    /** Hold the slow gateway's catalog response until the returned release. */
    const holdCatalog = () => {
        let release!: () => void;
        const held = new Promise((resolve) => {
            release = () => resolve(catalogResponse({ url: SLOW_GATEWAY }));
        });
        axiosRequestMock.mockImplementation((req: { url: string }) =>
            req.url.startsWith(SLOW_GATEWAY) ? held : catalogResponse(req),
        );
        return release;
    };

    afterEach(() => {
        axiosRequestMock.mockImplementation(catalogResponse);
    });

    /** A driver with Infron behind the slow gateway, started as boot would. */
    const startSlowDriver = (providers: Record<string, unknown> = {}) => {
        const slowDriver = new ChatCompletionDriver(
            {
                providers: {
                    ...providers,
                    infron: { apiKey: 'test-key', apiBaseUrl: SLOW_GATEWAY },
                    ollama: { enabled: false },
                },
            } as never,
            server.clients,
            server.stores,
            server.services,
        );
        slowDriver.onServerStart();
        return slowDriver;
    };

    const answerOnce = () =>
        createMock.mockResolvedValueOnce({
            choices: [
                {
                    message: { role: 'assistant', content: 'hi' },
                    finish_reason: 'stop',
                },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
        });

    const ask = (
        slowDriver: ChatCompletionDriver,
        args: { model: string; provider?: string },
    ) =>
        withTestActor(() =>
            slowDriver.complete({
                ...args,
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

    // A request is read off the socket only after catalogs that need no
    // fetch have landed.
    const nextRequestTurn = () =>
        new Promise<void>((resolve) => setImmediate(resolve));

    it('serves a gateway model requested before its catalog arrives', async () => {
        const releaseCatalog = holdCatalog();
        const slowDriver = startSlowDriver();
        answerOnce();

        const reply = ask(slowDriver, { model: 'qwen/qwq-max' });
        releaseCatalog();

        await expect(reply).resolves.toMatchObject({
            message: { content: 'hi' },
        });
        expect(createMock.mock.calls.at(-1)![0].model).toBe('Qwen/QwQ-Max');
        slowDriver.onServerShutdown();
    });

    it('serves a direct model without waiting for a gateway catalog', async () => {
        const releaseCatalog = holdCatalog();
        const slowDriver = startSlowDriver({
            deepseek: { apiKey: 'test-key' },
        });
        try {
            await nextRequestTurn();
            answerOnce();

            await expect(
                ask(slowDriver, { model: 'deepseek-v4-pro' }),
            ).resolves.toMatchObject({ message: { content: 'hi' } });
            expect(createMock.mock.calls.at(-1)![0].model).toBe(
                'deepseek-v4-pro',
            );
        } finally {
            releaseCatalog();
            slowDriver.onServerShutdown();
        }
    });

    it('waits for the gateway a request names, even when a direct route is loaded', async () => {
        const releaseCatalog = holdCatalog();
        const slowDriver = startSlowDriver({
            deepseek: { apiKey: 'test-key' },
        });
        await nextRequestTurn();
        answerOnce();

        const reply = ask(slowDriver, {
            model: 'deepseek-v4-pro',
            provider: 'infron',
        });
        releaseCatalog();

        await expect(reply).resolves.toMatchObject({
            message: { content: 'hi' },
        });
        expect(createMock.mock.calls.at(-1)![0].model).toBe(
            'deepseek/deepseek-v4-pro',
        );
        slowDriver.onServerShutdown();
    });

    it('lets the drivers started after it register without waiting for the catalog', async () => {
        const releaseCatalog = holdCatalog();
        let booted: PuterServer | undefined;
        try {
            booted = await setupTestServer({
                providers: {
                    infron: { apiKey: 'test-key', apiBaseUrl: SLOW_GATEWAY },
                    elevenlabs: { apiKey: 'test-key' },
                },
            } as never);
            expect(await booted.drivers.aiTts.list()).toContain('elevenlabs');
        } finally {
            releaseCatalog();
            await booted?.shutdown();
        }
    });
});

describe('ChatCompletionDriver muse spark routing', () => {
    it('serves Muse Spark from Meta, with OpenRouter only as fallback', async () => {
        const attempts = await attemptsFor('muse-spark-1.2');

        expect(attempts[0]).toMatchObject({
            provider: 'meta',
            model: 'muse-spark-1.2',
        });
        expect(attempts[1]).toMatchObject({
            provider: 'openrouter',
            model: 'openrouter:meta/muse-spark-1.2',
        });
    });

    it('routes the vendor-qualified alias to Meta too', async () => {
        const attempts = await attemptsFor('meta/muse-spark-1.2');
        expect(attempts[0].provider).toBe('meta');
    });
});

describe('ChatCompletionDriver pinned provider routing', () => {
    it('never falls back to another provider when the caller pinned one', async () => {
        for (const provider of ['meta', 'openrouter']) {
            clearUnhealthyRoutes();
            const attempts = await attemptsFor(
                'muse-spark-1.2',
                new Error('upstream down'),
                provider,
            );

            // The pin confines the chain to that provider's routes: every
            // route that could serve the model under a different vendor —
            // and its pricing — is out of bounds.
            expect(attempts.map((a) => a.provider)).toEqual([provider]);
        }
    });

    it('rejects a model the pinned provider does not serve', async () => {
        const callsBefore = createMock.mock.calls.length;

        const err = await withTestActor(() =>
            driver.complete({
                model: 'gemini-2.5-flash',
                provider: 'meta',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        ).catch((e: unknown) => e as HttpError);

        expect(err).toMatchObject({
            statusCode: 400,
            legacyCode: 'bad_request',
            message:
                "Model not available from provider 'meta': gemini-2.5-flash",
        });
        expect(createMock.mock.calls.length).toBe(callsBefore);
    });

    it('rejects a provider that is not configured', async () => {
        const callsBefore = createMock.mock.calls.length;

        const err = await withTestActor(() =>
            driver.complete({
                model: 'muse-spark-1.2',
                provider: 'anthropic',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        ).catch((e: unknown) => e as HttpError);

        expect(err).toMatchObject({
            statusCode: 400,
            legacyCode: 'bad_request',
            message: 'AI provider not available: anthropic',
        });
        expect(createMock.mock.calls.length).toBe(callsBefore);
    });

    it('still walks every provider when none is pinned', async () => {
        const attempts = await attemptsFor('muse-spark-1.2');

        expect(attempts.map((a) => a.provider)).toEqual([
            'meta',
            'openrouter',
        ]);
    });
});

describe('ChatCompletionDriver model-unavailable routes', () => {
    // Shaped like the OpenAI SDK's APIError for an OpenAI-convention body.
    const modelNotFound = () =>
        Object.assign(
            new Error('403 The model is not available to your account.'),
            {
                status: 403,
                error: {
                    code: 'model_not_found',
                    message: 'The model is not available to your account.',
                },
            },
        );
    const statusError = (status: number, message: string) =>
        Object.assign(new Error(message), { status });
    const reply = {
        choices: [
            {
                message: { role: 'assistant', content: 'hi' },
                finish_reason: 'stop',
            },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
    };

    const complete = (model: string, provider?: string) =>
        withTestActor(() =>
            driver.complete({
                model,
                ...(provider ? { provider } : {}),
                messages: [{ role: 'user', content: 'hi' }],
            }),
        ).catch((e: unknown) => e as HttpError);

    const statusesOf = (err: HttpError) =>
        (
            err as unknown as { fields: { attempts: { status?: number }[] } }
        ).fields.attempts.map((a) => a.status);

    it('falls back past a gated route and marks only that route', async () => {
        createMock
            .mockRejectedValueOnce(modelNotFound())
            .mockResolvedValueOnce(reply);

        await expect(complete('deepseek-v4-pro')).resolves.toMatchObject({
            message: { content: 'hi' },
        });
        expect(isRouteUnhealthy('deepseek', 'deepseek-v4-pro')).toBe(true);
        expect(
            isRouteUnhealthy('infron', 'infron:deepseek/deepseek-v4-pro'),
        ).toBe(false);
    });

    it('fails a pinned request instead of falling back to the vendor', async () => {
        createMock.mockRejectedValueOnce(modelNotFound());

        const err = await complete('muse-spark-1.2', 'openrouter');

        // Only the pinned route is tried, and only it is marked: the vendor's
        // healthy route is never a candidate, so the caller's provider pin
        // decides which account the failure bills.
        expect(statusesOf(err)).toEqual([403]);
        expect(
            isRouteUnhealthy('openrouter', 'openrouter:meta/muse-spark-1.2'),
        ).toBe(true);
        expect(isRouteUnhealthy('meta', 'muse-spark-1.2')).toBe(false);
    });

    it('keeps serving a model from its vendor after the gateway route is gated', async () => {
        createMock
            .mockRejectedValueOnce(modelNotFound())
            .mockResolvedValueOnce(reply);

        await complete('muse-spark-1.2', 'openrouter');
        expect(
            isRouteUnhealthy('openrouter', 'openrouter:meta/muse-spark-1.2'),
        ).toBe(true);
        expect(isRouteUnhealthy('meta', 'muse-spark-1.2')).toBe(false);

        await expect(complete('meta/muse-spark-1.2')).resolves.toMatchObject({
            message: { content: 'hi' },
        });
        expect(createMock.mock.calls.at(-1)![0].model).toBe('muse-spark-1.2');
    });

    it('keeps a gated route marked for as long as bad credentials', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        const start = Date.now();
        try {
            createMock
                .mockRejectedValueOnce(modelNotFound())
                .mockResolvedValueOnce(reply);
            await complete('deepseek-v4-pro');

            vi.setSystemTime(start + 61 * 1000);
            expect(isRouteUnhealthy('deepseek', 'deepseek-v4-pro')).toBe(true);
            vi.setSystemTime(start + (10 * 60 + 1) * 1000);
            expect(isRouteUnhealthy('deepseek', 'deepseek-v4-pro')).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });

    it('tells the caller the model is unavailable when every route is gated or missing', async () => {
        createMock
            .mockRejectedValueOnce(modelNotFound())
            .mockRejectedValue(statusError(404, 'model not found'));

        const err = await complete('deepseek-v4-pro');

        expect(err).toMatchObject({
            statusCode: 400,
            legacyCode: 'upstream_bad_request',
            fields: expect.objectContaining({ upstreamStatus: 404 }),
        });
        expect(statusesOf(err)).toEqual([403, 404, 404]);
    });

    it('still pages when a gated route sits beside a bad credential', async () => {
        createMock
            .mockRejectedValueOnce(modelNotFound())
            .mockRejectedValue(statusError(401, 'invalid api key'));

        const err = await complete('deepseek-v4-pro');

        expect(err).toMatchObject({
            statusCode: 500,
            legacyCode: 'upstream_auth_failed',
        });
        expect(statusesOf(err)).toEqual([403, 401, 401]);
    });

    it('classifies a gated route beside an outage as a mixed upstream failure', async () => {
        createMock
            .mockRejectedValueOnce(modelNotFound())
            .mockRejectedValue(statusError(503, 'service unavailable'));

        const err = await complete('deepseek-v4-pro');

        expect(err).toMatchObject({
            statusCode: 400,
            legacyCode: 'upstream_failed',
        });
        expect(statusesOf(err)).toEqual([403, 503, 503]);
    });
});

describe('ChatCompletionDriver OpenRouter account policy block', () => {
    const POLICY_MESSAGE =
        'Policy Violation: this user has been blocked for a previous policy violation. Learn more: https://openrouter.ai/docs/policy (request id: req-secret)';
    // Shaped like the OpenAI SDK's APIError for OpenRouter's error body.
    const policyBlock = () =>
        Object.assign(new Error(`403 ${POLICY_MESSAGE}`), {
            status: 403,
            code: 403,
            error: { code: 403, message: POLICY_MESSAGE },
        });
    const reply = {
        choices: [
            {
                message: { role: 'assistant', content: 'hi' },
                finish_reason: 'stop',
            },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
    };

    const complete = (model: string, provider?: string) =>
        withTestActor(() =>
            driver.complete({
                model,
                ...(provider ? { provider } : {}),
                messages: [{ role: 'user', content: 'hi' }],
            }),
        ).catch((e: unknown) => e as HttpError);

    const attemptsOf = (err: HttpError) =>
        (
            err as unknown as {
                fields: {
                    attempts: {
                        provider: string;
                        status?: number;
                        code?: unknown;
                    }[];
                };
            }
        ).fields.attempts;

    it.each(['openai/o1-pro', 'openrouter:openai/o1-pro', 'o1-pro'])(
        'tells a caller asking for %s that the model is unavailable',
        async (model) => {
            createMock.mockRejectedValueOnce(policyBlock());

            const err = await complete(model);

            expect(err).toMatchObject({
                statusCode: 400,
                legacyCode: 'upstream_bad_request',
                message: 'Model not available: openrouter:openai/o1-pro',
                fields: expect.objectContaining({ upstreamStatus: 404 }),
            });
            expect(JSON.stringify(err.fields)).not.toMatch(
                /policy|http|request id/i,
            );
        },
    );

    it('treats the in-band policy block of a 200 with no choices the same way', async () => {
        createMock.mockResolvedValueOnce({
            error: { code: 403, message: POLICY_MESSAGE },
        });

        const err = await complete('openai/o1-pro');

        expect(err).toMatchObject({
            statusCode: 400,
            legacyCode: 'upstream_bad_request',
            fields: expect.objectContaining({ upstreamStatus: 404 }),
        });
        expect(attemptsOf(err)).toEqual([
            expect.objectContaining({
                provider: 'openrouter',
                status: 403,
                code: 'model_not_found',
            }),
        ]);
    });

    it('keeps a no-choice completion without the policy block a request-level 400', async () => {
        createMock.mockResolvedValueOnce({});

        const err = await complete('openai/o1-pro');

        expect(err).toMatchObject({
            statusCode: 400,
            legacyCode: 'upstream_bad_request',
            message: 'no completion was returned',
        });
        expect(err.fields?.upstreamStatus).toBe(400);
        expect(isRouteUnhealthy('openrouter', 'openrouter:openai/o1-pro')).toBe(
            false,
        );
    });

    it('surfaces the policy block on a gateway-pinned request, under the Anthropic route too', async () => {
        for (const strict of [false, true]) {
            clearUnhealthyRoutes();
            createMock.mockRejectedValueOnce(policyBlock());

            const err = await withTestActor(() => {
                if (strict) Context.set('strictUpstreamErrors', true);
                return driver.complete({
                    model: 'muse-spark-1.2',
                    provider: 'openrouter',
                    messages: [{ role: 'user', content: 'hi' }],
                });
            }).catch((e: unknown) => e as HttpError);

            // The pin confines the request to OpenRouter's own route; the
            // vendor's identical model is never offered up as a fallback.
            expect(attemptsOf(err)).toEqual([
                expect.objectContaining({
                    provider: 'openrouter',
                    status: 403,
                    code: 'model_not_found',
                }),
            ]);
            expect(err).toMatchObject({
                statusCode: 400,
                legacyCode: 'upstream_bad_request',
                message: 'Model not available: openrouter:meta/muse-spark-1.2',
            });
            expect(
                isRouteUnhealthy(
                    'openrouter',
                    'openrouter:meta/muse-spark-1.2',
                ),
            ).toBe(true);
            expect(isRouteUnhealthy('meta', 'muse-spark-1.2')).toBe(false);
        }
    });

    it('renders a gated pinned route as not found on both wire formats', async () => {
        createMock.mockRejectedValueOnce(policyBlock());

        const err = await complete('muse-spark-1.2', 'openrouter');

        expect(attemptsOf(err).map((a) => a.status)).toEqual([403]);
        const anthropic = renderAnthropicError(err, {} as Request);
        const openai = renderOpenAIError(err, {} as Request);
        expect(anthropic.status).toBe(404);
        expect(anthropic.body).toMatchObject({
            error: {
                type: 'not_found_error',
                message: 'Model not available: openrouter:meta/muse-spark-1.2',
            },
        });
        expect(openai.status).toBe(404);
        expect(openai.body).toMatchObject({
            error: {
                type: 'not_found_error',
                message: 'Model not available: openrouter:meta/muse-spark-1.2',
            },
        });
        expect(JSON.stringify([anthropic.body, openai.body])).not.toMatch(
            /policy|http|request id/i,
        );
    });

    it('leaves the same body from another provider an auth failure', async () => {
        createMock.mockRejectedValue(policyBlock());

        const err = await complete('muse-spark-1.2');

        expect(err).toMatchObject({
            statusCode: 500,
            legacyCode: 'upstream_auth_failed',
        });
        expect(attemptsOf(err)).toEqual([
            expect.objectContaining({
                provider: 'meta',
                status: 403,
                code: 403,
            }),
            expect.objectContaining({
                provider: 'openrouter',
                status: 403,
                code: 'model_not_found',
            }),
        ]);
    });

    it.each([
        [
            'a generic 403',
            { status: 403, error: { code: 403, message: 'Forbidden' } },
            500,
            'upstream_auth_failed',
        ],
        [
            'a 401',
            { status: 401, error: { code: 401, message: 'User not found.' } },
            500,
            'upstream_auth_failed',
        ],
        [
            'a 402',
            {
                status: 402,
                error: { code: 402, message: 'Insufficient credits' },
            },
            503,
            'upstream_credits_exhausted',
        ],
        [
            'a 503',
            { status: 503, error: { code: 503, message: POLICY_MESSAGE } },
            400,
            'upstream_provider_unavailable',
        ],
    ])(
        'keeps %s from OpenRouter classified as before',
        async (_label, shape, statusCode, legacyCode) => {
            createMock.mockRejectedValueOnce(
                Object.assign(new Error(shape.error.message), shape),
            );

            const err = await complete('openai/o1-pro');

            expect(err).toMatchObject({ statusCode, legacyCode });
        },
    );
});

describe('ChatCompletionDriver duplicate-model fallback', () => {
    // deepseek-v4-pro is served directly by DeepSeek, by Infron, and twice by
    // OpenRouter (two upstream orgs) — four routes in one bucket.
    const SHARED = 'deepseek-v4-pro';

    it('keeps a reseller duplicate of any vendor, not just Google', async () => {
        const attempts = await attemptsFor(SHARED);

        expect(attempts[0]).toMatchObject({ provider: 'deepseek' });
        expect(attempts.map((a) => a.provider)).toContain('infron');
    });

    it('leaves openrouter below the other resellers in the chain', async () => {
        const attempts = await attemptsFor(SHARED);
        const providers = attempts.map((a) => a.provider);

        expect(providers.indexOf('infron')).toBeLessThan(
            providers.indexOf('openrouter'),
        );
    });

    it('stops after three attempts even with a fourth route available', async () => {
        const attempts = await attemptsFor(SHARED);
        expect(attempts).toHaveLength(3);

        // Proof the cap is what stopped the chain rather than the bucket
        // running dry: take the three just tried out of contention and a
        // fourth route is still there to be served.
        const burned = attempts.map((a) => `${a.provider}:${a.model}`);
        for (const a of attempts) markRouteUnhealthy(a.provider, a.model);

        const next = await attemptsFor(SHARED);
        expect(burned).not.toContain(`${next[0].provider}:${next[0].model}`);
    });

    it('never tries the same provider-and-model pair twice', async () => {
        const attempts = await attemptsFor(SHARED);
        const routes = attempts.map((a) => `${a.provider}:${a.model}`);

        expect(new Set(routes).size).toBe(routes.length);
    });
});

// Each attempt in a fallback chain is a whole completion at that model's
// prices, so each one has to clear the credit gate on its own. The chain used
// to re-check with a nominal 1-microcent amount, which any account with a
// fraction of a credit left passed — three attempts could cost three times
// what the balance allowed.
describe('ChatCompletionDriver credit gate across the fallback chain', () => {
    it('runs the full gate once per attempt, not a nominal re-check', async () => {
        // Observed, not stubbed — the counter that shows each attempt did a
        // real balance read of its own.
        const remaining = vi.spyOn(
            server.services.metering,
            'getUsageHeadroom',
        );

        const attempts = await attemptsFor('deepseek-v4-pro');

        expect(attempts).toHaveLength(3);
        // The balance is read for each attempt because each one's
        // affordability and output cap are decided at that model's prices
        // against what's actually left.
        expect(remaining.mock.calls.length).toBeGreaterThanOrEqual(
            attempts.length,
        );
        remaining.mockRestore();
    });

    it('aborts the chain when the balance runs out mid-fallback', async () => {
        const actor = {
            user: {
                uuid: `routing-gate-${Math.random().toString(36).slice(2)}`,
                username: 'routing-gate-user',
                email: 'routing-gate@test.com',
            },
        } as never;
        const metering = server.services.metering;

        // The first attempt fails upstream, and while it does, a "parallel
        // request" spends the rest of the month's allowance — real usage
        // rows, not a stubbed balance — so the next attempt's gate reads an
        // account with nothing left.
        createMock.mockImplementation(async () => {
            const { remaining } = await metering.getAllowedUsage(actor);
            await metering.incrementUsage(
                actor,
                'test:parallel-spend',
                1,
                remaining,
            );
            throw new Error('upstream down');
        });

        await expect(
            withTestActor(
                () =>
                    driver.complete({
                        model: 'deepseek-v4-pro',
                        messages: [{ role: 'user', content: 'hi' }],
                    }),
                actor,
            ),
        ).rejects.toMatchObject({
            statusCode: 402,
            legacyCode: 'insufficient_funds',
        });
    });
});

describe('ChatCompletionDriver unhealthy-route skipping', () => {
    it('skips a route marked by an earlier failure and serves the next one', async () => {
        markRouteUnhealthy('deepseek', 'deepseek-v4-pro');

        const attempts = await attemptsFor('deepseek-v4-pro');

        expect(attempts[0].provider).toBe('infron');
        expect(attempts.map((a) => a.provider)).not.toContain('deepseek');
    });

    it('marks the routes a failing request burned through', async () => {
        await attemptsFor('deepseek-v4-pro');

        // The marks the first request left behind push the second one past
        // everything that just failed.
        const next = await attemptsFor('deepseek-v4-pro');
        expect(next[0].provider).not.toBe('deepseek');
    });

    it('marks a credit-exhausted 402 route unhealthy for the next caller', async () => {
        const first = await attemptsFor(
            'deepseek-v4-pro',
            Object.assign(
                new Error(
                    'Insufficient credits. Add more using https://openrouter.ai/settings/credits',
                ),
                { status: 402 },
            ),
        );
        const next = await attemptsFor('deepseek-v4-pro');

        expect(next[0]).not.toMatchObject({
            provider: first[0]!.provider,
            model: first[0]!.model,
        });
    });

    it('classifies differing credit-exhaustion statuses as one exhausted chain', async () => {
        createMock
            .mockRejectedValueOnce(
                Object.assign(
                    new Error(
                        'Insufficient credits. Add more using https://openrouter.ai/settings/credits',
                    ),
                    { status: 402 },
                ),
            )
            .mockRejectedValueOnce(
                Object.assign(
                    new Error(
                        'Your current credits have been used up and we are unable to process further requests. Please visit https://openrouter.ai/settings/credits to add credits.',
                    ),
                    { status: 403 },
                ),
            )
            .mockRejectedValueOnce(
                Object.assign(
                    new Error(
                        'Free model requires Team balance greater than $4.999999. (request id: 20260921210512505339070jYB)',
                    ),
                    { status: 429 },
                ),
            );

        const err = await withTestActor(() =>
            driver
                .complete({
                    model: 'deepseek-v4-pro',
                    messages: [{ role: 'user', content: 'hi' }],
                })
                .catch((e: unknown) => e as HttpError),
        );

        expect(err).toMatchObject({
            statusCode: 503,
            legacyCode: 'upstream_credits_exhausted',
        });
        const attempts = (
            err as unknown as {
                fields: { attempts: Array<{ status?: number }> };
            }
        ).fields.attempts;
        expect(attempts.map((attempt) => attempt.status)).toEqual([
            402, 403, 429,
        ]);
    });

    it('still serves a marked route when it is the only one left', async () => {
        // gemini-2.5-flash-image-preview has a single route; marking it must
        // degrade to trying it anyway rather than failing with no attempt.
        markRouteUnhealthy(
            'infron',
            'infron:google/gemini-2.5-flash-image-preview',
        );

        const attempts = await attemptsFor(
            'google/gemini-2.5-flash-image-preview',
        );

        expect(attempts[0]).toMatchObject({ provider: 'infron' });
    });

    it('marks a route only for failures that indict the route, not the request', async () => {
        const complete = () =>
            withTestActor(() =>
                driver.complete({
                    model: 'deepseek-v4-pro',
                    messages: [{ role: 'user', content: 'hi' }],
                }),
            ).catch(() => undefined);

        // A 400 is the upstream judging this prompt; the next caller's may
        // be fine, so the route stays in rotation.
        createMock.mockRejectedValue(
            Object.assign(new Error('invalid request'), { status: 400 }),
        );
        await complete();
        expect(isRouteUnhealthy('deepseek', 'deepseek-v4-pro')).toBe(false);

        // A 503 says the route itself is down and is remembered.
        createMock.mockRejectedValue(
            Object.assign(new Error('service unavailable'), { status: 503 }),
        );
        await complete();
        expect(isRouteUnhealthy('deepseek', 'deepseek-v4-pro')).toBe(true);
    });

    it('returns 504 for a request that outlived its deadline and keeps the route', async () => {
        createMock.mockRejectedValue(
            new UpstreamDeadlineError('Gemini request timed out'),
        );

        const err = await withTestActor(() =>
            driver.complete({
                model: 'deepseek-v4-pro',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        ).catch((e: unknown) => e as HttpError);

        expect(err).toMatchObject({
            statusCode: 504,
            legacyCode: 'upstream_timeout',
        });
        expect(isRouteUnhealthy('deepseek', 'deepseek-v4-pro')).toBe(false);
    });

    describe('how long a failed route stays marked', () => {
        let start: number;
        beforeEach(() => {
            vi.useFakeTimers({ toFake: ['Date'] });
            start = Date.now();
        });
        afterEach(() => vi.useRealTimers());

        const markedAfter = (seconds: number) => {
            vi.setSystemTime(start + seconds * 1000);
            return isRouteUnhealthy('deepseek', 'deepseek-v4-pro');
        };

        it.each([
            [
                'an upstream 5xx',
                Object.assign(new Error('bad gateway'), { status: 502 }),
            ],
            [
                'a rate limit',
                Object.assign(new Error('slow down'), { status: 429 }),
            ],
            ['a dropped connection', new APIConnectionError()],
        ])('a minute after %s', async (_kind, err) => {
            await attemptsFor('deepseek-v4-pro', err);

            expect(markedAfter(59)).toBe(true);
            expect(markedAfter(61)).toBe(false);
        });

        it('ten minutes after bad credentials', async () => {
            await attemptsFor(
                'deepseek-v4-pro',
                Object.assign(new Error('invalid api key'), { status: 401 }),
            );

            expect(markedAfter(61)).toBe(true);
            expect(markedAfter(10 * 60 + 1)).toBe(false);
        });
    });
});

// A transport timeout carries no status, so the classifier used to lump a
// chain of them in with "our bug" and page. It is the provider's pace.
describe('ChatCompletionDriver timeout classification across the chain', () => {
    // Shaped like the Stainless SDKs' timeout: no status, only the class.
    class APIConnectionTimeoutError extends Error {
        constructor() {
            super('Request timed out.');
        }
    }

    const completeShared = () =>
        withTestActor(() =>
            driver.complete({
                model: 'deepseek-v4-pro',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        ).catch((e: unknown) => e as HttpError);

    it('returns 504 upstream_timeout when every route timed out', async () => {
        createMock.mockRejectedValue(new APIConnectionTimeoutError());

        const err = await completeShared();

        expect(err).toMatchObject({
            statusCode: 504,
            legacyCode: 'upstream_timeout',
        });
        const attempts = (
            err as unknown as { fields: { attempts: { timedOut?: boolean }[] } }
        ).fields.attempts;
        expect(attempts.length).toBeGreaterThan(1);
        expect(attempts.every((a) => a.timedOut === true)).toBe(true);
    });

    it('counts a timed-out route as an upstream signal, so a mixed chain is not a 500', async () => {
        createMock
            .mockRejectedValueOnce(new APIConnectionTimeoutError())
            .mockRejectedValue(new Error('upstream down'));

        const err = await completeShared();

        expect(err).toMatchObject({
            statusCode: 400,
            legacyCode: 'upstream_failed',
        });
    });
});

// A dropped connection carries no status either; it is the provider's outage,
// not our bug.
describe('ChatCompletionDriver connection-failure classification across the chain', () => {
    const completeShared = async () => {
        try {
            await withTestActor(() =>
                driver.complete({
                    model: 'deepseek-v4-pro',
                    messages: [{ role: 'user', content: 'hi' }],
                }),
            );
        } catch (e) {
            return e as HttpError;
        }
        return undefined;
    };

    it('returns 400 upstream_provider_unavailable when every route lost its connection', async () => {
        createMock.mockRejectedValue(new APIConnectionError());

        const err = await completeShared();

        expect(err).toMatchObject({
            statusCode: 400,
            legacyCode: 'upstream_provider_unavailable',
        });
    });

    it('counts a dropped connection as an upstream signal, so a mixed chain is not a 500', async () => {
        createMock
            .mockRejectedValueOnce(new APIConnectionError())
            .mockRejectedValue(new Error('upstream down'));

        const err = await completeShared();

        expect(err).toMatchObject({
            statusCode: 400,
            legacyCode: 'upstream_failed',
        });
    });
});

// Azure is served ahead of OpenAI for the models it fronts, at OpenAI's list
// price — the long-context tier included.
describe('ChatCompletionDriver Azure-served OpenAI pricing', () => {
    let azureDriver: ChatCompletionDriver;

    beforeAll(async () => {
        azureDriver = new ChatCompletionDriver(
            {
                providers: {
                    'azure-openai': {
                        apiKey: 'test-key',
                        apiURL: 'https://azure.test/openai/v1',
                    },
                    'openai-completion': { apiKey: 'test-key' },
                    ollama: { enabled: false },
                },
            } as never,
            server.clients,
            server.stores,
            server.services,
        );
        azureDriver.onServerStart();
        for (let i = 0; i < 200; i++) {
            if ((await azureDriver.list()).includes('azure:openai/gpt-5.4')) {
                break;
            }
            await new Promise((r) => setTimeout(r, 5));
        }
    });

    it('bills a gpt-5.4 prompt past the long-context threshold at the raised rates', async () => {
        const recorded: MockInstance = vi.spyOn(
            server.services.metering,
            'utilRecordUsageObject',
        );
        // 300K input tokens (100K of them cached) is past OpenAI's 272K
        // threshold: 2x every input rate and 1.5x output.
        createMock.mockResolvedValueOnce({
            choices: [
                {
                    message: { role: 'assistant', content: 'ok' },
                    finish_reason: 'stop',
                },
            ],
            usage: {
                prompt_tokens: 300_000,
                completion_tokens: 1_000,
                prompt_tokens_details: { cached_tokens: 100_000 },
            },
        });

        const res = (await withTestActor(() =>
            azureDriver.complete({
                model: 'gpt-5.4',
                messages: [{ role: 'user', content: 'summarize this' }],
            }),
        )) as { usage: Record<string, number> };

        const { costs } = OPEN_AI_MODELS.find(
            (m) => m.puterId === 'openai:openai/gpt-5.4',
        )!;
        const expected = {
            prompt_tokens: 200_000 * costs.prompt_tokens * 2,
            completion_tokens: 1_000 * costs.completion_tokens * 1.5,
            cached_tokens: 100_000 * costs.cached_tokens * 2,
        };
        const call = recorded.mock.calls.find(
            ([, , prefix]) => prefix === 'azure-openai:gpt-5.4',
        );
        expect(call?.[3]).toEqual(expected);
        expect(res.usage.usd_cents).toBeCloseTo(
            (expected.prompt_tokens +
                expected.completion_tokens +
                expected.cached_tokens) /
                1_000_000,
        );
        recorded.mockRestore();
    });
});
