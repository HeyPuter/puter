import { TextractClient, AnalyzeDocumentCommand, InvalidS3ObjectException } from '@aws-sdk/client-textract';
import { HttpError } from '../../core/http/HttpError.js';
import { Context } from '../../core/context.js';
import { PuterDriver } from '../types.js';
import type { MeteringService } from '../../services/metering/MeteringService.js';
import type { FSEntryService } from '../../services/fs/FSEntryService.js';
import { loadFileInput, type LoadedFile } from '../util/fileInput.js';
import { mimeFromName } from '../../util/fileSigning.js';

/**
 * Driver implementing `puter-ocr` — document OCR. Two providers:
 *   • `aws-textract`  — AWS Textract (region-aware clients; direct S3 source when available)
 *   • `mistral`       — Mistral OCR (URL/data-URL based)
 *
 * Request contract matches v1 so existing puter-js clients transparently work.
 */

interface RecognizeArgs {
    source?: unknown;
    file?: unknown;
    provider?: string;
    // Mistral-specific options — ignored by Textract.
    model?: string;
    pages?: number[];
    includeImageBase64?: boolean;
    imageLimit?: number;
    imageMinSize?: number;
    bboxAnnotationFormat?: unknown;
    documentAnnotationFormat?: unknown;
    test_mode?: boolean;
}

interface TextractBlock {
    BlockType?: string;
    Confidence?: number;
    Text?: string;
}

interface MistralOcrResponse {
    model?: string;
    pages?: Array<{ index?: number; markdown?: string; images?: unknown[]; dimensions?: unknown }>;
    usageInfo?: { pagesProcessed?: number };
}

interface MistralOcrClient {
    ocr: {
        process: (payload: Record<string, unknown>) => Promise<MistralOcrResponse>;
    };
}

export class OCRDriver extends PuterDriver {
    readonly driverInterface = 'puter-ocr';
    readonly driverName = 'ai-ocr';
    readonly isDefault = true;

    // Textract state — one client per region.
    #textractClients: Record<string, TextractClient> = {};
    #awsConfig: { accessKeyId?: string; secretAccessKey?: string; region?: string } | null = null;

    // Mistral state.
    #mistral: MistralOcrClient | null = null;

    override onServerStart () {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const cfg = this.config as any;
        const aws = cfg?.aws ?? cfg?.services?.['aws-textract'];
        if ( aws?.access_key && aws?.secret_key ) {
            this.#awsConfig = {
                accessKeyId: aws.access_key,
                secretAccessKey: aws.secret_key,
                region: aws.region ?? 'us-west-2',
            };
        }

        const mistralCfg = cfg?.services?.['mistral-ocr'] ?? cfg?.mistral;
        const mistralKey = mistralCfg?.apiKey ?? mistralCfg?.api_key;
        if ( mistralKey ) {
            try {
                // Lazy import so we don't pay the cost when Mistral is unused.
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                const { Mistral } = require('@mistralai/mistralai');
                this.#mistral = new Mistral({ apiKey: mistralKey }) as unknown as MistralOcrClient;
            } catch (e) {
                console.warn('[OCRDriver] Failed to init Mistral:', (e as Error).message);
            }
        }
    }

    async recognize (args: RecognizeArgs) {
        if ( args.test_mode ) return sampleResponse();

        const provider = args.provider ?? this.#defaultProvider();
        if ( ! provider ) throw new HttpError(500, 'No OCR provider configured');

        const actor = Context.get('actor');
        if ( ! actor ) throw new HttpError(401, 'Authentication required');
        const userId = Number((actor as { user?: { id?: unknown } }).user?.id ?? NaN);
        if ( Number.isNaN(userId) ) throw new HttpError(401, 'Unauthorized');

        const input = args.source ?? args.file;
        if ( ! input ) throw new HttpError(400, '`source` is required');

        const loaded = await loadFileInput(this.stores, userId, input);

        if ( provider === 'aws-textract' ) {
            if ( ! this.#awsConfig ) throw new HttpError(500, 'AWS credentials not configured');
            return this.#textractRecognize(loaded, actor);
        }
        if ( provider === 'mistral' ) {
            if ( ! this.#mistral ) throw new HttpError(500, 'Mistral OCR not configured');
            return this.#mistralRecognize(loaded, args, actor);
        }
        throw new HttpError(400, `Unknown OCR provider: ${provider}`);
    }

    #defaultProvider (): 'aws-textract' | 'mistral' | null {
        if ( this.#awsConfig ) return 'aws-textract';
        if ( this.#mistral ) return 'mistral';
        return null;
    }

    // ── AWS Textract ─────────────────────────────────────────────────

    #textractClientFor (region: string): TextractClient {
        const cached = this.#textractClients[region];
        if ( cached ) return cached;
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

    async #textractRecognize (loaded: LoadedFile, actor: unknown) {
        const usageType = 'aws-textract:detect-document-text:page';
        const hasCredits = await this.services.metering.hasEnoughCreditsFor(actor, usageType, 1);
        if ( ! hasCredits ) throw new HttpError(402, 'Insufficient credits');

        // Prefer S3 direct source if the file is FS-backed; fall back to raw bytes.
        const s3Info = loaded.fsEntry && loaded.fsEntry.bucket && loaded.fsEntry.bucketRegion
            ? {
                bucket: loaded.fsEntry.bucket,
                bucketRegion: loaded.fsEntry.bucketRegion,
                key: loaded.fsEntry.uuid,
            }
            : null;

        const tryRun = async (useS3: boolean) => {
            const region = s3Info && useS3 ? s3Info.bucketRegion : (this.#awsConfig!.region ?? 'us-west-2');
            const client = this.#textractClientFor(region);
            const document = s3Info && useS3
                ? { S3Object: { Bucket: s3Info.bucket, Name: s3Info.key } }
                : { Bytes: loaded.buffer };
            return client.send(new AnalyzeDocumentCommand({
                Document: document,
                FeatureTypes: ['LAYOUT'],
            }));
        };

        let response;
        try {
            response = await tryRun(Boolean(s3Info));
        } catch ( err ) {
            if ( s3Info && err instanceof InvalidS3ObjectException ) {
                response = await tryRun(false);
            } else {
                throw err;
            }
        }

        const blocks: Array<{ type: string; confidence: number; text: string }> = [];
        let pageCount = 0;
        for ( const block of (response.Blocks ?? []) as TextractBlock[] ) {
            if ( block.BlockType === 'PAGE' ) { pageCount += 1; continue; }
            if ( ['CELL', 'TABLE', 'MERGED_CELL', 'LAYOUT_FIGURE', 'LAYOUT_TEXT'].includes(block.BlockType ?? '') ) continue;
            blocks.push({
                type: `text/textract:${block.BlockType ?? 'UNKNOWN'}`,
                confidence: Number(block.Confidence ?? 0),
                text: block.Text ?? '',
            });
        }

        this.services.metering.incrementUsage(actor, usageType, pageCount || 1);
        return { blocks };
    }

    // ── Mistral OCR ──────────────────────────────────────────────────

    async #mistralRecognize (loaded: LoadedFile, args: RecognizeArgs, actor: unknown) {
        const model = args.model ?? 'mistral-ocr-latest';
        const chunk = this.#mistralBuildChunk(loaded);
        const payload: Record<string, unknown> = { model, document: chunk };
        if ( args.pages ) payload.pages = args.pages;
        if ( args.includeImageBase64 !== undefined ) payload.includeImageBase64 = args.includeImageBase64;
        if ( typeof args.imageLimit === 'number' ) payload.imageLimit = args.imageLimit;
        if ( typeof args.imageMinSize === 'number' ) payload.imageMinSize = args.imageMinSize;
        if ( args.bboxAnnotationFormat !== undefined ) payload.bboxAnnotationFormat = args.bboxAnnotationFormat;
        if ( args.documentAnnotationFormat !== undefined ) payload.documentAnnotationFormat = args.documentAnnotationFormat;

        const response = await this.#mistral!.ocr.process(payload);
        const annotations = payload.documentAnnotationFormat !== undefined || payload.bboxAnnotationFormat !== undefined;
        this.#recordMistralUsage(response, actor, annotations);
        return this.#normalizeMistralResponse(response);
    }

    #mistralBuildChunk (loaded: LoadedFile): Record<string, unknown> {
        const mime = loaded.mimeType ?? mimeFromName(loaded.filename) ?? 'application/octet-stream';
        const isPdf = mime.includes('pdf') || loaded.filename.toLowerCase().endsWith('.pdf');
        const dataUrl = `data:${mime};base64,${loaded.buffer.toString('base64')}`;
        if ( isPdf ) {
            return { type: 'document_url', documentUrl: dataUrl, documentName: loaded.filename };
        }
        return { type: 'image_url', imageUrl: { url: dataUrl } };
    }

    #normalizeMistralResponse (response: MistralOcrResponse) {
        const pages = response?.pages ?? [];
        const blocks: Array<{ type: string; text: string; page?: number }> = [];
        for ( const page of pages ) {
            if ( typeof page?.markdown !== 'string' ) continue;
            const lines = page.markdown.split('\n').map((l) => l.trim()).filter(Boolean);
            for ( const line of lines ) {
                blocks.push({ type: 'text/mistral:LINE', text: line, page: page.index });
            }
        }
        const text = blocks.length > 0
            ? blocks.map((b) => b.text).join('\n')
            : pages.map((p) => p?.markdown ?? '').join('\n\n').trim();
        return { model: response?.model, pages, usage_info: response?.usageInfo, blocks, text };
    }

    #recordMistralUsage (response: MistralOcrResponse, actor: unknown, annotations: boolean) {
        try {
            const pagesProcessed = response?.usageInfo?.pagesProcessed
                ?? (Array.isArray(response?.pages) ? response.pages.length : 1);
            this.services.metering.incrementUsage(actor, 'mistral-ocr:ocr:page', pagesProcessed);
            if ( annotations ) {
                this.services.metering.incrementUsage(actor, 'mistral-ocr:annotations:page', pagesProcessed);
            }
        } catch {
            // Non-critical.
        }
    }
}

function sampleResponse () {
    return {
        blocks: [
            { type: 'text/puter:sample-output', confidence: 1, text: 'test_mode is enabled; this is a sample OCR response.' },
        ],
    };
}
