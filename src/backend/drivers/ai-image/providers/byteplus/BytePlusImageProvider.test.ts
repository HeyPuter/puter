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
 * Offline unit tests for BytePlusImageProvider.
 *
 * Boots a real PuterServer (in-memory sqlite + dynamo + s3 + mock
 * redis) and constructs BytePlusImageProvider directly against the
 * live wired `MeteringService` so the recording side is exercised
 * end-to-end. Ark's image API is OpenAI-compatible so the OpenAI SDK
 * is mocked at the module boundary; that's the real network egress
 * point.
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

import type { MeteringService } from '../../../../services/metering/MeteringService.js';
import { PuterServer } from '../../../../server.js';
import { setupTestServer } from '../../../../testUtil.js';
import { withTestActor } from '../../../integrationTestUtil.js';
import { BYTEPLUS_IMAGE_GENERATION_MODELS } from './models.js';
import { BytePlusImageProvider } from './BytePlusImageProvider.js';

// -- OpenAI SDK mock -------------------------------------------------

const { generateMock, openAICtor } = vi.hoisted(() => ({
    generateMock: vi.fn(),
    openAICtor: vi.fn(),
}));

vi.mock('openai', () => {
    const OpenAICtor = vi.fn().mockImplementation(function (
        this: Record<string, unknown>,
        opts: unknown,
    ) {
        openAICtor(opts);
        this.images = { generate: generateMock };
        // Some sibling providers boot through the same SDK module.
        this.chat = { completions: { create: vi.fn() } };
        this.post = vi.fn();
    });
    return { OpenAI: OpenAICtor, default: { OpenAI: OpenAICtor } };
});

// -- Test harness ----------------------------------------------------

let server: PuterServer;
let hasCreditsSpy: MockInstance<MeteringService['hasEnoughCredits']>;
let batchIncrementUsagesSpy: MockInstance<
    MeteringService['batchIncrementUsages']
>;

beforeAll(async () => {
    server = await setupTestServer();
});

afterAll(async () => {
    await server?.shutdown();
});

const makeProvider = (
    config: { apiKey?: string; apiBaseUrl?: string } = {},
) =>
    new BytePlusImageProvider(
        {
            apiKey: config.apiKey ?? 'test-key',
            ...(config.apiBaseUrl ? { apiBaseUrl: config.apiBaseUrl } : {}),
        },
        server.services.metering,
    );

beforeEach(() => {
    generateMock.mockReset();
    openAICtor.mockReset();
    hasCreditsSpy = vi.spyOn(server.services.metering, 'hasEnoughCredits');
    batchIncrementUsagesSpy = vi.spyOn(
        server.services.metering,
        'batchIncrementUsages',
    );
});

afterEach(() => {
    vi.restoreAllMocks();
});

const sampleResponse = { data: [{ url: 'https://ark.example/img/1' }] };

const findModel = (id: string) =>
    BYTEPLUS_IMAGE_GENERATION_MODELS.find((m) => m.id === id)!;

// -- Construction ----------------------------------------------------

describe('BytePlusImageProvider construction', () => {
    it('defaults the OpenAI SDK to the ap-southeast ModelArk base URL', () => {
        makeProvider();
        expect(openAICtor).toHaveBeenCalledWith({
            apiKey: 'test-key',
            baseURL: 'https://ark.ap-southeast.bytepluses.com/api/v3',
        });
    });

    it('honors a configured apiBaseUrl (region selection)', () => {
        makeProvider({
            apiBaseUrl: 'https://ark.eu-west.bytepluses.com/api/v3',
        });
        expect(openAICtor).toHaveBeenCalledWith({
            apiKey: 'test-key',
            baseURL: 'https://ark.eu-west.bytepluses.com/api/v3',
        });
    });

    it('throws when no apiKey is supplied', () => {
        expect(
            () =>
                new BytePlusImageProvider(
                    { apiKey: '' },
                    server.services.metering,
                ),
        ).toThrow(/API key/i);
    });
});

// -- Model catalog ---------------------------------------------------

describe('BytePlusImageProvider model catalog', () => {
    it('returns seedream-5-0-lite as the default', () => {
        expect(makeProvider().getDefaultModel()).toBe(
            'seedream-5-0-lite-260128',
        );
    });

    it('exposes the static catalog verbatim', () => {
        expect(makeProvider().models()).toBe(
            BYTEPLUS_IMAGE_GENERATION_MODELS,
        );
    });
});

// -- test_mode / validation / credit gate ----------------------------

describe('BytePlusImageProvider.generate gates', () => {
    it('returns the canned sample URL in test_mode without side effects', async () => {
        const result = await withTestActor(() =>
            makeProvider().generate({ prompt: 'x', test_mode: true }),
        );
        expect(result).toBe(
            'https://puter-sample-data.puter.site/image_example.png',
        );
        expect(hasCreditsSpy).not.toHaveBeenCalled();
        expect(generateMock).not.toHaveBeenCalled();
    });

    it('throws 400 on a missing or blank prompt', async () => {
        await expect(
            withTestActor(() =>
                makeProvider().generate({
                    prompt: undefined as unknown as string,
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
        await expect(
            withTestActor(() => makeProvider().generate({ prompt: '  ' })),
        ).rejects.toMatchObject({ statusCode: 400 });
        expect(generateMock).not.toHaveBeenCalled();
    });

    it('throws 402 BEFORE hitting ModelArk when the actor lacks credits', async () => {
        hasCreditsSpy.mockResolvedValueOnce(false);
        await expect(
            withTestActor(() => makeProvider().generate({ prompt: 'hi' })),
        ).rejects.toMatchObject({ statusCode: 402 });
        expect(generateMock).not.toHaveBeenCalled();
        expect(batchIncrementUsagesSpy).not.toHaveBeenCalled();
    });
});

// -- Model resolution ------------------------------------------------

describe('BytePlusImageProvider.generate model resolution', () => {
    it('falls back to the default model for unknown ids', async () => {
        generateMock.mockResolvedValueOnce(sampleResponse);
        await withTestActor(() =>
            makeProvider().generate({ model: 'nope', prompt: 'hi' }),
        );
        expect(generateMock.mock.calls[0]![0].model).toBe(
            'seedream-5-0-lite-260128',
        );
    });

    it('resolves series and byteplus-prefixed aliases to the dated id', async () => {
        generateMock.mockResolvedValueOnce(sampleResponse);
        await withTestActor(() =>
            makeProvider().generate({
                model: 'byteplus/seedream-4-0',
                prompt: 'hi',
            }),
        );
        expect(generateMock.mock.calls[0]![0].model).toBe(
            'seedream-4-0-250828',
        );
    });

    it('resolves the undated seedream-5-0 alias to the lite snapshot', async () => {
        generateMock.mockResolvedValueOnce(sampleResponse);
        await withTestActor(() =>
            makeProvider().generate({ model: 'seedream-5-0', prompt: 'hi' }),
        );
        expect(generateMock.mock.calls[0]![0].model).toBe(
            'seedream-5-0-lite-260128',
        );
    });
});

// -- Request shape ---------------------------------------------------

describe('BytePlusImageProvider.generate request shape', () => {
    it('sends the tier keyword size (Ark default 2K), url format and no watermark', async () => {
        generateMock.mockResolvedValueOnce(sampleResponse);
        await withTestActor(() =>
            makeProvider().generate({ prompt: 'a red dot' }),
        );
        const sent = generateMock.mock.calls[0]![0];
        expect(sent.size).toBe('2K');
        expect(sent.response_format).toBe('url');
        expect(sent.watermark).toBe(false);
        expect(sent.image).toBeUndefined();
    });

    it('maps quality to the tier keyword case-insensitively', async () => {
        generateMock.mockResolvedValueOnce(sampleResponse);
        await withTestActor(() =>
            makeProvider().generate({
                model: 'seedream-4-0',
                prompt: 'hi',
                quality: '1.5K',
            }),
        );
        expect(generateMock.mock.calls[0]![0].size).toBe('1.5K');
    });

    it('resolves an aspect ratio + tier to the documented pixel size', async () => {
        generateMock.mockResolvedValueOnce(sampleResponse);
        await withTestActor(() =>
            makeProvider().generate({
                model: 'seedream-4-0',
                prompt: 'hi',
                quality: '1k',
                ratio: { w: 16, h: 9 },
            }),
        );
        expect(generateMock.mock.calls[0]![0].size).toBe('1424x800');
    });

    // seedream-4-5 and the 5.0 series reject anything under 3,686,400 pixels,
    // which rules out every 1K/1.5K size — both the tier keyword and the
    // aspect-ratio mapping have to land on 2K.
    it('snaps a sub-minimum tier up to the smallest the model accepts', async () => {
        generateMock.mockResolvedValueOnce(sampleResponse);
        await withTestActor(() =>
            makeProvider().generate({
                model: 'seedream-4-5',
                prompt: 'hi',
                quality: '1k',
            }),
        );
        expect(generateMock.mock.calls[0]![0].size).toBe('2K');

        generateMock.mockResolvedValueOnce(sampleResponse);
        await withTestActor(() =>
            makeProvider().generate({
                prompt: 'hi',
                quality: '1.5k',
                ratio: { w: 16, h: 9 },
            }),
        );
        expect(generateMock.mock.calls[1]![0].size).toBe('2816x1584');
    });

    it('passes explicit pixel dimensions straight through', async () => {
        generateMock.mockResolvedValueOnce(sampleResponse);
        await withTestActor(() =>
            makeProvider().generate({
                model: 'seedream-4-0',
                prompt: 'hi',
                ratio: { w: 2048, h: 1024 },
            }),
        );
        expect(generateMock.mock.calls[0]![0].size).toBe('2048x1024');
    });

    it('rejects explicit pixel dimensions below a 2K-only model minimum', async () => {
        // The default model (seedream-5-0-lite) only accepts >= 3,686,400 px,
        // so a size that passes the generic floor still fails pre-flight
        // instead of round-tripping to Ark for a 400.
        await expect(
            withTestActor(() =>
                makeProvider().generate({
                    prompt: 'hi',
                    ratio: { w: 2048, h: 1024 },
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
        expect(generateMock).not.toHaveBeenCalled();
    });

    it('reduces w:h to lowest terms when mapping an aspect ratio', async () => {
        generateMock.mockResolvedValueOnce(sampleResponse);
        await withTestActor(() =>
            makeProvider().generate({
                model: 'seedream-4-0',
                prompt: 'hi',
                quality: '1k',
                ratio: { w: 32, h: 18 },
            }),
        );
        expect(generateMock.mock.calls[0]![0].size).toBe('1424x800');
    });

    it('rejects explicit pixel dimensions outside Ark limits', async () => {
        await expect(
            withTestActor(() =>
                makeProvider().generate({
                    prompt: 'hi',
                    ratio: { w: 6000, h: 6000 },
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
        expect(generateMock).not.toHaveBeenCalled();
    });

    it('sends a URL input image untouched', async () => {
        generateMock.mockResolvedValueOnce(sampleResponse);
        await withTestActor(() =>
            makeProvider().generate({
                model: 'seedream-4-0',
                prompt: 'add a hat',
                input_image: 'https://example.com/cat.png',
            }),
        );
        const sent = generateMock.mock.calls[0]![0];
        expect(sent.model).toBe('seedream-4-0-250828');
        expect(sent.image).toBe('https://example.com/cat.png');
    });
});

// -- Input images ----------------------------------------------------

describe('BytePlusImageProvider.generate input images', () => {
    const PNG = 'data:image/png;base64,iVBORw0KGgo=';

    it('sends a single input image as a string and multiple as an array', async () => {
        generateMock.mockResolvedValue(sampleResponse);

        await withTestActor(() =>
            makeProvider().generate({ prompt: 'hi', input_images: [PNG] }),
        );
        expect(generateMock.mock.calls[0]![0].image).toBe(PNG);

        await withTestActor(() =>
            makeProvider().generate({
                prompt: 'hi',
                input_images: [PNG, PNG],
            }),
        );
        expect(generateMock.mock.calls[1]![0].image).toEqual([PNG, PNG]);
    });

    it('wraps raw base64 into a data URI using the mime hint', async () => {
        generateMock.mockResolvedValueOnce(sampleResponse);
        await withTestActor(() =>
            makeProvider().generate({
                prompt: 'hi',
                input_image: 'AAAA',
                input_image_mime_type: 'image/webp',
            }),
        );
        expect(generateMock.mock.calls[0]![0].image).toBe(
            'data:image/webp;base64,AAAA',
        );
    });

    it('rejects more input images than the model accepts', async () => {
        await expect(
            withTestActor(() =>
                makeProvider().generate({
                    model: 'dola-seedream-5-0-pro',
                    prompt: 'hi',
                    input_images: Array(11).fill(PNG),
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
        expect(generateMock).not.toHaveBeenCalled();
    });
});

// -- Metering --------------------------------------------------------

describe('BytePlusImageProvider.generate metering', () => {
    it('meters flat per-image models at their catalog rate', async () => {
        generateMock.mockResolvedValueOnce(sampleResponse);
        await withTestActor(() =>
            makeProvider().generate({ model: 'seedream-4-0', prompt: 'hi' }),
        );
        const [, entries] = batchIncrementUsagesSpy.mock.calls[0]!;
        expect(entries).toEqual([
            {
                usageType:
                    'byteplus-image-generation:seedream-4-0-250828:per-image',
                usageAmount: 1,
                costOverride:
                    findModel('seedream-4-0-250828').costs['per-image'] *
                    1_000_000,
            },
        ]);
    });

    it('bills the pro model at the high tier for 2K output', async () => {
        generateMock.mockResolvedValueOnce(sampleResponse);
        await withTestActor(() =>
            makeProvider().generate({
                model: 'dola-seedream-5-0-pro',
                prompt: 'hi',
            }),
        );
        const [, entries] = batchIncrementUsagesSpy.mock.calls[0]!;
        const pro = findModel('dola-seedream-5-0-pro-260628');
        expect(entries).toEqual([
            {
                usageType:
                    'byteplus-image-generation:dola-seedream-5-0-pro-260628:output:2k',
                usageAmount: 1,
                costOverride: pro.costs['output:2k'] * 1_000_000,
            },
        ]);
    });

    it('bills the pro model at the low tier for 1k/1.5k output', async () => {
        generateMock.mockResolvedValueOnce(sampleResponse);
        await withTestActor(() =>
            makeProvider().generate({
                model: 'dola-seedream-5-0-pro',
                prompt: 'hi',
                quality: '1.5k',
            }),
        );
        const [, entries] = batchIncrementUsagesSpy.mock.calls[0]!;
        expect(
            (entries as Array<{ usageType: string }>)[0].usageType,
        ).toBe(
            'byteplus-image-generation:dola-seedream-5-0-pro-260628:output:1.5k',
        );
    });

    it('bills pro input images from the second one on (first is free)', async () => {
        generateMock.mockResolvedValueOnce(sampleResponse);
        const PNG = 'data:image/png;base64,iVBORw0KGgo=';
        await withTestActor(() =>
            makeProvider().generate({
                model: 'dola-seedream-5-0-pro',
                prompt: 'hi',
                input_images: [PNG, PNG, PNG],
            }),
        );
        const pro = findModel('dola-seedream-5-0-pro-260628');
        const [, entries] = batchIncrementUsagesSpy.mock.calls[0]!;
        const inputEntry = (
            entries as Array<{
                usageType: string;
                usageAmount: number;
                costOverride: number;
            }>
        ).find((e) => e.usageType.endsWith(':input_image'))!;
        expect(inputEntry.usageAmount).toBe(2);
        expect(inputEntry.costOverride).toBe(
            2 * pro.costs.input_image * 1_000_000,
        );
    });

    it('does not bill input images on flat-rate models', async () => {
        generateMock.mockResolvedValueOnce(sampleResponse);
        const PNG = 'data:image/png;base64,iVBORw0KGgo=';
        await withTestActor(() =>
            makeProvider().generate({
                model: 'seedream-4-5',
                prompt: 'hi',
                input_images: [PNG, PNG, PNG],
            }),
        );
        const [, entries] = batchIncrementUsagesSpy.mock.calls[0]!;
        expect(entries).toHaveLength(1);
    });
});

// -- Response handling -----------------------------------------------

describe('BytePlusImageProvider.generate response handling', () => {
    it('falls back to a data URI when the response carries b64_json', async () => {
        generateMock.mockResolvedValueOnce({
            data: [{ b64_json: 'AAAA', output_format: 'png' }],
        });
        const result = await withTestActor(() =>
            makeProvider().generate({ prompt: 'hi' }),
        );
        expect(result).toBe('data:image/png;base64,AAAA');
    });

    it('surfaces a per-image upstream error as 400 without metering', async () => {
        generateMock.mockResolvedValueOnce({
            data: [{ error: { code: 'x', message: 'moderated' } }],
        });
        await expect(
            withTestActor(() => makeProvider().generate({ prompt: 'hi' })),
        ).rejects.toMatchObject({ statusCode: 400 });
        expect(batchIncrementUsagesSpy).not.toHaveBeenCalled();
    });

    it('throws when the response has no usable image data', async () => {
        generateMock.mockResolvedValueOnce({ data: [{}] });
        await expect(
            withTestActor(() => makeProvider().generate({ prompt: 'hi' })),
        ).rejects.toThrow(/Failed to extract image URL/);
        expect(batchIncrementUsagesSpy).not.toHaveBeenCalled();
    });
});
