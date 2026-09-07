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
 * Driver-level media handling: canonicalising image/video parts once for every
 * provider, refusing them up front for models whose catalog entry says they
 * cannot read them, and resolving `puter_path` parts per attempt for providers
 * without an upload mechanism of their own.
 *
 * Same harness as ChatCompletionDriver.test.ts — a live test server with only
 * `fake-chat` registered — so the catalog is shaped per test by spying on
 * `FakeChatProvider.prototype.models` before the driver builds its model map.
 */

import {
    afterAll,
    afterEach,
    beforeAll,
    describe,
    expect,
    it,
    vi,
} from 'vitest';

import { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';
import { withTestActor } from '../integrationTestUtil.js';
import { ChatCompletionDriver } from './ChatCompletionDriver.js';
import { FakeChatProvider } from './providers/FakeChatProvider.js';
import type { IChatModel, ICompleteArguments } from './types.js';

// The puter_path resolver reads the user's filesystem; stub it and assert on
// when the driver invokes it.
const { processPuterPathUploadsMock } = vi.hoisted(() => ({
    processPuterPathUploadsMock: vi.fn(async (_messages: unknown) => {}),
}));

vi.mock('./providers/openai/fileUpload.js', () => ({
    processPuterPathUploads: processPuterPathUploadsMock,
    MAX_FILE_SIZE: 5 * 1_000_000,
}));

let server: PuterServer;

beforeAll(async () => {
    server = await setupTestServer();
});

afterAll(async () => {
    await server?.shutdown();
});

afterEach(() => {
    vi.restoreAllMocks();
    processPuterPathUploadsMock.mockClear();
    delete (FakeChatProvider.prototype as { resolvesPuterPaths?: boolean })
        .resolvesPuterPaths;
});

const makeDriver = async () => {
    const d = new ChatCompletionDriver(
        { providers: { ollama: { enabled: false } } } as never,
        server.clients,
        server.stores,
        server.services,
    );
    d.onServerStart();
    for (let i = 0; i < 200; i++) {
        const m = await d.models();
        if (m.length > 0) return d;
        await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error('ChatCompletionDriver model map never populated in test');
};

const fakeCatalog = (modalities?: IChatModel['modalities']): IChatModel[] => [
    {
        id: 'fake',
        aliases: [],
        costs_currency: 'usd-cents',
        costs: { 'input-tokens': 0, 'output-tokens': 0 },
        max_tokens: 8192,
        ...(modalities ? { modalities } : {}),
    },
];

const okResult = {
    message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
    usage: {},
    finish_reason: 'stop',
};

const IMAGE_URL = 'https://cdn.test/doge.jpeg';

describe('ChatCompletionDriver media canonicalisation', () => {
    it('hands the provider canonical image parts whatever shape the caller sent', async () => {
        const driver = await makeDriver();
        const completeSpy = vi
            .spyOn(FakeChatProvider.prototype, 'complete')
            .mockResolvedValueOnce(okResult as never);

        await withTestActor(() =>
            driver.complete({
                model: 'fake',
                messages: [
                    {
                        role: 'user',
                        content: [
                            'What do you see?',
                            // puter.js shorthand: no type.
                            { image_url: { url: IMAGE_URL } },
                            // Bare string URL.
                            { image_url: `${IMAGE_URL}?v=2` },
                            // OpenAI Responses shape.
                            {
                                type: 'input_image',
                                image_url: `${IMAGE_URL}?v=3`,
                                detail: 'low',
                            },
                            // Anthropic shape.
                            {
                                type: 'image',
                                source: {
                                    type: 'url',
                                    url: `${IMAGE_URL}?v=4`,
                                },
                            },
                        ],
                    },
                ],
            }),
        );

        const passed = completeSpy.mock.calls[0]![0] as ICompleteArguments;
        expect(passed.messages[0].content).toEqual([
            { type: 'text', text: 'What do you see?' },
            { type: 'image_url', image_url: { url: IMAGE_URL } },
            { type: 'image_url', image_url: { url: `${IMAGE_URL}?v=2` } },
            {
                type: 'image_url',
                image_url: { url: `${IMAGE_URL}?v=3`, detail: 'low' },
            },
            { type: 'image_url', image_url: { url: `${IMAGE_URL}?v=4` } },
        ]);
    });
});

describe('ChatCompletionDriver input modality gate', () => {
    it('returns 400 for an image part when the catalog entry declares text-only input', async () => {
        vi.spyOn(FakeChatProvider.prototype, 'models').mockResolvedValueOnce(
            fakeCatalog({ input: ['text'], output: ['text'] }),
        );
        const driver = await makeDriver();
        const completeSpy = vi.spyOn(FakeChatProvider.prototype, 'complete');

        let caught: unknown;
        try {
            await withTestActor(() =>
                driver.complete({
                    model: 'fake',
                    messages: [
                        {
                            role: 'user',
                            content: [
                                { type: 'text', text: 'describe' },
                                { image_url: { url: IMAGE_URL } },
                            ],
                        },
                    ],
                }),
            );
        } catch (e) {
            caught = e;
        }

        expect(caught).toMatchObject({
            statusCode: 400,
            message: 'Model fake does not support image input',
        });
        // Refused before any provider round trip.
        expect(completeSpy).not.toHaveBeenCalled();
    });

    it('returns 400 for a video part when the entry reads images but not video', async () => {
        vi.spyOn(FakeChatProvider.prototype, 'models').mockResolvedValueOnce(
            fakeCatalog({ input: ['text', 'image'], output: ['text'] }),
        );
        const driver = await makeDriver();

        await expect(
            withTestActor(() =>
                driver.complete({
                    model: 'fake',
                    messages: [
                        {
                            role: 'user',
                            content: [
                                {
                                    video_url: {
                                        url: 'https://cdn.test/a.mp4',
                                    },
                                },
                            ],
                        },
                    ],
                }),
            ),
        ).rejects.toMatchObject({
            statusCode: 400,
            message: 'Model fake does not support video input',
        });
    });

    it('lets images through when the entry declares image input', async () => {
        vi.spyOn(FakeChatProvider.prototype, 'models').mockResolvedValueOnce(
            fakeCatalog({ input: ['text', 'image'], output: ['text'] }),
        );
        const driver = await makeDriver();
        vi.spyOn(FakeChatProvider.prototype, 'complete').mockResolvedValueOnce(
            okResult as never,
        );

        await expect(
            withTestActor(() =>
                driver.complete({
                    model: 'fake',
                    messages: [
                        {
                            role: 'user',
                            content: [{ image_url: { url: IMAGE_URL } }],
                        },
                    ],
                }),
            ),
        ).resolves.toBeDefined();
    });

    it('does not judge entries that declare no modalities (reseller catalogs)', async () => {
        // The stock fake catalog has no `modalities`.
        const driver = await makeDriver();
        vi.spyOn(FakeChatProvider.prototype, 'complete').mockResolvedValueOnce(
            okResult as never,
        );

        await expect(
            withTestActor(() =>
                driver.complete({
                    model: 'fake',
                    messages: [
                        {
                            role: 'user',
                            content: [
                                { image_url: { url: IMAGE_URL } },
                                {
                                    video_url: {
                                        url: 'https://cdn.test/a.mp4',
                                    },
                                },
                            ],
                        },
                    ],
                }),
            ),
        ).resolves.toBeDefined();
    });
});

describe('ChatCompletionDriver puter_path resolution', () => {
    it('resolves puter_path parts before calling a provider without its own upload path', async () => {
        const driver = await makeDriver();
        const completeSpy = vi
            .spyOn(FakeChatProvider.prototype, 'complete')
            .mockResolvedValueOnce(okResult as never);

        await withTestActor(() =>
            driver.complete({
                model: 'fake',
                messages: [
                    {
                        role: 'user',
                        content: [
                            { type: 'text', text: 'describe' },
                            { puter_path: '/someone/Documents/pic.png' },
                        ],
                    },
                ],
            }),
        );

        expect(processPuterPathUploadsMock).toHaveBeenCalledTimes(1);
        // The very array the provider then receives, so a resolved part is
        // what goes upstream.
        const passed = completeSpy.mock.calls[0]![0] as ICompleteArguments;
        expect(processPuterPathUploadsMock.mock.calls[0]![0]).toBe(
            passed.messages,
        );
    });

    it('skips resolution when the provider resolves puter_path itself', async () => {
        (
            FakeChatProvider.prototype as { resolvesPuterPaths?: boolean }
        ).resolvesPuterPaths = true;
        const driver = await makeDriver();
        vi.spyOn(FakeChatProvider.prototype, 'complete').mockResolvedValueOnce(
            okResult as never,
        );

        await withTestActor(() =>
            driver.complete({
                model: 'fake',
                messages: [
                    {
                        role: 'user',
                        content: [{ puter_path: '/someone/Documents/pic.png' }],
                    },
                ],
            }),
        );

        expect(processPuterPathUploadsMock).not.toHaveBeenCalled();
    });

    it('does nothing when no part carries a puter_path', async () => {
        const driver = await makeDriver();
        vi.spyOn(FakeChatProvider.prototype, 'complete').mockResolvedValueOnce(
            okResult as never,
        );

        await withTestActor(() =>
            driver.complete({
                model: 'fake',
                messages: [{ role: 'user', content: 'hi' }],
            }),
        );

        expect(processPuterPathUploadsMock).not.toHaveBeenCalled();
    });
});
