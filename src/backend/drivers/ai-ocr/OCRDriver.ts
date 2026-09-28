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

import {
    DetectDocumentTextCommand,
    InvalidS3ObjectException,
    TextractClient,
    UnsupportedDocumentException,
} from '@aws-sdk/client-textract';
import { Mistral } from '@mistralai/mistralai';
import { Actor } from '../../core/actor.js';
import { Context } from '../../core/context.js';
import { HttpError } from '../../core/http/HttpError.js';
import { mimeFromName } from '../../util/fileSigning.js';
import type { MeteringService } from '../../services/metering/MeteringService.js';
import { PuterDriver } from '../types.js';
import { AI_CONCURRENT, AI_RATE_LIMIT } from '../util/aiLimits.js';
import { loadFileInput, type LoadedFile } from '../util/fileInput.js';
import { OCR_COSTS } from './costs.js';
import {
    DEFAULT_OCR_MODEL,
    findOcrModel,
    OCR_MAX_INPUT_BYTES,
    RETIRED_OCR_MODELS,
    type OcrModel,
    type OcrProviderId,
} from './models.js';

/**
 * Driver implementing `puter-ocr` — document OCR. Two providers: •
 * `aws-textract` — AWS Textract (region-aware clients; direct S3 source when
 * available) • `mistral` — Mistral OCR (URL/data-URL based)
 */
interface RecognizeArgs {
    source?: unknown;
    file?: unknown;
    provider?: string;
    model?: string;
    // Mistral-specific options — ignored by Textract.
    pages?: number[];
    includeImageBase64?: boolean;
    imageLimit?: number;
    imageMinSize?: number;
    bboxAnnotationFormat?: unknown;
    documentAnnotationFormat?: unknown;
    documentAnnotationPrompt?: string;
    tableFormat?: string;
    extractHeader?: boolean;
    extractFooter?: boolean;
    test_mode?: boolean;
}

/** One recognized line, in the same shape for every provider. */
interface OcrBlock {
    type: string;
    text: string;
    confidence?: number;
    page: number;
}

interface TextractBlock {
    BlockType?: string;
    Confidence?: number;
    Text?: string;
}

interface MistralOcrResponse {
    model?: string;
    pages?: Array<{
        index?: number;
        markdown?: string;
        images?: unknown[];
        dimensions?: unknown;
    }>;
    documentAnnotation?: string | null;
    usageInfo?: { pagesProcessed?: number };
}

interface MistralOcrClient {
    ocr: {
        process: (
            payload: Record<string, unknown>,
        ) => Promise<MistralOcrResponse>;
    };
}

const OCR_PROVIDERS = ['aws-textract', 'mistral'] as const;

// Aliases callers may use in place of a canonical provider id. Resolved here
// rather than in the SDK so a new alias reaches every caller at once.
const PROVIDER_BY_ALIAS: Record<string, OcrProviderId> = {
    aws: 'aws-textract',
    'aws-textract': 'aws-textract',
    textract: 'aws-textract',
    mistral: 'mistral',
    'mistral-ocr': 'mistral',
};

const normalizeOcrProvider = (value: unknown): OcrProviderId | undefined =>
    typeof value === 'string'
        ? PROVIDER_BY_ALIAS[value.trim().toLowerCase()]
        : undefined;

const TABLE_FORMATS = new Set(['markdown', 'html']);

const badRequest = (message: string) =>
    new HttpError(400, message, { legacyCode: 'bad_request' });

/**
 * Accept a Mistral annotation format in the REST spelling
 * (`json_schema.schema`) or the SDK spelling (`jsonSchema.schemaDefinition`)
 * and return the SDK shape.
 */
const toMistralResponseFormat = (
    name: string,
    value: unknown,
): Record<string, unknown> => {
    const format = value as Record<string, unknown> | null;
    const jsonSchema = (format?.jsonSchema ?? format?.json_schema) as
        Record<string, unknown> | undefined;
    const schema = jsonSchema?.schemaDefinition ?? jsonSchema?.schema;
    if (
        !format ||
        typeof format !== 'object' ||
        (format.type !== undefined && format.type !== 'json_schema') ||
        !schema ||
        typeof schema !== 'object'
    ) {
        throw badRequest(
            `\`${name}\` must be { type: 'json_schema', json_schema: { name, schema } }`,
        );
    }
    return {
        type: 'json_schema',
        jsonSchema: {
            name:
                typeof jsonSchema?.name === 'string'
                    ? jsonSchema.name
                    : 'annotation',
            schemaDefinition: schema,
            ...(typeof jsonSchema?.description === 'string' && {
                description: jsonSchema.description,
            }),
            ...(typeof jsonSchema?.strict === 'boolean' && {
                strict: jsonSchema.strict,
            }),
        },
    };
};

export class OCRDriver extends PuterDriver {
    readonly driverInterface = 'puter-ocr';
    readonly driverName = 'ai-ocr';

    // Shared AI policy — see `drivers/util/aiLimits.ts` for the tier table.
    readonly rateLimit = AI_RATE_LIMIT;
    readonly concurrent = AI_CONCURRENT;

    /** Metering scoped to this driver. Lazy: services wire up after drivers. */
    get #aiMetering(): MeteringService {
        return this.services.metering.withAiCostFactor(this.driverName);
    }

    override getReportedCosts() {
        return Object.entries(OCR_COSTS).map(([usageType, ucentsPerUnit]) => ({
            usageType,
            ucentsPerUnit,
            unit: 'page',
            source: 'driver:aiOcr',
        }));
    }

    // Older SDK bundles name the provider in the driver slot instead of
    // passing `{ provider }`; `#resolveModel` reads the requested alias
    // back off the Context.
    readonly driverAliases = [...OCR_PROVIDERS];
    readonly isDefault = true;

    // Textract state — one client per region.
    #textractClients: Record<string, TextractClient> = {};
    #awsConfig: {
        accessKeyId?: string;
        secretAccessKey?: string;
        region?: string;
    } | null = null;

    // Mistral state.
    #mistral: MistralOcrClient | null = null;

    override onServerStart() {
        const providers = this.config.providers ?? {};

        const textract = providers['aws-textract'] as
            Record<string, unknown> | undefined;
        const textractAws = (textract?.aws ?? textract) as
            Record<string, unknown> | undefined;
        const textractAccessKey = textractAws?.access_key as string | undefined;
        const textractSecretKey = textractAws?.secret_key as string | undefined;
        const textractRegion =
            (textractAws?.region as string | undefined) ??
            (textract?.region as string | undefined) ??
            'us-west-2';
        if (textractAccessKey && textractSecretKey) {
            this.#awsConfig = {
                accessKeyId: textractAccessKey,
                secretAccessKey: textractSecretKey,
                region: textractRegion,
            };
        }

        const mistral = providers['mistral-ocr'];
        if (mistral?.apiKey) {
            try {
                // Lazy import so we don't pay the cost when Mistral is unused.

                this.#mistral = new Mistral({
                    apiKey: mistral.apiKey,
                }) as unknown as MistralOcrClient;
            } catch (e) {
                console.warn(
                    '[OCRDriver] Failed to init Mistral:',
                    (e as Error).message,
                );
            }
        }
    }

    async recognize(args: RecognizeArgs) {
        if (args.test_mode) return sampleResponse();

        const model = this.#resolveModel(args);

        const actor = Context.get('actor');
        if (!actor)
            throw new HttpError(401, 'Authentication required', {
                legacyCode: 'unauthorized',
            });

        const input = args.source ?? args.file;
        if (!input) throw badRequest('`source` is required');

        if (model.provider === 'aws-textract' && !this.#awsConfig)
            throw new HttpError(500, 'AWS credentials not configured', {
                legacyCode: 'internal_error',
            });
        if (model.provider === 'mistral' && !this.#mistral)
            throw new HttpError(500, 'Mistral OCR not configured', {
                legacyCode: 'internal_error',
            });

        const loaded = await loadFileInput(
            this.stores,
            this.services.fs,
            actor,
            input,
            {
                acceptWebInput: true,
                maxBytes: OCR_MAX_INPUT_BYTES[model.provider],
            },
        );

        return model.provider === 'aws-textract'
            ? this.#textractRecognize(loaded, model, actor)
            : this.#mistralRecognize(loaded, args, model, actor);
    }

    /**
     * Decide which model handles a call. A `model` picks its own provider; an
     * explicit `provider`, then the legacy driver alias the caller dispatched
     * through, then whichever provider is configured pick that provider's
     * default model.
     */
    #resolveModel(args: RecognizeArgs): OcrModel {
        let provider: OcrProviderId | undefined;
        if (args.provider) {
            provider = normalizeOcrProvider(args.provider);
            if (!provider) {
                throw badRequest(
                    `Unknown OCR provider: ${args.provider}. Available: ${OCR_PROVIDERS.join(', ')}`,
                );
            }
        }

        if (args.model !== undefined) {
            if (typeof args.model !== 'string' || !args.model.trim())
                throw badRequest('`model` must be a non-empty string');
            const retired = RETIRED_OCR_MODELS[args.model.trim().toLowerCase()];
            if (retired)
                throw badRequest(
                    `${args.model} is no longer available: ${retired}`,
                );
            const model = findOcrModel(args.model);
            if (!model) throw badRequest(`Unknown OCR model: ${args.model}`);
            if (provider && model.provider !== provider)
                throw badRequest(
                    `OCR model ${args.model} is not served by provider ${args.provider}`,
                );
            return model;
        }

        provider ??=
            normalizeOcrProvider(Context.get('driverName')) ??
            this.#defaultProvider();
        if (!provider)
            throw new HttpError(500, 'No OCR provider configured', {
                legacyCode: 'internal_error',
            });
        return findOcrModel(DEFAULT_OCR_MODEL[provider])!;
    }

    #defaultProvider(): OcrProviderId | null {
        if (this.#awsConfig) return 'aws-textract';
        if (this.#mistral) return 'mistral';
        return null;
    }

    async #assertCredits(actor: Actor, costPerPage: number) {
        // Page count is only known once the provider answers, so pre-flight
        // one page's cost and meter the real total afterward.
        const hasCredits = await this.services.metering.hasEnoughCredits(
            actor,
            costPerPage,
        );
        if (!hasCredits)
            throw new HttpError(402, 'Insufficient credits', {
                legacyCode: 'insufficient_funds',
            });
    }

    // -- AWS Textract -------------------------------------------------

    #textractClientFor(region: string): TextractClient {
        const cached = this.#textractClients[region];
        if (cached) return cached;
        const client = new TextractClient({
            credentials: {
                accessKeyId: this.#awsConfig!.accessKeyId!,
                secretAccessKey: this.#awsConfig!.secretAccessKey!,
            },
            region,
        });
        this.#textractClients[region] = client;
        return client;
    }

    async #textractRecognize(
        loaded: LoadedFile,
        model: OcrModel,
        actor: Actor,
    ) {
        const costPerPage = OCR_COSTS[model.pageUsageType];
        await this.#assertCredits(actor, costPerPage);

        // Prefer S3 direct source if the file is FS-backed; fall back to raw bytes.
        const s3Info =
            loaded.fsEntry &&
            loaded.fsEntry.bucket &&
            loaded.fsEntry.bucketRegion
                ? {
                      bucket: loaded.fsEntry.bucket,
                      bucketRegion: loaded.fsEntry.bucketRegion,
                      key: loaded.fsEntry.uuid,
                  }
                : null;

        const tryRun = async (useS3: boolean) => {
            const region =
                s3Info && useS3
                    ? s3Info.bucketRegion
                    : (this.#awsConfig!.region ?? 'us-west-2');
            const client = this.#textractClientFor(region);
            const document =
                s3Info && useS3
                    ? { S3Object: { Bucket: s3Info.bucket, Name: s3Info.key } }
                    : { Bytes: loaded.buffer };
            return client.send(
                new DetectDocumentTextCommand({ Document: document }),
            );
        };

        let response;
        try {
            try {
                response = await tryRun(Boolean(s3Info));
            } catch (err) {
                if (!(s3Info && err instanceof InvalidS3ObjectException))
                    throw err;
                response = await tryRun(false);
            }
        } catch (err) {
            if (err instanceof UnsupportedDocumentException)
                throw badRequest(
                    'AWS Textract reads JPEG, PNG, TIFF and single-page PDF documents; use a Mistral OCR model for multi-page PDFs and other formats',
                );
            throw err;
        }

        const blocks: OcrBlock[] = [];
        let pageCount = 0;
        for (const block of (response.Blocks ?? []) as TextractBlock[]) {
            if (block.BlockType === 'PAGE') {
                pageCount += 1;
                continue;
            }
            if (block.BlockType !== 'LINE' || !block.Text) continue;
            blocks.push({
                type: 'text/textract:LINE',
                text: block.Text,
                confidence: Number(block.Confidence ?? 0),
                page: Math.max(pageCount - 1, 0),
            });
        }

        const pages = pageCount || 1;
        this.#aiMetering.incrementUsage(
            actor,
            model.pageUsageType,
            pages,
            costPerPage * pages,
        );
        return {
            model: model.id,
            blocks,
            text: blocks.map((b) => b.text).join('\n'),
        };
    }

    // -- Mistral OCR --------------------------------------------------

    async #mistralRecognize(
        loaded: LoadedFile,
        args: RecognizeArgs,
        model: OcrModel,
        actor: Actor,
    ) {
        const payload: Record<string, unknown> = {
            model: model.id,
            document: this.#mistralBuildChunk(loaded),
        };
        if (args.pages) payload.pages = args.pages;
        if (args.includeImageBase64 !== undefined)
            payload.includeImageBase64 = args.includeImageBase64;
        if (typeof args.imageLimit === 'number')
            payload.imageLimit = args.imageLimit;
        if (typeof args.imageMinSize === 'number')
            payload.imageMinSize = args.imageMinSize;
        if (args.bboxAnnotationFormat !== undefined)
            payload.bboxAnnotationFormat = toMistralResponseFormat(
                'bboxAnnotationFormat',
                args.bboxAnnotationFormat,
            );
        if (args.documentAnnotationFormat !== undefined)
            payload.documentAnnotationFormat = toMistralResponseFormat(
                'documentAnnotationFormat',
                args.documentAnnotationFormat,
            );
        if (typeof args.documentAnnotationPrompt === 'string')
            payload.documentAnnotationPrompt = args.documentAnnotationPrompt;
        if (args.tableFormat !== undefined) {
            if (!TABLE_FORMATS.has(args.tableFormat))
                throw badRequest("`tableFormat` must be 'markdown' or 'html'");
            payload.tableFormat = args.tableFormat;
        }
        if (typeof args.extractHeader === 'boolean')
            payload.extractHeader = args.extractHeader;
        if (typeof args.extractFooter === 'boolean')
            payload.extractFooter = args.extractFooter;

        const annotations =
            payload.documentAnnotationFormat !== undefined ||
            payload.bboxAnnotationFormat !== undefined;
        await this.#assertCredits(
            actor,
            OCR_COSTS[model.pageUsageType] +
                (annotations && model.annotationUsageType
                    ? OCR_COSTS[model.annotationUsageType]
                    : 0),
        );

        const response = await this.#mistral!.ocr.process(payload);
        this.#recordMistralUsage(response, model, actor, annotations);
        return this.#normalizeMistralResponse(response, model);
    }

    #mistralBuildChunk(loaded: LoadedFile): Record<string, unknown> {
        const mime =
            loaded.mimeType ??
            mimeFromName(loaded.filename) ??
            'application/octet-stream';
        // Declared documents (PDF, DOCX, PPTX, ...) and PDF bytes go as a
        // document; images and untyped bytes keep the image chunk.
        const isDocument =
            loaded.buffer.subarray(0, 4).toString('latin1') === '%PDF' ||
            loaded.filename.toLowerCase().endsWith('.pdf') ||
            (!mime.startsWith('image/') && mime !== 'application/octet-stream');
        const dataUrl = `data:${mime};base64,${loaded.buffer.toString('base64')}`;
        if (isDocument) {
            return {
                type: 'document_url',
                documentUrl: dataUrl,
                documentName: loaded.filename,
            };
        }
        return { type: 'image_url', imageUrl: { url: dataUrl } };
    }

    #normalizeMistralResponse(response: MistralOcrResponse, model: OcrModel) {
        const pages = response?.pages ?? [];
        const blocks: OcrBlock[] = [];
        for (const [position, page] of pages.entries()) {
            if (typeof page?.markdown !== 'string') continue;
            const lines = page.markdown
                .split('\n')
                .map((l) => l.trim())
                .filter(Boolean);
            for (const line of lines) {
                blocks.push({
                    type: 'text/mistral:LINE',
                    text: line,
                    page: page.index ?? position,
                });
            }
        }
        return {
            model: response?.model ?? model.id,
            pages,
            usage_info: response?.usageInfo,
            ...(typeof response?.documentAnnotation === 'string' && {
                document_annotation: response.documentAnnotation,
            }),
            blocks,
            text: blocks.map((b) => b.text).join('\n'),
        };
    }

    #recordMistralUsage(
        response: MistralOcrResponse,
        model: OcrModel,
        actor: Actor,
        annotations: boolean,
    ) {
        try {
            const pagesProcessed =
                response?.usageInfo?.pagesProcessed ??
                (Array.isArray(response?.pages) ? response.pages.length : 1);
            this.#aiMetering.incrementUsage(
                actor,
                model.pageUsageType,
                pagesProcessed,
                OCR_COSTS[model.pageUsageType] * pagesProcessed,
            );
            if (annotations && model.annotationUsageType) {
                this.#aiMetering.incrementUsage(
                    actor,
                    model.annotationUsageType,
                    pagesProcessed,
                    OCR_COSTS[model.annotationUsageType] * pagesProcessed,
                );
            }
        } catch {
            // Non-critical.
        }
    }
}

function sampleResponse() {
    return {
        model: 'test-mode',
        blocks: [
            {
                type: 'text/puter:sample-output',
                confidence: 1,
                text: 'test_mode is enabled; this is a sample OCR response.',
                page: 0,
            },
        ],
        text: 'test_mode is enabled; this is a sample OCR response.',
    };
}
