const { TextractClient, AnalyzeDocumentCommand, InvalidS3ObjectException } = require("@aws-sdk/client-textract");

const BaseService = require("../../services/BaseService");
const APIError = require("../../api/APIError");

class AWSTextractService extends BaseService {
    _construct () {
        this.clients_ = {};
    }

    static IMPLEMENTS = {
        ['puter-ocr']: {
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
                        ]
                    };
                }

                const resp = await this.analyze_document(source);

                // Simplify the response for common interface
                const puter_response = {
                    blocks: []
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
            }
        },
    };

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

    async analyze_document (file_facade) {
        const {
            client, document, using_s3
        } = await this._get_client_and_document(file_facade);

        const command = new AnalyzeDocumentCommand({
            Document: document,
            FeatureTypes: [
                // 'TABLES',
                // 'FORMS',
                // 'SIGNATURES',
                'LAYOUT'
            ],
        });

        try {
            return await client.send(command);
        } catch (e) {
            if ( using_s3 && e instanceof InvalidS3ObjectException ) {
                const { client, document } =
                    await this._get_client_and_document(file_facade, true);
                const command = new AnalyzeDocumentCommand({
                    Document: document,
                    FeatureTypes: [
                        'LAYOUT',
                    ],
                })
                return await client.send(command);
            }

            throw e;
        }

        throw new Error('expected to be unreachable');
    }

    async _get_client_and_document (file_facade, force_buffer) {
        const try_s3info = await file_facade.get('s3-info');
        if ( try_s3info && ! force_buffer ) {
            console.log('S3 INFO', try_s3info)
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
            const base64 = try_buffer.toString('base64');
            return {
                client: this._get_client(),
                document: {
                    Bytes: try_buffer,
                },
            };
        }

        const fsNode = await file_facade.get('fs-node');
        if ( fsNode && ! await fsNode.exists() ) {
            throw APIError.create('subject_does_not_exist');
        }

        throw new Error('No suitable input for Textract');
    }
}

module.exports = {
    AWSTextractService,
};
