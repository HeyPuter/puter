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
];

beforeAll(async () => {
    server = await setupTestServer();
    kv.del?.(INFRON_KV_KEY);
    axiosRequestMock.mockResolvedValue({ data: { data: GATEWAY_CATALOG } });

    // Built once, not per-test: `#buildModelMap` mutates the catalogs
    // providers hand back (lowercasing ids, pushing `puterId` onto the
    // shared `aliases` array), and GeminiChatProvider returns its
    // module-level GEMINI_MODELS by reference.
    driver = new ChatCompletionDriver(
        {
            providers: {
                gemini: { apiKey: 'test-key' },
                infron: { apiKey: 'test-key' },
                ollama: { enabled: false },
            },
        } as never,
        server.clients,
        server.stores,
        server.services,
    );
    driver.onServerStart();
    // `onServerStart` doesn't await `#buildModelMap`, and the gateway
    // catalog resolves on a microtask — poll until both providers land.
    for (let i = 0; i < 200; i++) {
        const ids = await driver.list();
        if (ids.some((id) => id.startsWith('infron:'))) break;
        await new Promise((r) => setTimeout(r, 5));
    }
});

afterAll(async () => {
    await server?.shutdown();
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
    return (caught as unknown as { fields: { attempts: { model: string; provider: string }[] } })
        .fields.attempts;
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
        const attempts = await attemptsFor('google/gemini-2.5-flash-image-preview');

        expect(attempts[0]).toMatchObject({ provider: 'infron' });
    });
});
