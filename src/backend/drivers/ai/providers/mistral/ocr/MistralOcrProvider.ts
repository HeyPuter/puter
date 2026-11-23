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

import { Mistral } from '@mistralai/mistralai';
import type { Actor } from '../../../../../core/actor.js';
import { HttpError } from '../../../../../core/http/HttpError.js';
import { insufficientCreditsError } from '../../../../../services/metering/enforcement.js';
import type {
    LoadedFile,
    ResolvedFileInput,
} from '../../../../util/fileInput.js';
import {
    badRequest,
    estimateOcrPages,
    holdOcrCredits,
    inputMimeType,
    isDocumentInput,
} from '../../../interfaces/ocr/common.js';
import { OCR_COSTS } from '../../../interfaces/ocr/costs.js';
import {
    OCR_MAX_PAGES,
    type OcrModel,
} from '../../../interfaces/ocr/models.js';
import { HTTPClient } from '@mistralai/mistralai/lib/http.js';
import { jsonCheckedFetch } from '../../../shared/jsonCheckedFetch.js';
import { isMistralInputError, isMistralUnusableAnswer } from '../inputError.js';
import { malformedUpstreamResponse } from '../../../../util/upstreamErrors.js';
import type {
    IOcrProvider,
    OcrBlock,
    RecognizeArgs,
} from '../../../interfaces/ocr/types.js';
import {
    aiModelKey,
    type AiMeteringService,
} from '../../../../../util/aiCostFactor.js';

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

const TABLE_FORMATS = new Set(['markdown', 'html']);

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

/** Mistral OCR: the document is sent inline as a data URL. */
export class MistralOcrProvider implements IOcrProvider {
    readonly #client: MistralOcrClient;

    constructor(
        private readonly metering: AiMeteringService,
        config: { apiKey: string },
    ) {
        this.#client = new Mistral({
            httpClient: new HTTPClient({ fetcher: jsonCheckedFetch }),
            apiKey: config.apiKey,
        }) as unknown as MistralOcrClient;
    }

    async recognize(
        input: ResolvedFileInput,
        args: RecognizeArgs,
        model: OcrModel,
        actor: Actor,
    ) {
        const loaded = await input.load();
        const payload: Record<string, unknown> = {
            model: model.id,
            document: this.#buildChunk(loaded),
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
        const costPerPage =
            OCR_COSTS[model.pageUsageType] +
            (annotations && model.annotationUsageType
                ? OCR_COSTS[model.annotationUsageType]
                : 0);
        let pages = await estimateOcrPages(input, model.provider, args.pages);
        if (pages === null) {
            // A document whose pages can't be counted reads as many leading
            // pages as the balance covers, up to the provider's limit.
            const [remaining, factor] = await Promise.all([
                this.metering.getRemainingUsage(actor),
                this.metering.costFactor(
                    actor,
                    aiModelKey(model.pageUsageType),
                ),
            ]);
            pages = Math.min(
                OCR_MAX_PAGES[model.provider],
                Math.floor(remaining / Math.ceil(costPerPage * factor)),
            );
            if (pages < 1) throw insufficientCreditsError();
            if (pages < OCR_MAX_PAGES[model.provider])
                payload.pages = Array.from({ length: pages }, (_, i) => i);
        }
        const hold = await holdOcrCredits(
            this.metering,
            actor,
            model.pageUsageType,
            costPerPage * pages,
        );

        try {
            const response = await this.#client.ocr.process(payload);
            this.#recordUsage(response, model, actor, annotations);
            return this.#normalizeResponse(response, model);
        } catch (e) {
            if (isMistralInputError(e)) {
                throw new HttpError(400, 'invalid request for Mistral OCR', {
                    legacyCode: 'bad_request',
                });
            }
            if (isMistralUnusableAnswer(e)) {
                throw malformedUpstreamResponse('mistral', 'Mistral OCR');
            }
            throw e;
        } finally {
            await hold.release();
        }
    }

    #buildChunk(loaded: LoadedFile): Record<string, unknown> {
        const mime = inputMimeType(loaded);
        const dataUrl = `data:${mime};base64,${loaded.buffer.toString('base64')}`;
        if (isDocumentInput(loaded)) {
            return {
                type: 'document_url',
                documentUrl: dataUrl,
                documentName: loaded.filename,
            };
        }
        return { type: 'image_url', imageUrl: { url: dataUrl } };
    }

    #normalizeResponse(response: MistralOcrResponse, model: OcrModel) {
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

    #recordUsage(
        response: MistralOcrResponse,
        model: OcrModel,
        actor: Actor,
        annotations: boolean,
    ) {
        try {
            const reported = response?.usageInfo?.pagesProcessed;
            // The count Mistral reports, when it is one, and never more pages
            // than a document may have.
            const pagesProcessed = Math.min(
                typeof reported === 'number' &&
                    Number.isSafeInteger(reported) &&
                    reported > 0
                    ? reported
                    : Array.isArray(response?.pages)
                      ? response.pages.length
                      : 1,
                OCR_MAX_PAGES[model.provider],
            );
            this.metering.incrementUsage(
                actor,
                model.pageUsageType,
                pagesProcessed,
                OCR_COSTS[model.pageUsageType] * pagesProcessed,
            );
            if (annotations && model.annotationUsageType) {
                this.metering.incrementUsage(
                    actor,
                    model.annotationUsageType,
                    pagesProcessed,
                    OCR_COSTS[model.annotationUsageType] * pagesProcessed,
                );
            }
        } catch (error) {
            // The text is returned either way; an unrecorded charge is logged.
            console.error('[mistral-ocr] recording usage failed:', error);
        }
    }
}
