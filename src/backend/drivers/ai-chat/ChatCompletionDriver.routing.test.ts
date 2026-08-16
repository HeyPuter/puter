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
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
    type MockInstance,
} from 'vitest';

import { HttpError } from '../../core/http/HttpError.js';
import { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';
import { kv } from '../../util/kvSingleton.js';
import { withTestActor } from '../integrationTestUtil.js';
import { ChatCompletionDriver } from './ChatCompletionDriver.js';
import {
    clearUnhealthyRoutes,
    markRouteUnhealthy,
} from './utils/providerHealth.js';

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

const INFRON_KV_KEY = 'infronChat:models';
const OPENROUTER_KV_KEY = 'openrouterChat:models';

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
].map((id) => ({
    id,
    name: `${id} (via OpenRouter)`,
    pricing: { prompt: '0.0000001', completion: '0.0000005' },
    context_length: 1_000_000,
    top_provider: { max_completion_tokens: 65_536 },
    created: 1_700_000_000,
}));

beforeAll(async () => {
    server = await setupTestServer();
    kv.del?.(INFRON_KV_KEY);
    kv.del?.(OPENROUTER_KV_KEY);
    axiosRequestMock.mockImplementation(({ url }: { url: string }) => ({
        data: {
            data: url.includes('openrouter')
                ? OPENROUTER_CATALOG
                : GATEWAY_CATALOG,
        },
    }));

    // Built once, not per-test: `#buildModelMap` mutates the catalogs
    // providers hand back (lowercasing ids, pushing `puterId` onto the
    // shared `aliases` array), and GeminiChatProvider returns its
    // module-level GEMINI_MODELS by reference.
    driver = new ChatCompletionDriver(
        {
            providers: {
                gemini: { apiKey: 'test-key' },
                deepseek: { apiKey: 'test-key' },
                infron: { apiKey: 'test-key' },
                openrouter: { apiKey: 'test-key' },
                ollama: { enabled: false },
            },
        } as never,
        server.clients,
        server.stores,
        server.services,
    );
    driver.onServerStart();
    // `onServerStart` doesn't await `#buildModelMap`, and the gateway
    // catalogs resolve on a microtask — poll until both gateways land.
    for (let i = 0; i < 200; i++) {
        const ids = await driver.list();
        if (
            ids.some((id) => id.startsWith('infron:')) &&
            ids.some((id) => id.startsWith('openrouter:'))
        ) {
            break;
        }
        await new Promise((r) => setTimeout(r, 5));
    }
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
const attemptsFor = async (model: string) => {
    createMock.mockRejectedValue(new Error('upstream down'));
    let caught: HttpError | undefined;
    try {
        await withTestActor(() =>
            driver.complete({
                model,
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
            'getRemainingUsage',
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
});
