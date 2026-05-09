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
 * Offline unit tests for OCRDriver.
 *
 * The AWS Textract SDK and Mistral SDK are mocked so the driver never
 * reaches the network; `loadFileInput` is mocked at the boundary so we
 * don't need real fs/store wiring. Tests cover:
 *   • image / pdf input handling (both AWS Textract and Mistral)
 *   • response shape normalisation
 *   • metering (usage type, page counts, ucents from costs.ts)
 *   • argument validation (provider selection, auth, missing source)
 *   • getReportedCosts mirrors the costs.ts table
 *
 * The driver is instantiated directly with stub config / clients /
 * stores / services rather than booting a full PuterServer, so these
 * tests stay isolated and fast. End-to-end coverage that hits real S3
 * buckets and an actual Textract/Mistral endpoint belongs in a
 * separate *.integration.test.ts file.
 */

import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
    type MockInstance,
} from 'vitest';

import { runWithContext } from '../../core/context.js';
import type { Actor } from '../../core/actor.js';
import { OCRDriver } from './OCRDriver.js';
import { OCR_COSTS } from './costs.js';

// ── Module-level mocks (hoisted) ────────────────────────────────────

const { textractSendMock, textractCtor } = vi.hoisted(() => ({
    textractSendMock: vi.fn(),
    textractCtor: vi.fn(),
}));

vi.mock('@aws-sdk/client-textract', async () => {
    const actual =
        await vi.importActual<typeof import('@aws-sdk/client-textract')>(
            '@aws-sdk/client-textract',
        );
    return {
        ...actual,
        TextractClient: vi.fn().mockImplementation(function (
            this: Record<string, unknown>,
            opts: unknown,
        ) {
            textractCtor(opts);
            this.send = textractSendMock;
        }),
    };
});

const { mistralOcrProcessMock, mistralCtor } = vi.hoisted(() => ({
    mistralOcrProcessMock: vi.fn(),
    mistralCtor: vi.fn(),
}));

vi.mock('@mistralai/mistralai', () => ({
    Mistral: vi.fn().mockImplementation(function (
        this: Record<string, unknown>,
        opts: unknown,
    ) {
        mistralCtor(opts);
        this.ocr = { process: mistralOcrProcessMock };
    }),
}));

const { loadFileInputMock } = vi.hoisted(() => ({
    loadFileInputMock: vi.fn(),
}));

vi.mock('../util/fileInput.js', async () => {
    const actual = await vi.importActual<typeof import('../util/fileInput.js')>(
        '../util/fileInput.js',
    );
    return {
        ...actual,
        loadFileInput: loadFileInputMock,
    };
});

// ── Test helpers ────────────────────────────────────────────────────

interface MeteringStub {
    hasEnoughCredits: MockInstance<
        (actor: Actor, cost: number) => Promise<boolean>
    >;
    incrementUsage: MockInstance<
        (
            actor: Actor,
            usageType: string,
            count: number,
            cost: number,
        ) => unknown
    >;
}

const makeDriver = (params: {
    awsConfigured?: boolean;
    mistralConfigured?: boolean;
    awsRegion?: string;
} = {}) => {
    const metering: MeteringStub = {
        hasEnoughCredits: vi.fn(async () => true),
        incrementUsage: vi.fn(),
    };
    const config = {
        providers: {
            ...(params.awsConfigured !== false
                ? {
                      'aws-textract': {
                          aws: {
                              access_key: 'AKIA-TEST',
                              secret_key: 'secret',
                              region: params.awsRegion ?? 'us-west-2',
                          },
                      },
                  }
                : {}),
            ...(params.mistralConfigured
                ? {
                      'mistral-ocr': { apiKey: 'mistral-key' },
                  }
                : {}),
        },
    };

    const services = {
        metering,
        fs: {} as never,
    };
    const stores = {
        fsEntry: {} as never,
        s3Object: {} as never,
    };
    const clients = {} as never;

    const driver = new OCRDriver(
        config as never,
        clients,
        stores as never,
        services as never,
    );
    driver.onServerStart();
    return { driver, metering };
};

const makeActor = (): Actor => ({
    user: { id: 7, uuid: 'u-7', username: 'alice' },
});

const withActor = <T>(actor: Actor, fn: () => T | Promise<T>): Promise<T> =>
    Promise.resolve(runWithContext({ actor }, fn));

beforeEach(() => {
    textractSendMock.mockReset();
    textractCtor.mockReset();
    mistralOcrProcessMock.mockReset();
    mistralCtor.mockReset();
    loadFileInputMock.mockReset();
});

afterEach(() => {
    vi.restoreAllMocks();
});

// ── getReportedCosts ────────────────────────────────────────────────

describe('OCRDriver.getReportedCosts', () => {
    it('mirrors every entry in costs.ts as a per-page line item', () => {
        const { driver } = makeDriver();
        const reported = driver.getReportedCosts();

        // Every key in OCR_COSTS appears once and only once with the
        // correct ucents/page rate, unit=page, and namespaced source.
        expect(reported).toHaveLength(Object.keys(OCR_COSTS).length);
        for (const [usageType, ucentsPerUnit] of Object.entries(OCR_COSTS)) {
            expect(reported).toContainEqual({
                usageType,
                ucentsPerUnit,
                unit: 'page',
                source: 'driver:aiOcr',
            });
        }
    });
});

// ── Argument validation ─────────────────────────────────────────────

describe('OCRDriver.recognize argument validation', () => {
    it('returns the canned sample when test_mode is set, bypassing all I/O', async () => {
        const { driver, metering } = makeDriver();
        const result = await driver.recognize({ test_mode: true });
        // Canned shape from sampleResponse() — no fs, network, or
        // metering should be touched.
        expect((result as { blocks: unknown[] }).blocks?.[0]).toMatchObject({
            type: 'text/puter:sample-output',
            confidence: 1,
        });
        expect(loadFileInputMock).not.toHaveBeenCalled();
        expect(metering.incrementUsage).not.toHaveBeenCalled();
    });

    it('throws 401 when no actor is on the request context', async () => {
        const { driver } = makeDriver();
        // No actor wrapper → Context.get('actor') is undefined → 401.
        await expect(
            driver.recognize({ source: { path: '/x' } }),
        ).rejects.toMatchObject({ statusCode: 401 });
    });

    it('throws 400 when neither source nor file is provided', async () => {
        const { driver } = makeDriver();
        await expect(
            withActor(makeActor(), () => driver.recognize({})),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('throws 400 when an unknown provider is requested', async () => {
        const { driver } = makeDriver();
        loadFileInputMock.mockResolvedValueOnce({
            buffer: Buffer.from('x'),
            filename: 'x.png',
            mimeType: 'image/png',
            fsEntry: null,
        });
        await expect(
            withActor(makeActor(), () =>
                driver.recognize({
                    source: { path: '/x' },
                    provider: 'totally-not-real',
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('throws 500 if AWS is not configured but aws-textract is requested', async () => {
        const { driver } = makeDriver({ awsConfigured: false });
        loadFileInputMock.mockResolvedValueOnce({
            buffer: Buffer.from('x'),
            filename: 'x.png',
            mimeType: 'image/png',
            fsEntry: null,
        });
        await expect(
            withActor(makeActor(), () =>
                driver.recognize({
                    source: { path: '/x' },
                    provider: 'aws-textract',
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 500 });
    });

    it('throws 500 if mistral is requested but not configured', async () => {
        // AWS configured, Mistral not.
        const { driver } = makeDriver({ mistralConfigured: false });
        loadFileInputMock.mockResolvedValueOnce({
            buffer: Buffer.from('x'),
            filename: 'x.png',
            mimeType: 'image/png',
            fsEntry: null,
        });
        await expect(
            withActor(makeActor(), () =>
                driver.recognize({
                    source: { path: '/x' },
                    provider: 'mistral',
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 500 });
    });
});

// ── AWS Textract ────────────────────────────────────────────────────

describe('OCRDriver.recognize (aws-textract)', () => {
    const sampleTextractResponse = {
        Blocks: [
            { BlockType: 'PAGE' },
            { BlockType: 'PAGE' }, // 2 pages
            { BlockType: 'WORD', Text: 'should-be-skipped' },
            { BlockType: 'TABLE' }, // skipped
            { BlockType: 'LINE', Text: 'hello world', Confidence: 99.5 },
            { BlockType: 'LINE', Text: 'second line', Confidence: 80 },
            { BlockType: 'LAYOUT_TITLE', Text: 'Title!', Confidence: 85 },
        ],
    };

    it('throws 402 when the actor does not have enough credits', async () => {
        const { driver, metering } = makeDriver();
        metering.hasEnoughCredits.mockResolvedValueOnce(false);
        loadFileInputMock.mockResolvedValueOnce({
            buffer: Buffer.from('img'),
            filename: 'doc.png',
            mimeType: 'image/png',
            fsEntry: null,
        });

        await expect(
            withActor(makeActor(), () =>
                driver.recognize({
                    source: { path: '/doc.png' },
                    provider: 'aws-textract',
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 402 });

        // No textract call should have been made when credits are short.
        expect(textractSendMock).not.toHaveBeenCalled();
    });

    it('sends raw bytes when the file is not FS-backed and returns normalised blocks', async () => {
        const { driver } = makeDriver();
        loadFileInputMock.mockResolvedValueOnce({
            buffer: Buffer.from('imgdata'),
            filename: 'doc.png',
            mimeType: 'image/png',
            fsEntry: null,
        });
        textractSendMock.mockResolvedValueOnce(sampleTextractResponse);

        const result = (await withActor(makeActor(), () =>
            driver.recognize({
                source: { path: '/doc.png' },
                provider: 'aws-textract',
            }),
        )) as { blocks: Array<{ type: string; text: string; confidence: number }> };

        // The driver issued AnalyzeDocumentCommand{ Bytes: <buffer> }.
        const sentCmd = textractSendMock.mock.calls[0]![0];
        expect(sentCmd.input.Document.Bytes).toEqual(Buffer.from('imgdata'));
        expect(sentCmd.input.FeatureTypes).toEqual(['LAYOUT']);

        // PAGE/WORD/TABLE/etc. are skipped; LINE and LAYOUT_TITLE pass
        // through with `text/textract:<BlockType>` namespacing.
        expect(result.blocks).toEqual([
            {
                type: 'text/textract:LINE',
                text: 'hello world',
                confidence: 99.5,
            },
            {
                type: 'text/textract:LINE',
                text: 'second line',
                confidence: 80,
            },
            {
                type: 'text/textract:LAYOUT_TITLE',
                text: 'Title!',
                confidence: 85,
            },
        ]);
    });

    it('routes through the bucket region and uses S3Object source for FS-backed files', async () => {
        const { driver } = makeDriver({ awsRegion: 'us-west-2' });
        loadFileInputMock.mockResolvedValueOnce({
            buffer: Buffer.from('img'),
            filename: 'doc.png',
            mimeType: 'image/png',
            fsEntry: {
                uuid: 'uuid-abc',
                path: '/doc.png',
                bucket: 'my-bucket',
                bucketRegion: 'eu-central-1',
                size: null,
                sqlId: null,
            },
        });
        textractSendMock.mockResolvedValueOnce(sampleTextractResponse);

        await withActor(makeActor(), () =>
            driver.recognize({
                source: { path: '/doc.png' },
                provider: 'aws-textract',
            }),
        );

        const sentCmd = textractSendMock.mock.calls[0]![0];
        // S3 direct source — preferred when fsEntry has a bucket.
        expect(sentCmd.input.Document.S3Object).toEqual({
            Bucket: 'my-bucket',
            Name: 'uuid-abc',
        });
        // Region-specific client is constructed for the bucket's region.
        expect(textractCtor).toHaveBeenCalledWith(
            expect.objectContaining({ region: 'eu-central-1' }),
        );
    });

    it('meters one usage line per detected page at the per-page rate from costs.ts', async () => {
        const { driver, metering } = makeDriver();
        loadFileInputMock.mockResolvedValueOnce({
            buffer: Buffer.from('img'),
            filename: 'doc.png',
            mimeType: 'image/png',
            fsEntry: null,
        });
        textractSendMock.mockResolvedValueOnce(sampleTextractResponse);

        const actor = makeActor();
        await withActor(actor, () =>
            driver.recognize({
                source: { path: '/doc.png' },
                provider: 'aws-textract',
            }),
        );

        const usageType = 'aws-textract:detect-document-text:page';
        const perPage = OCR_COSTS[usageType];
        // sampleTextractResponse has 2 PAGE blocks → bill 2 pages at
        // `OCR_COSTS['aws-textract:detect-document-text:page']` ucents each.
        expect(metering.incrementUsage).toHaveBeenCalledTimes(1);
        expect(metering.incrementUsage).toHaveBeenCalledWith(
            actor,
            usageType,
            2,
            perPage * 2,
        );
    });

    it('treats a response with no PAGE blocks as a single page', async () => {
        const { driver, metering } = makeDriver();
        loadFileInputMock.mockResolvedValueOnce({
            buffer: Buffer.from('img'),
            filename: 'doc.png',
            mimeType: 'image/png',
            fsEntry: null,
        });
        textractSendMock.mockResolvedValueOnce({
            Blocks: [
                {
                    BlockType: 'LINE',
                    Text: 'just one line',
                    Confidence: 90,
                },
            ],
        });

        await withActor(makeActor(), () =>
            driver.recognize({
                source: { path: '/img' },
                provider: 'aws-textract',
            }),
        );

        const usageType = 'aws-textract:detect-document-text:page';
        // pages = pageCount || 1 → bill 1 page when no PAGE block was returned.
        expect(metering.incrementUsage).toHaveBeenCalledWith(
            makeActor(),
            usageType,
            1,
            OCR_COSTS[usageType],
        );
    });
});

// ── Mistral OCR ─────────────────────────────────────────────────────

describe('OCRDriver.recognize (mistral)', () => {
    it('packages an image as an image_url chunk with a base64 data URL', async () => {
        const { driver } = makeDriver({ mistralConfigured: true });
        loadFileInputMock.mockResolvedValueOnce({
            buffer: Buffer.from('imgdata'),
            filename: 'doc.png',
            mimeType: 'image/png',
            fsEntry: null,
        });
        mistralOcrProcessMock.mockResolvedValueOnce({
            model: 'mistral-ocr-latest',
            pages: [],
            usageInfo: { pagesProcessed: 1 },
        });

        await withActor(makeActor(), () =>
            driver.recognize({
                source: { path: '/doc.png' },
                provider: 'mistral',
            }),
        );

        const payload = mistralOcrProcessMock.mock.calls[0]![0];
        expect(payload.model).toBe('mistral-ocr-latest');
        // Mistral's SDK uses camelCase imageUrl on this chunk shape.
        expect(payload.document).toEqual({
            type: 'image_url',
            imageUrl: {
                url: `data:image/png;base64,${Buffer.from('imgdata').toString('base64')}`,
            },
        });
    });

    it('packages a PDF as a document_url chunk preserving the original filename', async () => {
        const { driver } = makeDriver({ mistralConfigured: true });
        loadFileInputMock.mockResolvedValueOnce({
            buffer: Buffer.from('%PDF-data'),
            filename: 'spec.pdf',
            mimeType: 'application/pdf',
            fsEntry: null,
        });
        mistralOcrProcessMock.mockResolvedValueOnce({
            pages: [],
            usageInfo: { pagesProcessed: 1 },
        });

        await withActor(makeActor(), () =>
            driver.recognize({
                source: { path: '/spec.pdf' },
                provider: 'mistral',
            }),
        );

        const payload = mistralOcrProcessMock.mock.calls[0]![0];
        // PDFs get the document_url chunk with documentName = filename.
        expect(payload.document.type).toBe('document_url');
        expect(payload.document.documentName).toBe('spec.pdf');
        expect(payload.document.documentUrl).toMatch(
            /^data:application\/pdf;base64,/,
        );
    });

    it('forwards page filters and annotation options to Mistral when supplied', async () => {
        const { driver } = makeDriver({ mistralConfigured: true });
        loadFileInputMock.mockResolvedValueOnce({
            buffer: Buffer.from('x'),
            filename: 'x.pdf',
            mimeType: 'application/pdf',
            fsEntry: null,
        });
        mistralOcrProcessMock.mockResolvedValueOnce({
            pages: [],
            usageInfo: { pagesProcessed: 1 },
        });

        await withActor(makeActor(), () =>
            driver.recognize({
                source: { path: '/x.pdf' },
                provider: 'mistral',
                pages: [0, 2],
                includeImageBase64: true,
                imageLimit: 10,
                imageMinSize: 64,
                bboxAnnotationFormat: { schema: 'bbox' },
                documentAnnotationFormat: { schema: 'doc' },
            }),
        );

        const payload = mistralOcrProcessMock.mock.calls[0]![0];
        expect(payload.pages).toEqual([0, 2]);
        expect(payload.includeImageBase64).toBe(true);
        expect(payload.imageLimit).toBe(10);
        expect(payload.imageMinSize).toBe(64);
        expect(payload.bboxAnnotationFormat).toEqual({ schema: 'bbox' });
        expect(payload.documentAnnotationFormat).toEqual({ schema: 'doc' });
    });

    it('normalises the response: each markdown line becomes a LINE block on its source page', async () => {
        const { driver } = makeDriver({ mistralConfigured: true });
        loadFileInputMock.mockResolvedValueOnce({
            buffer: Buffer.from('x'),
            filename: 'x.pdf',
            mimeType: 'application/pdf',
            fsEntry: null,
        });
        mistralOcrProcessMock.mockResolvedValueOnce({
            model: 'mistral-ocr-latest',
            pages: [
                {
                    index: 0,
                    markdown: '# Title\nLine 1\n\n  Line 2  ',
                },
                { index: 1, markdown: 'page two only line' },
            ],
            usageInfo: { pagesProcessed: 2 },
        });

        const result = (await withActor(makeActor(), () =>
            driver.recognize({
                source: { path: '/x.pdf' },
                provider: 'mistral',
            }),
        )) as {
            blocks: Array<{ type: string; text: string; page?: number }>;
            text: string;
            model: string;
            usage_info: unknown;
        };

        expect(result.model).toBe('mistral-ocr-latest');
        // Blank lines get filtered, surrounding whitespace trimmed,
        // each non-empty line becomes its own LINE block on the
        // markdown's source page index.
        expect(result.blocks).toEqual([
            { type: 'text/mistral:LINE', text: '# Title', page: 0 },
            { type: 'text/mistral:LINE', text: 'Line 1', page: 0 },
            { type: 'text/mistral:LINE', text: 'Line 2', page: 0 },
            {
                type: 'text/mistral:LINE',
                text: 'page two only line',
                page: 1,
            },
        ]);
        // Joined plain text mirrors the LINE blocks.
        expect(result.text).toBe(
            '# Title\nLine 1\nLine 2\npage two only line',
        );
        // usage_info is renamed snake_case for our public response shape.
        expect(result.usage_info).toEqual({ pagesProcessed: 2 });
    });

    it('meters per-page Mistral OCR usage from costs.ts', async () => {
        const { driver, metering } = makeDriver({ mistralConfigured: true });
        loadFileInputMock.mockResolvedValueOnce({
            buffer: Buffer.from('x'),
            filename: 'x.pdf',
            mimeType: 'application/pdf',
            fsEntry: null,
        });
        mistralOcrProcessMock.mockResolvedValueOnce({
            pages: [{ index: 0, markdown: 'a' }, { index: 1, markdown: 'b' }],
            usageInfo: { pagesProcessed: 2 },
        });

        const actor = makeActor();
        await withActor(actor, () =>
            driver.recognize({
                source: { path: '/x.pdf' },
                provider: 'mistral',
            }),
        );

        // Bills exactly one increment, at the page rate from costs.ts × pages.
        expect(metering.incrementUsage).toHaveBeenCalledTimes(1);
        expect(metering.incrementUsage).toHaveBeenCalledWith(
            actor,
            'mistral-ocr:ocr:page',
            2,
            OCR_COSTS['mistral-ocr:ocr:page'] * 2,
        );
    });

    it('also meters annotations when bboxAnnotationFormat or documentAnnotationFormat is requested', async () => {
        const { driver, metering } = makeDriver({ mistralConfigured: true });
        loadFileInputMock.mockResolvedValueOnce({
            buffer: Buffer.from('x'),
            filename: 'x.pdf',
            mimeType: 'application/pdf',
            fsEntry: null,
        });
        mistralOcrProcessMock.mockResolvedValueOnce({
            pages: [{ index: 0, markdown: 'a' }],
            usageInfo: { pagesProcessed: 1 },
        });

        const actor = makeActor();
        await withActor(actor, () =>
            driver.recognize({
                source: { path: '/x.pdf' },
                provider: 'mistral',
                bboxAnnotationFormat: { schema: 'bbox' },
            }),
        );

        // 1 OCR-page increment + 1 annotations-page increment.
        expect(metering.incrementUsage).toHaveBeenCalledTimes(2);
        expect(metering.incrementUsage).toHaveBeenCalledWith(
            actor,
            'mistral-ocr:ocr:page',
            1,
            OCR_COSTS['mistral-ocr:ocr:page'],
        );
        expect(metering.incrementUsage).toHaveBeenCalledWith(
            actor,
            'mistral-ocr:annotations:page',
            1,
            OCR_COSTS['mistral-ocr:annotations:page'],
        );
    });
});

// ── Default provider selection ──────────────────────────────────────

describe('OCRDriver default provider selection', () => {
    it('defaults to aws-textract when AWS is configured', async () => {
        const { driver } = makeDriver({
            awsConfigured: true,
            mistralConfigured: true,
        });
        loadFileInputMock.mockResolvedValueOnce({
            buffer: Buffer.from('img'),
            filename: 'doc.png',
            mimeType: 'image/png',
            fsEntry: null,
        });
        textractSendMock.mockResolvedValueOnce({
            Blocks: [{ BlockType: 'PAGE' }],
        });

        await withActor(makeActor(), () =>
            driver.recognize({ source: { path: '/doc.png' } }),
        );

        // No `provider` arg → AWS (preferred default) is hit, not Mistral.
        expect(textractSendMock).toHaveBeenCalledTimes(1);
        expect(mistralOcrProcessMock).not.toHaveBeenCalled();
    });

    it('falls back to mistral when only Mistral is configured', async () => {
        const { driver } = makeDriver({
            awsConfigured: false,
            mistralConfigured: true,
        });
        loadFileInputMock.mockResolvedValueOnce({
            buffer: Buffer.from('img'),
            filename: 'doc.png',
            mimeType: 'image/png',
            fsEntry: null,
        });
        mistralOcrProcessMock.mockResolvedValueOnce({
            pages: [{ index: 0, markdown: 'hi' }],
            usageInfo: { pagesProcessed: 1 },
        });

        await withActor(makeActor(), () =>
            driver.recognize({ source: { path: '/doc.png' } }),
        );

        expect(mistralOcrProcessMock).toHaveBeenCalledTimes(1);
        expect(textractSendMock).not.toHaveBeenCalled();
    });

    it('throws 500 when no provider is configured at all', async () => {
        const { driver } = makeDriver({
            awsConfigured: false,
            mistralConfigured: false,
        });
        await expect(
            withActor(makeActor(), () =>
                driver.recognize({ source: { path: '/doc.png' } }),
            ),
        ).rejects.toMatchObject({ statusCode: 500 });
    });
});
