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
import type { Actor } from '../../../../../core/actor.js';
import type { AwsCredentials } from '../../../../../util/awsCredentials.js';
import type { ResolvedFileInput } from '../../../../util/fileInput.js';
import {
    badRequest,
    estimateOcrPages,
    holdOcrCredits,
} from '../../../interfaces/ocr/common.js';
import { OCR_COSTS } from '../../../interfaces/ocr/costs.js';
import type { OcrModel } from '../../../interfaces/ocr/models.js';
import type {
    IOcrProvider,
    OcrBlock,
    RecognizeArgs,
} from '../../../interfaces/ocr/types.js';
import type { AiMeteringService } from '../../../shared/aiCostFactor.js';
import { textractRates } from './textractPricing.js';

const DEFAULT_TEXTRACT_REGION = 'us-west-2';
export const TEXTRACT_PAGE_USAGE_TYPE =
    'aws-textract:detect-document-text:page';

interface TextractBlock {
    BlockType?: string;
    Confidence?: number;
    Text?: string;
}

/**
 * AWS Textract OCR: DetectDocumentText through region-aware clients, reading a
 * Puter file straight from its S3 bucket when it has one.
 */
export class TextractOcrProvider implements IOcrProvider {
    /** One client per region. */
    #clients: Record<string, TextractClient> = {};
    /** DetectDocumentText rates per region, from AWS's public price list. */
    #rates = textractRates(OCR_COSTS[TEXTRACT_PAGE_USAGE_TYPE]);
    readonly #region: string;

    constructor(
        private readonly metering: AiMeteringService,
        private readonly config: {
            credentials: AwsCredentials;
            region?: string;
        },
    ) {
        this.#region = config.region ?? DEFAULT_TEXTRACT_REGION;
        // Warm the configured region so the cost report has its rate.
        void this.#rates.rate(this.#region);
    }

    /**
     * The configured region's first-tier rate. A call that reads its file from
     * a bucket in another region is billed at that region's rate instead.
     */
    reportedPageRate(): number {
        return this.#rates.peek(this.#region);
    }

    #clientFor(region: string): TextractClient {
        const cached = this.#clients[region];
        if (cached) return cached;
        const client = new TextractClient({
            credentials: this.config.credentials,
            region,
        });
        this.#clients[region] = client;
        return client;
    }

    async recognize(
        input: ResolvedFileInput,
        _args: RecognizeArgs,
        model: OcrModel,
        actor: Actor,
    ) {
        // Prefer S3 direct source if the file is FS-backed; fall back to raw bytes.
        const { fsEntry } = input;
        const s3Info =
            fsEntry && fsEntry.bucket && fsEntry.bucketRegion
                ? {
                      bucket: fsEntry.bucket,
                      bucketRegion: fsEntry.bucketRegion,
                      key: fsEntry.uuid,
                  }
                : null;

        const configuredRegion = this.#region;

        // Both regions the call may run in are priced up front, so the hold
        // covers either and a refresh mid-call can't change the charge.
        const [configuredRate, s3Rate] = await Promise.all([
            this.#rates.rate(configuredRegion),
            s3Info ? this.#rates.rate(s3Info.bucketRegion) : undefined,
        ]);

        const tryRun = async (useS3: boolean) => {
            const region =
                s3Info && useS3 ? s3Info.bucketRegion : configuredRegion;
            const client = this.#clientFor(region);
            const document =
                s3Info && useS3
                    ? { S3Object: { Bucket: s3Info.bucket, Name: s3Info.key } }
                    : { Bytes: (await input.load()).buffer };
            return client.send(
                new DetectDocumentTextCommand({ Document: document }),
            );
        };

        const hold = await holdOcrCredits(
            this.metering,
            actor,
            model.pageUsageType,
            Math.max(configuredRate, s3Rate ?? 0) *
                (await estimateOcrPages(input, model.provider)),
        );
        try {
            let response;
            let costPerPage: number;
            try {
                try {
                    response = await tryRun(Boolean(s3Info));
                    costPerPage = s3Rate ?? configuredRate;
                } catch (err) {
                    if (!(s3Info && err instanceof InvalidS3ObjectException))
                        throw err;
                    response = await tryRun(false);
                    costPerPage = configuredRate;
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
            this.metering.incrementUsage(
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
        } finally {
            await hold.release();
        }
    }
}
