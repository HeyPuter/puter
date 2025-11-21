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
const { TextractClient, AnalyzeDocumentCommand, InvalidS3ObjectException } = require('@aws-sdk/client-textract');

const BaseService = require('../../services/BaseService');
const APIError = require('../../api/APIError');
const { Context } = require('../../util/context');

/**
* AWSTextractService class - Provides OCR (Optical Character Recognition) functionality using AWS Textract
* Extends BaseService to integrate with AWS Textract for document analysis and text extraction.
* Implements driver capabilities and puter-ocr interface for document recognition.
* Handles both S3-stored and buffer-based document processing with automatic region management.
*/
class AWSTextractService extends BaseService {
    /** @type {import('../../services/MeteringService/MeteringService').MeteringService} */
    get meteringService () {
        return this.services.get('meteringService').meteringService;
    }
    /**
    * AWS Textract service for OCR functionality
    * Provides document analysis capabilities using AWS Textract API
    * Implements interfaces for OCR recognition and driver capabilities
    * @extends BaseService
    */
    _construct () {
        this.clients_ = {};
    }

    static IMPLEMENTS = {
        ['driver-capabilities']: {
            supports_test_mode (iface, method_name) {
                return iface === 'puter-ocr' && method_name === 'recognize';
            },
        },
        ['puter-ocr']: {
            /**
            * Performs OCR recognition on a document using AWS Textract
            * @param {Object} params - Recognition parameters
            * @param {Object} params.source - The document source to analyze
            * @param {boolean} params.test_mode - If true, returns sample test output instead of processing
            * @returns {Promise<Object>} Recognition results containing blocks of text with confidence scores
            */
            async recognize ({ source, test_mode }) {
                if ( test_mode ) {
                    return {
                        blocks: [
                            {
                                type: 'text/textract:WORD',
                                confidence: 0.9999998807907104,
                                text: 'Hello',
                            },
                            {
                                type: 'text/puter:sample-output',
                                confidence: 1,
                                text: 'The test_mode flag is set to true. This is a sample output.',
                            },
                        ],
                    };
                }

                const resp = await this.analyze_document(source);

                // Simplify the response for common interface
                const puter_response = {
                    blocks: [],
                };

                for ( const block of resp.Blocks ) {
                    if ( block.BlockType === 'PAGE' ) continue;
                    if ( block.BlockType === 'CELL' ) continue;
                    if ( block.BlockType === 'TABLE' ) continue;
                    if ( block.BlockType === 'MERGED_CELL' ) continue;
                    if ( block.BlockType === 'LAYOUT_FIGURE' ) continue;
                    if ( block.BlockType === 'LAYOUT_TEXT' ) continue;

                    const puter_block = {
                        type: `text/textract:${block.BlockType}`,
                        confidence: block.Confidence,
                        text: block.Text,
                    };
                    puter_response.blocks.push(puter_block);
                }

                return puter_response;
            },
        },
    };

    /**
    * Creates AWS credentials object for authentication
    * @private
    * @returns {Object} Object containing AWS access key ID and secret access key
    */
    _create_aws_credentials () {
        return {
            accessKeyId: this.config.aws.access_key,
            secretAccessKey: this.config.aws.secret_key,
        };
    }

    _get_client (region) {
        if ( ! region ) {
            region = this.config.aws?.region ?? this.global_config.aws?.region
                ?? 'us-west-2';
        }
        if ( this.clients_[region] ) return this.clients_[region];

        this.clients_[region] = new TextractClient({
            credentials: this._create_aws_credentials(),
            region,
        });

        return this.clients_[region];
    }

    /**
    * Analyzes a document using AWS Textract to extract text and layout information
    * @param {FileFacade} file_facade - Interface to access the document file
    * @returns {Promise<Object>} The raw Textract API response containing extracted text blocks
    * @throws {Error} If document analysis fails or no suitable input format is available
    * @description Processes document through Textract's AnalyzeDocument API with LAYOUT feature.
    * Will attempt to use S3 direct access first, falling back to buffer upload if needed.
    */
    async analyze_document (file_facade) {
        const {
            client, document, using_s3,
        } = await this._get_client_and_document(file_facade);

        const actor = Context.get('actor');
        const usageType = 'aws-textract:detect-document-text:page';

        const usageAllowed = await this.meteringService.hasEnoughCreditsFor(actor, usageType, 1); // allow them to pass if they have enough for 1 page atleast

        if ( ! usageAllowed ) {
            throw APIError.create('insufficient_funds');
        }

        const command = new AnalyzeDocumentCommand({
            Document: document,
            FeatureTypes: [
                // 'TABLES',
                // 'FORMS',
                // 'SIGNATURES',
                'LAYOUT',
            ],
        });

        let textractResp;
        try {
            textractResp = await client.send(command);
        } catch (e) {
            if ( using_s3 && e instanceof InvalidS3ObjectException ) {
                const { client, document } =
                    await this._get_client_and_document(file_facade, true);
                const command = new AnalyzeDocumentCommand({
                    Document: document,
                    FeatureTypes: [
                        'LAYOUT',
                    ],
                });
                textractResp = await client.send(command);
            } else {
                throw e;
            }
        }

        // Metering integration for Textract OCR usage
        // AWS Textract metering: track page count, block count, cost, document size if available
        let pageCount = 0;
        if ( textractResp.Blocks ) {
            for ( const block of textractResp.Blocks ) {
                if ( block.BlockType === 'PAGE' ) pageCount += 1;
            }
        }
        this.meteringService.incrementUsage(actor, usageType, pageCount || 1);

        return textractResp;
    }

    /**
    * Gets AWS client and document configuration for Textract processing
    * @param {Object} file_facade - File facade object containing document source info
    * @param {boolean} [force_buffer] - If true, forces using buffer instead of S3
    * @returns {Promise<Object>} Object containing:
    *   - client: Configured AWS Textract client
    *   - document: Document configuration for Textract
    *   - using_s3: Boolean indicating if using S3 source
    * @throws {APIError} If file does not exist
    * @throws {Error} If no suitable input format is available
    */
    async _get_client_and_document (file_facade, force_buffer) {
        const try_s3info = await file_facade.get('s3-info');
        if ( try_s3info && !force_buffer ) {
            console.log('S3 INFO', try_s3info);
            return {
                using_s3: true,
                client: this._get_client(try_s3info.bucket_region),
                document: {
                    S3Object: {
                        Bucket: try_s3info.bucket,
                        Name: try_s3info.key,
                    },
                },
            };
        }

        const try_buffer = await file_facade.get('buffer');
        if ( try_buffer ) {
            return {
                client: this._get_client(),
                document: {
                    Bytes: try_buffer,
                },
            };
        }

        const fsNode = await file_facade.get('fs-node');
        if ( fsNode && !await fsNode.exists() ) {
            throw APIError.create('subject_does_not_exist');
        }

        throw new Error('No suitable input for Textract');
    }
}

module.exports = {
    AWSTextractService,
};
