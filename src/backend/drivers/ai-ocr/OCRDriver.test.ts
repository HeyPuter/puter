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
 * Boots a real PuterServer (in-memory sqlite + dynamo + s3 + mock
 * redis) configured with both AWS Textract and Mistral OCR providers,
 * then drives `server.drivers.aiOcr` directly. The Textract and
 * Mistral SDKs are mocked at the module boundary — that's the real
 * network egress point — so the driver never reaches AWS / Mistral.
 * Inputs use `data:` URLs through the live `loadFileInput`, except
 * the S3Object-source test which writes a real FS-backed file via
 * `server.services.fs.write` so the driver picks up an `fsEntry` with
 * a bucket. Aligns with AGENTS.md: "Prefer test server over mocking
 * deps."
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
import { UnsupportedDocumentException } from '@aws-sdk/client-textract';
import { v4 as uuidv4 } from 'uuid';

import type { Actor } from '../../core/actor.js';
import { runWithContext } from '../../core/context.js';
import { PuterServer } from '../../server.js';
import type { MeteringService } from '../../services/metering/MeteringService.js';
import { setupTestServer } from '../../testUtil.js';
import { generateDefaultFsentries } from '../../util/userProvisioning.js';
import type { OCRDriver } from './OCRDriver.js';
import { OCR_COSTS } from './costs.js';

// ── SDK mocks ───────────────────────────────────────────────────────
//
// Textract and Mistral are external services; mock at the SDK boundary
// so the driver never reaches AWS / Mistral in tests.

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

// ── Test harness ────────────────────────────────────────────────────

let server: PuterServer;
let driver: OCRDriver;
let hasCreditsSpy: MockInstance<MeteringService['hasEnoughCredits']>;
let incrementUsageSpy: MockInstance<MeteringService['incrementUsage']>;

beforeAll(async () => {
    server = await setupTestServer({
        providers: {
            'aws-textract': {
                aws: {
                    access_key: 'AKIA-TEST',
                    secret_key: 'secret',
                    region: 'us-west-2',
                },
            },
            'mistral-ocr': { apiKey: 'mistral-key' },
        },
    } as never);
    driver = server.drivers.aiOcr as unknown as OCRDriver;
});

afterAll(async () => {
    await server?.shutdown();
});

beforeEach(() => {
    textractSendMock.mockReset();
    textractCtor.mockReset();
    mistralOcrProcessMock.mockReset();
    mistralCtor.mockReset();
    // Spy on metering — keep the real impl so its recording side runs,
    // but capture calls so per-test assertions can inspect them.
    hasCreditsSpy = vi.spyOn(server.services.metering, 'hasEnoughCredits');
    incrementUsageSpy = vi.spyOn(server.services.metering, 'incrementUsage');
});

afterEach(() => {
    vi.restoreAllMocks();
});

const makeUser = async (): Promise<{ actor: Actor; userId: number }> => {
    const username = `ocr-${Math.random().toString(36).slice(2, 10)}`;
    const created = await server.stores.user.create({
        username,
        uuid: uuidv4(),
        password: null,
        email: `${username}@test.local`,
        free_storage: 100 * 1024 * 1024,
        requires_email_confirmation: false,
    });
    await generateDefaultFsentries(
        server.clients.db,
        server.stores.user,
        created,
    );
    const refreshed = (await server.stores.user.getById(created.id))!;
    return {
        userId: refreshed.id,
        actor: {
            user: {
                id: refreshed.id,
                uuid: refreshed.uuid,
                username: refreshed.username,
                email: refreshed.email ?? null,
                email_confirmed: true,
            } as Actor['user'],
        },
    };
};

const withActor = <T>(actor: Actor, fn: () => T | Promise<T>): Promise<T> =>
    Promise.resolve(runWithContext({ actor }, fn));

const dataUrl = (buffer: Buffer, mime: string) =>
    `data:${mime};base64,${buffer.toString('base64')}`;

// ── getReportedCosts ────────────────────────────────────────────────

describe('OCRDriver.getReportedCosts', () => {
    it('mirrors every entry in costs.ts as a per-page line item', () => {
        const reported = driver.getReportedCosts();

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
        const result = await driver.recognize({ test_mode: true });
        // Canned shape from sampleResponse() — no fs, network, or
        // metering should be touched.
        expect((result as { blocks: unknown[] }).blocks?.[0]).toMatchObject({
            type: 'text/puter:sample-output',
            confidence: 1,
        });
        expect(textractSendMock).not.toHaveBeenCalled();
        expect(mistralOcrProcessMock).not.toHaveBeenCalled();
        expect(incrementUsageSpy).not.toHaveBeenCalled();
    });

    it('throws 401 when no actor is on the request context', async () => {
        await expect(
            driver.recognize({
                source: dataUrl(Buffer.from('x'), 'image/png'),
            }),
        ).rejects.toMatchObject({ statusCode: 401 });
    });

    it('throws 400 when neither source nor file is provided', async () => {
        const { actor } = await makeUser();
        await expect(
            withActor(actor, () => driver.recognize({})),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('throws 400 when an unknown provider is requested', async () => {
        const { actor } = await makeUser();
        await expect(
            withActor(actor, () =>
                driver.recognize({
                    source: dataUrl(Buffer.from('x'), 'image/png'),
                    provider: 'totally-not-real',
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });
});

// ── AWS Textract ────────────────────────────────────────────────────

describe('OCRDriver.recognize (aws-textract)', () => {
    const sampleTextractResponse = {
        Blocks: [
            { BlockType: 'PAGE' },
            { BlockType: 'LINE', Text: 'hello world', Confidence: 99.5 },
            { BlockType: 'WORD', Text: 'should-be-skipped' },
            { BlockType: 'LAYOUT_TITLE', Confidence: 85 }, // no Text
            { BlockType: 'PAGE' }, // 2 pages
            { BlockType: 'LINE', Text: 'second line', Confidence: 80 },
        ],
    };

    it('throws 402 when the actor does not have enough credits', async () => {
        hasCreditsSpy.mockResolvedValueOnce(false);
        const { actor } = await makeUser();

        await expect(
            withActor(actor, () =>
                driver.recognize({
                    source: dataUrl(Buffer.from('img'), 'image/png'),
                    provider: 'aws-textract',
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 402 });

        // No textract call should have been made when credits are short.
        expect(textractSendMock).not.toHaveBeenCalled();
    });

    it('sends raw bytes when the file is not FS-backed and returns normalised blocks', async () => {
        const { actor } = await makeUser();
        textractSendMock.mockResolvedValueOnce(sampleTextractResponse);

        const buf = Buffer.from('imgdata');
        const result = (await withActor(actor, () =>
            driver.recognize({
                source: dataUrl(buf, 'image/png'),
                provider: 'aws-textract',
            }),
        )) as {
            model: string;
            blocks: Array<{ type: string; text: string; confidence: number }>;
            text: string;
        };

        // Driver issued DetectDocumentTextCommand{ Bytes: <buffer> } — the
        // API billed at the detect-document-text rate, with no paid features.
        const sentCmd = textractSendMock.mock.calls[0]![0];
        expect(sentCmd.constructor.name).toBe('DetectDocumentTextCommand');
        expect(sentCmd.input.Document.Bytes).toEqual(buf);
        expect(sentCmd.input.FeatureTypes).toBeUndefined();

        // Only LINE blocks carry text; each is tagged with its 0-based page.
        expect(result.blocks).toEqual([
            {
                type: 'text/textract:LINE',
                text: 'hello world',
                confidence: 99.5,
                page: 0,
            },
            {
                type: 'text/textract:LINE',
                text: 'second line',
                confidence: 80,
                page: 1,
            },
        ]);
        expect(result.text).toBe('hello world\nsecond line');
        expect(result.model).toBe('aws-textract');
    });

    it('rejects multi-page and unsupported documents with a 400 that names the alternative', async () => {
        const { actor } = await makeUser();
        textractSendMock.mockRejectedValueOnce(
            new UnsupportedDocumentException({
                message: 'Request has unsupported document format',
                $metadata: {},
            }),
        );

        await expect(
            withActor(actor, () =>
                driver.recognize({
                    source: dataUrl(Buffer.from('%PDF-1.4'), 'application/pdf'),
                    provider: 'aws-textract',
                }),
            ),
        ).rejects.toMatchObject({
            statusCode: 400,
            message: expect.stringContaining('Mistral OCR model'),
        });
        expect(incrementUsageSpy).not.toHaveBeenCalled();
    });

    it('refuses input over the 10 MB Textract limit before any upstream call', async () => {
        const { actor } = await makeUser();
        const oversize = Buffer.alloc(10 * 1024 * 1024 + 1);

        await expect(
            withActor(actor, () =>
                driver.recognize({
                    source: dataUrl(oversize, 'image/png'),
                    provider: 'aws-textract',
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 413 });
        expect(textractSendMock).not.toHaveBeenCalled();
    });

    // Note: the S3Object-source branch (driver picks `Document.S3Object`
    // over inline Bytes when fsEntry has a bucket, and constructs a
    // TextractClient for that bucket's region) is best exercised by an
    // *.integration.test.ts against real S3 + Textract — the in-memory
    // S3 store doesn't deterministically produce a bucket-bearing
    // fsEntry, and the driver's per-region TextractClient cache leaks
    // across tests.

it('meters one usage line per detected page at the per-page rate from costs.ts', async () => {
        const { actor } = await makeUser();
        textractSendMock.mockResolvedValueOnce(sampleTextractResponse);

        await withActor(actor, () =>
            driver.recognize({
                source: dataUrl(Buffer.from('img'), 'image/png'),
                provider: 'aws-textract',
            }),
        );

        const usageType = 'aws-textract:detect-document-text:page';
        const perPage = OCR_COSTS[usageType];
        // sampleTextractResponse has 2 PAGE blocks → bill 2 pages.
        const ocrCalls = incrementUsageSpy.mock.calls.filter(
            ([, type]) => type === usageType,
        );
        expect(ocrCalls).toHaveLength(1);
        const [actorArg, , count, cost] = ocrCalls[0]!;
        expect((actorArg as Actor).user.id).toBe(actor.user.id);
        expect(count).toBe(2);
        expect(cost).toBe(perPage * 2);
    });

    it('treats a response with no PAGE blocks as a single page', async () => {
        const { actor } = await makeUser();
        textractSendMock.mockResolvedValueOnce({
            Blocks: [
                {
                    BlockType: 'LINE',
                    Text: 'just one line',
                    Confidence: 90,
                },
            ],
        });

        await withActor(actor, () =>
            driver.recognize({
                source: dataUrl(Buffer.from('img'), 'image/png'),
                provider: 'aws-textract',
            }),
        );

        const usageType = 'aws-textract:detect-document-text:page';
        const ocrCalls = incrementUsageSpy.mock.calls.filter(
            ([, type]) => type === usageType,
        );
        expect(ocrCalls).toHaveLength(1);
        // pages = pageCount || 1 → bill 1 page when no PAGE block was returned.
        const [, , count, cost] = ocrCalls[0]!;
        expect(count).toBe(1);
        expect(cost).toBe(OCR_COSTS[usageType]);
    });
});

// ── Mistral OCR ─────────────────────────────────────────────────────

describe('OCRDriver.recognize (mistral)', () => {
    const bboxSchema = { type: 'object', properties: {} };
    const docSchema = {
        type: 'object',
        properties: { total: { type: 'string' } },
    };

    it('throws 402 when the actor does not have enough credits', async () => {
        hasCreditsSpy.mockResolvedValueOnce(false);
        const { actor } = await makeUser();

        await expect(
            withActor(actor, () =>
                driver.recognize({
                    source: dataUrl(Buffer.from('img'), 'image/png'),
                    provider: 'mistral',
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 402 });

        // The paid Mistral call must not happen when credits are short.
        expect(mistralOcrProcessMock).not.toHaveBeenCalled();
    });

    it('packages an image as an image_url chunk with a base64 data URL', async () => {
        const { actor } = await makeUser();
        mistralOcrProcessMock.mockResolvedValueOnce({
            model: 'mistral-ocr-latest',
            pages: [],
            usageInfo: { pagesProcessed: 1 },
        });

        const buf = Buffer.from('imgdata');
        await withActor(actor, () =>
            driver.recognize({
                source: dataUrl(buf, 'image/png'),
                provider: 'mistral',
            }),
        );

        const payload = mistralOcrProcessMock.mock.calls[0]![0];
        // The floating alias is pinned to the model the catalog prices.
        expect(payload.model).toBe('mistral-ocr-4-1');
        // Mistral's SDK uses camelCase imageUrl on this chunk shape.
        expect(payload.document).toEqual({
            type: 'image_url',
            imageUrl: { url: dataUrl(buf, 'image/png') },
        });
    });

    it('packages a PDF as a document_url chunk preserving the original filename', async () => {
        const { actor, userId } = await makeUser();
        // Write a real PDF so the fsEntry carries the filename verbatim.
        const buf = Buffer.from('%PDF-data');
        await server.services.fs.write(userId, {
            fileMetadata: {
                path: `/${actor.user.username}/spec.pdf`,
                size: buf.byteLength,
                contentType: 'application/pdf',
            },
            fileContent: buf,
        });

        mistralOcrProcessMock.mockResolvedValueOnce({
            pages: [],
            usageInfo: { pagesProcessed: 1 },
        });

        await withActor(actor, () =>
            driver.recognize({
                source: { path: `/${actor.user.username}/spec.pdf` },
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

    it('sends non-image documents such as DOCX as a document_url chunk', async () => {
        const { actor } = await makeUser();
        mistralOcrProcessMock.mockResolvedValueOnce({ pages: [] });
        const docx =
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

        await withActor(actor, () =>
            driver.recognize({
                source: dataUrl(Buffer.from('PK'), docx),
                provider: 'mistral',
            }),
        );

        const payload = mistralOcrProcessMock.mock.calls[0]![0];
        expect(payload.document.type).toBe('document_url');
        expect(payload.document.documentUrl).toMatch(/^data:application\/vnd/);
    });

    it('sends untyped PDF bytes as a document and untyped other bytes as an image', async () => {
        const { actor } = await makeUser();
        mistralOcrProcessMock.mockResolvedValue({ pages: [] });

        for (const bytes of ['%PDF-1.7', 'png-ish']) {
            await withActor(actor, () =>
                driver.recognize({
                    source: dataUrl(
                        Buffer.from(bytes),
                        'application/octet-stream',
                    ),
                    provider: 'mistral',
                }),
            );
        }

        const [pdfCall, imageCall] = mistralOcrProcessMock.mock.calls;
        expect(pdfCall![0].document.type).toBe('document_url');
        expect(imageCall![0].document.type).toBe('image_url');
    });

    it('forwards page filters and annotation options to Mistral when supplied', async () => {
        const { actor } = await makeUser();
        mistralOcrProcessMock.mockResolvedValueOnce({
            pages: [],
            usageInfo: { pagesProcessed: 1 },
        });

        await withActor(actor, () =>
            driver.recognize({
                source: dataUrl(Buffer.from('x'), 'application/pdf'),
                provider: 'mistral',
                pages: [0, 2],
                includeImageBase64: true,
                imageLimit: 10,
                imageMinSize: 64,
                // REST spelling and SDK spelling are both accepted.
                bboxAnnotationFormat: {
                    type: 'json_schema',
                    json_schema: { name: 'bbox', schema: bboxSchema },
                },
                documentAnnotationFormat: {
                    type: 'json_schema',
                    jsonSchema: {
                        name: 'doc',
                        schemaDefinition: docSchema,
                        strict: true,
                    },
                },
                documentAnnotationPrompt: 'Extract the invoice fields',
                tableFormat: 'html',
                extractHeader: true,
                extractFooter: false,
            }),
        );

        const payload = mistralOcrProcessMock.mock.calls[0]![0];
        expect(payload.pages).toEqual([0, 2]);
        expect(payload.includeImageBase64).toBe(true);
        expect(payload.imageLimit).toBe(10);
        expect(payload.imageMinSize).toBe(64);
        expect(payload.bboxAnnotationFormat).toEqual({
            type: 'json_schema',
            jsonSchema: { name: 'bbox', schemaDefinition: bboxSchema },
        });
        expect(payload.documentAnnotationFormat).toEqual({
            type: 'json_schema',
            jsonSchema: {
                name: 'doc',
                schemaDefinition: docSchema,
                strict: true,
            },
        });
        expect(payload.documentAnnotationPrompt).toBe(
            'Extract the invoice fields',
        );
        expect(payload.tableFormat).toBe('html');
        expect(payload.extractHeader).toBe(true);
        expect(payload.extractFooter).toBe(false);
    });

    it.each([
        ['documentAnnotationFormat', { schema: 'doc' }],
        ['documentAnnotationFormat', 'json'],
        ['bboxAnnotationFormat', { type: 'json_object' }],
        ['tableFormat', 'csv'],
    ])('rejects an invalid %s before calling Mistral', async (name, value) => {
        const { actor } = await makeUser();

        await expect(
            withActor(actor, () =>
                driver.recognize({
                    source: dataUrl(Buffer.from('x'), 'application/pdf'),
                    provider: 'mistral',
                    [name]: value,
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
        expect(mistralOcrProcessMock).not.toHaveBeenCalled();
    });

    it('normalises the response: each markdown line becomes a LINE block on its source page', async () => {
        const { actor } = await makeUser();
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

        const result = (await withActor(actor, () =>
            driver.recognize({
                source: dataUrl(Buffer.from('x'), 'application/pdf'),
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

    it('returns the document annotation Mistral produced', async () => {
        const { actor } = await makeUser();
        mistralOcrProcessMock.mockResolvedValueOnce({
            model: 'mistral-ocr-4-1',
            pages: [{ index: 0, markdown: 'Total: 42' }],
            documentAnnotation: '{"total": "42"}',
            usageInfo: { pagesProcessed: 1 },
        });

        const result = (await withActor(actor, () =>
            driver.recognize({
                source: dataUrl(Buffer.from('x'), 'application/pdf'),
                provider: 'mistral',
                documentAnnotationFormat: {
                    type: 'json_schema',
                    json_schema: { name: 'doc', schema: docSchema },
                },
            }),
        )) as { document_annotation?: string; text: string };

        expect(result.document_annotation).toBe('{"total": "42"}');
        expect(result.text).toBe('Total: 42');
    });

    it('meters per-page Mistral OCR usage from costs.ts', async () => {
        const { actor } = await makeUser();
        mistralOcrProcessMock.mockResolvedValueOnce({
            pages: [
                { index: 0, markdown: 'a' },
                { index: 1, markdown: 'b' },
            ],
            usageInfo: { pagesProcessed: 2 },
        });

        await withActor(actor, () =>
            driver.recognize({
                source: dataUrl(Buffer.from('x'), 'application/pdf'),
                provider: 'mistral',
            }),
        );

        const ocrCalls = incrementUsageSpy.mock.calls.filter(
            ([, type]) => type === 'mistral-ocr:mistral-ocr-4-1:page',
        );
        expect(ocrCalls).toHaveLength(1);
        const [, , count, cost] = ocrCalls[0]!;
        expect(count).toBe(2);
        expect(cost).toBe(OCR_COSTS['mistral-ocr:mistral-ocr-4-1:page'] * 2);
    });

    it('also meters annotations when bboxAnnotationFormat or documentAnnotationFormat is requested', async () => {
        const { actor } = await makeUser();
        mistralOcrProcessMock.mockResolvedValueOnce({
            pages: [{ index: 0, markdown: 'a' }],
            usageInfo: { pagesProcessed: 1 },
        });

        await withActor(actor, () =>
            driver.recognize({
                source: dataUrl(Buffer.from('x'), 'application/pdf'),
                provider: 'mistral',
                bboxAnnotationFormat: {
                    type: 'json_schema',
                    json_schema: { name: 'bbox', schema: bboxSchema },
                },
            }),
        );

        const pageType = 'mistral-ocr:mistral-ocr-4-1:page';
        const annotationType = 'mistral-ocr:mistral-ocr-4-1:annotations:page';
        // The pre-flight covers the page plus its annotation.
        expect(hasCreditsSpy.mock.calls[0]![1]).toBe(
            OCR_COSTS[pageType] + OCR_COSTS[annotationType],
        );
        const ocrCalls = incrementUsageSpy.mock.calls.filter(
            ([, type]) => type === pageType,
        );
        const annotationCalls = incrementUsageSpy.mock.calls.filter(
            ([, type]) => type === annotationType,
        );
        expect(ocrCalls).toHaveLength(1);
        expect(annotationCalls).toHaveLength(1);
        expect(ocrCalls[0]![2]).toBe(1);
        expect(ocrCalls[0]![3]).toBe(OCR_COSTS[pageType]);
        expect(annotationCalls[0]![2]).toBe(1);
        expect(annotationCalls[0]![3]).toBe(OCR_COSTS[annotationType]);
    });

    it('bills OCR 3 at its own rate', async () => {
        const { actor } = await makeUser();
        mistralOcrProcessMock.mockResolvedValueOnce({
            pages: [{ index: 0, markdown: 'a' }],
            usageInfo: { pagesProcessed: 1 },
        });

        await withActor(actor, () =>
            driver.recognize({
                source: dataUrl(Buffer.from('x'), 'application/pdf'),
                model: 'mistral-ocr-3',
            }),
        );

        expect(mistralOcrProcessMock.mock.calls[0]![0].model).toBe(
            'mistral-ocr-2512',
        );
        const [, type, count, cost] = incrementUsageSpy.mock.calls[0]!;
        expect(type).toBe('mistral-ocr:mistral-ocr-2512:page');
        expect(count).toBe(1);
        expect(cost).toBe(OCR_COSTS['mistral-ocr:mistral-ocr-2512:page']);
    });
});

// ── Default provider selection ──────────────────────────────────────

describe('OCRDriver provider aliases', () => {
    it.each([
        ['aws', 'textract'],
        ['textract', 'textract'],
        ['aws-textract', 'textract'],
        ['mistral', 'mistral'],
        ['mistral-ocr', 'mistral'],
    ])('routes provider %s to the %s backend', async (provider, expected) => {
        const { actor } = await makeUser();
        textractSendMock.mockResolvedValueOnce({
            Blocks: [{ BlockType: 'PAGE' }],
        });
        mistralOcrProcessMock.mockResolvedValueOnce({
            pages: [{ index: 0, markdown: 'hi' }],
        });

        await withActor(actor, () =>
            driver.recognize({
                source: dataUrl(Buffer.from('img'), 'image/png'),
                provider,
            }),
        );

        if (expected === 'textract') {
            expect(textractSendMock).toHaveBeenCalledTimes(1);
            expect(mistralOcrProcessMock).not.toHaveBeenCalled();
        } else {
            expect(mistralOcrProcessMock).toHaveBeenCalledTimes(1);
            expect(textractSendMock).not.toHaveBeenCalled();
        }
    });
});

describe('OCRDriver model routing', () => {
    it.each([
        ['aws-textract', 'textract'],
        ['textract', 'textract'],
        ['mistral-ocr-latest', 'mistral'],
        ['mistral-ocr-4-0', 'mistral'],
        ['MISTRAL-OCR-2512', 'mistral'],
    ])('model %s alone selects the %s backend', async (model, expected) => {
        const { actor } = await makeUser();
        textractSendMock.mockResolvedValueOnce({
            Blocks: [{ BlockType: 'PAGE' }],
        });
        mistralOcrProcessMock.mockResolvedValueOnce({ pages: [] });

        await withActor(actor, () =>
            driver.recognize({
                source: dataUrl(Buffer.from('img'), 'image/png'),
                model,
            }),
        );

        if (expected === 'textract') {
            expect(textractSendMock).toHaveBeenCalledTimes(1);
            expect(mistralOcrProcessMock).not.toHaveBeenCalled();
        } else {
            expect(mistralOcrProcessMock).toHaveBeenCalledTimes(1);
            expect(textractSendMock).not.toHaveBeenCalled();
        }
    });

    it.each([
        [{ model: 'mistral-ocr-2505' }, 'no longer available'],
        [{ model: 'gpt-4o' }, 'Unknown OCR model'],
        [{ model: '' }, 'non-empty string'],
        [
            { model: 'mistral-ocr-latest', provider: 'aws-textract' },
            'not served by provider',
        ],
    ])('rejects %j with a 400 before any upstream call', async (args, message) => {
        const { actor } = await makeUser();

        await expect(
            withActor(actor, () =>
                driver.recognize({
                    source: dataUrl(Buffer.from('img'), 'image/png'),
                    ...args,
                }),
            ),
        ).rejects.toMatchObject({
            statusCode: 400,
            message: expect.stringContaining(message),
        });
        expect(textractSendMock).not.toHaveBeenCalled();
        expect(mistralOcrProcessMock).not.toHaveBeenCalled();
    });

    it('keeps the retired mistral-ocr-2503 working on the model Mistral serves it with', async () => {
        const { actor } = await makeUser();
        mistralOcrProcessMock.mockResolvedValueOnce({ pages: [] });

        await withActor(actor, () =>
            driver.recognize({
                source: dataUrl(Buffer.from('img'), 'image/png'),
                model: 'mistral-ocr-2503',
            }),
        );

        expect(mistralOcrProcessMock.mock.calls[0]![0].model).toBe(
            'mistral-ocr-4-1',
        );
    });
});

describe('OCRDriver default provider selection', () => {
    it('defaults to aws-textract when both providers are configured', async () => {
        const { actor } = await makeUser();
        textractSendMock.mockResolvedValueOnce({
            Blocks: [{ BlockType: 'PAGE' }],
        });

        await withActor(actor, () =>
            driver.recognize({
                source: dataUrl(Buffer.from('img'), 'image/png'),
            }),
        );

        // No `provider` arg → AWS (preferred default) is hit, not Mistral.
        expect(textractSendMock).toHaveBeenCalledTimes(1);
        expect(mistralOcrProcessMock).not.toHaveBeenCalled();
    });
});
