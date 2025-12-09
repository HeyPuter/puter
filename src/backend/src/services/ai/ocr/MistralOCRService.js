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

// METADATA // {"ai-commented":{"service":"claude"}}
import { Context } from '@heyputer/putility/src/libs/context.js';
import { Mistral } from '@mistralai/mistralai';
import mime from 'mime-types';
import { APIError } from 'openai';
import path from 'path';
import BaseService from '../../BaseService.js';

/**
* MistralAIService class extends BaseService to provide integration with the Mistral AI API.
* Implements chat completion functionality with support for various Mistral models including
* mistral-large, pixtral, codestral, and ministral variants. Handles both streaming and
* non-streaming responses, token usage tracking, and model management. Provides cost information
* for different models and implements the puter-chat-completion interface.
*/
export class MistralOCRService extends BaseService {
    /** @type {import('../../MeteringService/MeteringService.js').MeteringService} */
    meteringService;
    /**
    * Initializes the service's cost structure for different Mistral AI models.
    * Sets up pricing information for various models including token costs for input/output.
    * Each model entry specifies currency (usd-cents) and costs per million tokens.
    * @private
    */

    models = [
        { id: 'mistral-ocr-latest',
            aliases: ['mistral-ocr-2505', 'mistral-ocr'],
            cost: {
                currency: 'usd-cents',
                pages: 1000,
                input: 100,
                output: 300,
            },
        },
    ];

    static IMPLEMENTS = {
        'driver-capabilities': {
            supports_test_mode (iface, method_name) {
                return iface === 'puter-ocr' && method_name === 'recognize';
            },
        },
        'puter-ocr': {
            async recognize (...params) {
                return this.recognize(...params);
            },
        },
    };

    /**
    * Initializes the service's cost structure for different Mistral AI models.
    * Sets up pricing information for various models including token costs for input/output.
    * Each model entry specifies currency (USD cents) and costs per million tokens.
    * @private
    */
    async _init () {
        this.api_base_url = 'https://api.mistral.ai/v1';
        this.client = new Mistral({
            apiKey: this.config.apiKey,
        });

        const svc_aiChat = this.services.get('ai-chat');
        svc_aiChat.register_provider({
            service_name: this.service_name,
            alias: true,
        });

        this.meteringService = this.services.get('meteringService').meteringService;
    }

    async recognize ({
        source,
        model,
        pages,
        includeImageBase64,
        imageLimit,
        imageMinSize,
        bboxAnnotationFormat,
        documentAnnotationFormat,
        test_mode,
    }) {
        if ( test_mode ) {
            return this.#sampleOcrResponse();
        }
        if ( ! source ) {
            throw APIError.create('missing_required_argument', {
                interface_name: 'puter-ocr',
                method_name: 'recognize',
                arg_name: 'source',
            });
        }

        const document = await this._buildDocumentChunkFromSource(source);
        const payload = {
            model: model ?? 'mistral-ocr-latest',
            document,
        };
        if ( Array.isArray(pages) ) {
            payload.pages = pages;
        }
        if ( typeof includeImageBase64 === 'boolean' ) {
            payload.includeImageBase64 = includeImageBase64;
        }
        if ( typeof imageLimit === 'number' ) {
            payload.imageLimit = imageLimit;
        }
        if ( typeof imageMinSize === 'number' ) {
            payload.imageMinSize = imageMinSize;
        }
        if ( bboxAnnotationFormat !== undefined ) {
            payload.bboxAnnotationFormat = bboxAnnotationFormat;
        }
        if ( documentAnnotationFormat !== undefined ) {
            payload.documentAnnotationFormat = documentAnnotationFormat;
        }

        const response = await this.client.ocr.process(payload);
        const annotationsRequested = (
            payload.documentAnnotationFormat !== undefined ||
            payload.bboxAnnotationFormat !== undefined
        );
        this.#recordOcrUsage(response, payload.model, {
            annotationsRequested,
        });
        return this.#normalizeOcrResponse(response);
    }

    async _buildDocumentChunkFromSource (fileFacade) {
        const dataUrl = await this._safeFileValue(fileFacade, 'data_url');
        const webUrl = await this._safeFileValue(fileFacade, 'web_url');
        const filePath = await this._safeFileValue(fileFacade, 'path');
        const fsNode = await this._safeFileValue(fileFacade, 'fs-node');
        const fileName = filePath ? path.basename(filePath) : fsNode?.name;
        const inferredMime = this._inferMimeFromName(fileName);

        if ( webUrl ) {
            return this._chunkFromUrl(webUrl, fileName, inferredMime);
        }
        if ( dataUrl ) {
            const mimeFromUrl = this._extractMimeFromDataUrl(dataUrl) ?? inferredMime;
            return this._chunkFromUrl(dataUrl, fileName, mimeFromUrl);
        }

        const buffer = await this._safeFileValue(fileFacade, 'buffer');
        if ( ! buffer ) {
            throw APIError.create('field_invalid', null, {
                key: 'source',
                expected: 'file, data URL, or web URL',
            });
        }
        const mimeType = inferredMime ?? 'application/octet-stream';
        const generatedDataUrl = this._createDataUrl(buffer, mimeType);
        return this._chunkFromUrl(generatedDataUrl, fileName, mimeType);
    }

    async _safeFileValue (fileFacade, key) {
        if ( !fileFacade || typeof fileFacade.get !== 'function' ) return undefined;
        const maybeCache = fileFacade.values?.values;
        if ( maybeCache && Object.prototype.hasOwnProperty.call(maybeCache, key) ) {
            return maybeCache[key];
        }
        try {
            return await fileFacade.get(key);
        } catch (e) {
            return undefined;
        }
    }

    _chunkFromUrl (url, fileName, mimeType) {
        const lowerName = fileName?.toLowerCase();
        const urlLooksPdf = /\.pdf($|\?)/i.test(url);
        const mimeLooksPdf = mimeType?.includes('pdf');
        const isPdf = mimeLooksPdf || urlLooksPdf || (lowerName ? lowerName.endsWith('.pdf') : false);

        if ( isPdf ) {
            const chunk = {
                type: 'document_url',
                documentUrl: url,
            };
            if ( fileName ) {
                chunk.documentName = fileName;
            }
            return chunk;
        }

        return {
            type: 'image_url',
            imageUrl: {
                url,
            },
        };
    }

    _inferMimeFromName (name) {
        if ( ! name ) return undefined;
        return mime.lookup(name) || undefined;
    }

    _extractMimeFromDataUrl (url) {
        if ( typeof url !== 'string' ) return undefined;
        const match = url.match(/^data:([^;,]+)[;,]/);
        return match ? match[1] : undefined;
    }

    _createDataUrl (buffer, mimeType) {
        return `data:${mimeType || 'application/octet-stream'};base64,${buffer.toString('base64')}`;
    }

    #normalizeOcrResponse (response) {
        if ( ! response ) return {};
        const normalized = {
            model: response.model,
            pages: response.pages ?? [],
            usage_info: response.usageInfo,
        };
        const blocks = [];
        if ( Array.isArray(response.pages) ) {
            for ( const page of response.pages ) {
                if ( typeof page?.markdown !== 'string' ) continue;
                const lines = page.markdown.split('\n').map(line => line.trim()).filter(Boolean);
                for ( const line of lines ) {
                    blocks.push({
                        type: 'text/mistral:LINE',
                        text: line,
                        page: page.index,
                    });
                }
            }
        }
        normalized.blocks = blocks;
        if ( blocks.length ) {
            normalized.text = blocks.map(block => block.text).join('\n');
        } else if ( Array.isArray(response.pages) ) {
            normalized.text = response.pages.map(page => page?.markdown || '').join('\n\n').trim();
        }
        return normalized;
    }

    #recordOcrUsage (response, model, { annotationsRequested } = {}) {
        try {
            if ( ! this.meteringService ) return;
            const actor = Context.get('actor');
            if ( ! actor ) return;
            const pagesProcessed =
                response?.usageInfo?.pagesProcessed ??
                (Array.isArray(response?.pages) ? response.pages.length : 1);
            this.meteringService.incrementUsage(actor, 'mistral-ocr:ocr:page', pagesProcessed);
            if ( annotationsRequested ) {
                this.meteringService.incrementUsage(actor, 'mistral-ocr:annotations:page', pagesProcessed);
            }
        } catch (e) {
            // ignore metering failures to avoid blocking OCR results
        }
    }

    #sampleOcrResponse () {
        const markdown = 'Sample OCR output (test mode).';
        return {
            model: 'mistral-ocr-latest',
            pages: [
                {
                    index: 0,
                    markdown,
                    images: [],
                    dimensions: null,
                },
            ],
            blocks: [
                {
                    type: 'text/mistral:LINE',
                    text: markdown,
                    page: 0,
                },
            ],
            text: markdown,
        };
    }
}
