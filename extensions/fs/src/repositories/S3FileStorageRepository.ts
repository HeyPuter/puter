import {
    AbortMultipartUploadCommand,
    CompleteMultipartUploadCommand,
    CreateMultipartUploadCommand,
    DeleteObjectCommand,
    PutObjectCommand,
    type S3Client,
    UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { s3ClientProvider } from '@heyputer/backend/src/clients/s3/s3ClientProvider.js';
import type {
    MultipartCompleteInput,
    ServerUploadInput,
    SignedMultipartPartUrlsInput,
    SignedUploadInput,
    SignedUploadPart,
    SignedUploadResult,
} from './s3Types.js';

const MIN_MULTIPART_SIZE = 64 * 1024 * 1024;
const DEFAULT_MULTIPART_PART_SIZE = 64 * 1024 * 1024;

export class S3StorageProvider {

    #s3ClientProvider: typeof s3ClientProvider;

    constructor (s3Provider: typeof s3ClientProvider) {
        this.#s3ClientProvider = s3Provider;
    }

    #getClientForRegion (region: string): S3Client {
        return this.#s3ClientProvider(region);
    }

    async createSignedUploadUrl (fileMetadata: SignedUploadInput, region: string): Promise<SignedUploadResult> {
        const [result] = await this.batchCreateSignedUploadUrls([fileMetadata], region);
        if ( ! result ) {
            throw new Error('Failed to create signed upload url');
        }
        return result;
    }

    async batchCreateSignedUploadUrls (filesMetadata: SignedUploadInput[], region: string): Promise<SignedUploadResult[]> {
        const client = this.#getClientForRegion(region);
        const now = Date.now();
        const settledResults = await Promise.allSettled(filesMetadata.map(async (fileMetadata) => {
            const expiresInSeconds = Math.max(60, Math.min(60 * 60, fileMetadata.expiresInSeconds));
            const expiresAt = now + expiresInSeconds * 1000;

            if ( fileMetadata.uploadMode === 'single' ) {
                const command = new PutObjectCommand({
                    Bucket: fileMetadata.bucket,
                    Key: fileMetadata.objectKey,
                    ContentType: fileMetadata.contentType,
                });
                const url = await getSignedUrl(client, command, { expiresIn: expiresInSeconds });
                return {
                    uploadMode: 'single' as const,
                    expiresAt,
                    url,
                };
            }

            const multipartPartSize = Math.max(
                MIN_MULTIPART_SIZE,
                fileMetadata.multipartPartSize ?? DEFAULT_MULTIPART_PART_SIZE,
            );
            const multipartPartCount = Math.max(1, Math.ceil(fileMetadata.size / multipartPartSize));
            let multipartUploadId: string | undefined;

            try {
                const multipartResult = await client.send(new CreateMultipartUploadCommand({
                    Bucket: fileMetadata.bucket,
                    Key: fileMetadata.objectKey,
                    ContentType: fileMetadata.contentType,
                }));

                if ( ! multipartResult.UploadId ) {
                    throw new Error('Failed to initialize multipart upload');
                }

                multipartUploadId = multipartResult.UploadId;
                const partUrls = await this.createSignedMultipartPartUrls({
                    bucket: fileMetadata.bucket,
                    objectKey: fileMetadata.objectKey,
                    multipartUploadId,
                    partNumbers: Array.from({ length: multipartPartCount }, (_, index) => index + 1),
                    expiresInSeconds,
                }, region);

                return {
                    uploadMode: 'multipart' as const,
                    expiresAt,
                    multipartUploadId,
                    multipartPartSize,
                    multipartPartCount,
                    multipartPartUrls: partUrls,
                };
            } catch ( error ) {
                if ( multipartUploadId ) {
                    try {
                        await this.abortMutipartUpload(
                            multipartUploadId,
                            region,
                            fileMetadata.bucket,
                            fileMetadata.objectKey,
                        );
                    } catch {
                        // Best effort cleanup for partially initialized multipart uploads.
                    }
                }
                throw error;
            }
        }));

        const failedResults = settledResults.filter((result) => result.status === 'rejected');
        if ( failedResults.length > 0 ) {
            await Promise.allSettled(settledResults.map((result, index) => {
                if ( result.status !== 'fulfilled' ) {
                    return Promise.resolve();
                }
                if ( result.value.uploadMode !== 'multipart' || !result.value.multipartUploadId ) {
                    return Promise.resolve();
                }
                const fileMetadata = filesMetadata[index];
                if ( ! fileMetadata ) {
                    return Promise.resolve();
                }
                return this.abortMutipartUpload(
                    result.value.multipartUploadId,
                    region,
                    fileMetadata.bucket,
                    fileMetadata.objectKey,
                );
            }));

            const firstFailure = failedResults[0]?.reason;
            if ( firstFailure instanceof Error ) {
                throw firstFailure;
            }
            throw new Error('Failed to create signed upload urls');
        }

        return settledResults.map((result) => {
            if ( result.status !== 'fulfilled' ) {
                throw new Error('Failed to create signed upload urls');
            }
            return result.value;
        });
    }

    async createSignedMultipartPartUrls (
        input: SignedMultipartPartUrlsInput,
        region: string,
    ): Promise<SignedUploadPart[]> {
        const client = this.#getClientForRegion(region);
        const expiresInSeconds = Math.max(60, Math.min(60 * 60, input.expiresInSeconds));

        return Promise.all(input.partNumbers.map(async (partNumber) => {
            const command = new UploadPartCommand({
                Bucket: input.bucket,
                Key: input.objectKey,
                UploadId: input.multipartUploadId,
                PartNumber: partNumber,
            });
            const url = await getSignedUrl(client, command, {
                expiresIn: expiresInSeconds,
            });
            return {
                partNumber,
                url,
            };
        }));
    }

    async completeMultipartUpload (input: MultipartCompleteInput, region: string): Promise<void> {
        const client = this.#getClientForRegion(region);
        await client.send(new CompleteMultipartUploadCommand({
            Bucket: input.bucket,
            Key: input.objectKey,
            UploadId: input.multipartUploadId,
            MultipartUpload: {
                Parts: [...input.parts]
                    .sort((partA, partB) => partA.partNumber - partB.partNumber)
                    .map((part) => ({
                        PartNumber: part.partNumber,
                        ETag: part.etag,
                    })),
            },
        }));
    }

    async abortMutipartUpload (uploadId: string, region: string, bucket: string, objectKey: string): Promise<void> {
        const client = this.#getClientForRegion(region);
        await client.send(new AbortMultipartUploadCommand({
            Bucket: bucket,
            Key: objectKey,
            UploadId: uploadId,
        }));
    }

    async uploadFromServer (input: ServerUploadInput, region: string): Promise<void> {
        const client = this.#getClientForRegion(region);
        await client.send(new PutObjectCommand({
            Bucket: input.bucket,
            Key: input.objectKey,
            ContentType: input.contentType,
            Body: input.body,
            ...(input.contentLength !== undefined ? { ContentLength: input.contentLength } : {}),
        }));
    }

    async deleteObject (bucket: string, objectKey: string, region: string): Promise<void> {
        const client = this.#getClientForRegion(region);
        await client.send(new DeleteObjectCommand({
            Bucket: bucket,
            Key: objectKey,
        }));
    }
}
