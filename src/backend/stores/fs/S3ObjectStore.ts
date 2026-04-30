import {
    AbortMultipartUploadCommand,
    CompleteMultipartUploadCommand,
    CopyObjectCommand,
    CreateMultipartUploadCommand,
    DeleteObjectCommand,
    DeleteObjectsCommand,
    GetObjectCommand,
    PutObjectCommand,
    type S3Client,
    UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'node:stream';
import type {
    CopyObjectInput,
    DeleteObjectsInput,
    GetObjectInput,
    GetObjectResult,
    MultipartCompleteInput,
    ServerUploadInput,
    SignedMultipartPartUrlsInput,
    SignedUploadInput,
    SignedUploadPart,
    SignedUploadResult,
} from './s3Types.js';
import { PuterStore } from '../types.js';

/**
 * Store that owns S3 object I/O for fsentries: signed-URL minting, multipart
 * lifecycle, server-driven uploads, and object reads/copies/deletes. Wraps
 * the regional `S3Client` pool exposed by `clients.s3`.
 */
export class S3ObjectStore extends PuterStore {
    #getClientForRegion(region: string): S3Client {
        return this.clients.s3.get(region);
    }

    // Older entries (migrated from v1) can have a null bucketRegion; callers
    // use this to fall back to the configured default instead of erroring.
    resolveRegion(region?: string | null): string {
        return (
            region || this.config.s3_region || this.config.region || 'us-west-2'
        );
    }

    // Same story for `bucket`: older rows may be null. Fall back to the
    // configured default bucket.
    resolveBucket(bucket?: string | null): string {
        return bucket || this.config.s3_bucket || 'puter-local';
    }

    getMaxSingleUploadSize(): number {
        return this.clients.s3.maxSingleUploadSize;
    }

    getMultipartPartSize(): number {
        return this.clients.s3.partSize;
    }

    #resolveMultipartPartSize(requestedPartSize?: number): number {
        return Math.max(
            this.getMaxSingleUploadSize(),
            requestedPartSize ?? this.getMultipartPartSize(),
        );
    }

    async createSignedUploadUrl(
        fileMetadata: SignedUploadInput,
        region: string,
    ): Promise<SignedUploadResult> {
        const [result] = await this.batchCreateSignedUploadUrls(
            [fileMetadata],
            region,
        );
        if (!result) {
            throw new Error('Failed to create signed upload url');
        }
        return result;
    }

    async batchCreateSignedUploadUrls(
        filesMetadata: SignedUploadInput[],
        region: string,
    ): Promise<SignedUploadResult[]> {
        const client = this.#getClientForRegion(region);
        const now = Date.now();
        const settledResults = await Promise.allSettled(
            filesMetadata.map(async (fileMetadata) => {
                const expiresInSeconds = Math.max(
                    60,
                    Math.min(60 * 60, fileMetadata.expiresInSeconds),
                );
                const expiresAt = now + expiresInSeconds * 1000;
                const maxSingleUploadSize = this.getMaxSingleUploadSize();
                const shouldUseSingleUpload =
                    fileMetadata.uploadMode === 'single' &&
                    fileMetadata.size <= maxSingleUploadSize;

                if (shouldUseSingleUpload) {
                    const command = new PutObjectCommand({
                        Bucket: fileMetadata.bucket,
                        Key: fileMetadata.objectKey,
                        ContentType: fileMetadata.contentType,
                    });
                    const url = await getSignedUrl(client, command, {
                        expiresIn: expiresInSeconds,
                    });
                    return {
                        uploadMode: 'single' as const,
                        expiresAt,
                        url,
                    };
                }

                const multipartPartSize = this.#resolveMultipartPartSize(
                    fileMetadata.multipartPartSize,
                );
                const multipartPartCount = Math.max(
                    1,
                    Math.ceil(fileMetadata.size / multipartPartSize),
                );
                let multipartUploadId: string | undefined;

                try {
                    const multipartResult = await client.send(
                        new CreateMultipartUploadCommand({
                            Bucket: fileMetadata.bucket,
                            Key: fileMetadata.objectKey,
                            ContentType: fileMetadata.contentType,
                        }),
                    );

                    if (!multipartResult.UploadId) {
                        throw new Error(
                            'Failed to initialize multipart upload',
                        );
                    }

                    multipartUploadId = multipartResult.UploadId;
                    const partUrls = await this.createSignedMultipartPartUrls(
                        {
                            bucket: fileMetadata.bucket,
                            objectKey: fileMetadata.objectKey,
                            multipartUploadId,
                            partNumbers: Array.from(
                                { length: multipartPartCount },
                                (_, index) => index + 1,
                            ),
                            expiresInSeconds,
                        },
                        region,
                    );

                    return {
                        uploadMode: 'multipart' as const,
                        expiresAt,
                        multipartUploadId,
                        multipartPartSize,
                        multipartPartCount,
                        multipartPartUrls: partUrls,
                    };
                } catch (error) {
                    if (multipartUploadId) {
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
            }),
        );

        const failedResults = settledResults.filter(
            (result) => result.status === 'rejected',
        );
        if (failedResults.length > 0) {
            await Promise.allSettled(
                settledResults.map((result, index) => {
                    if (result.status !== 'fulfilled') {
                        return Promise.resolve();
                    }
                    if (
                        result.value.uploadMode !== 'multipart' ||
                        !result.value.multipartUploadId
                    ) {
                        return Promise.resolve();
                    }
                    const fileMetadata = filesMetadata[index];
                    if (!fileMetadata) {
                        return Promise.resolve();
                    }
                    return this.abortMutipartUpload(
                        result.value.multipartUploadId,
                        region,
                        fileMetadata.bucket,
                        fileMetadata.objectKey,
                    );
                }),
            );

            const firstFailure = failedResults[0]?.reason;
            if (firstFailure instanceof Error) {
                throw firstFailure;
            }
            throw new Error('Failed to create signed upload urls');
        }

        return settledResults.map((result) => {
            if (result.status !== 'fulfilled') {
                throw new Error('Failed to create signed upload urls');
            }
            return result.value;
        });
    }

    async createSignedMultipartPartUrls(
        input: SignedMultipartPartUrlsInput,
        region: string,
    ): Promise<SignedUploadPart[]> {
        const client = this.#getClientForRegion(region);
        const expiresInSeconds = Math.max(
            60,
            Math.min(60 * 60, input.expiresInSeconds),
        );

        return Promise.all(
            input.partNumbers.map(async (partNumber) => {
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
            }),
        );
    }

    async completeMultipartUpload(
        input: MultipartCompleteInput,
        region: string,
    ): Promise<void> {
        const client = this.#getClientForRegion(region);
        await client.send(
            new CompleteMultipartUploadCommand({
                Bucket: input.bucket,
                Key: input.objectKey,
                UploadId: input.multipartUploadId,
                MultipartUpload: {
                    Parts: [...input.parts]
                        .sort(
                            (partA, partB) =>
                                partA.partNumber - partB.partNumber,
                        )
                        .map((part) => ({
                            PartNumber: part.partNumber,
                            ETag: part.etag,
                        })),
                },
            }),
        );
    }

    async abortMutipartUpload(
        uploadId: string,
        region: string,
        bucket: string,
        objectKey: string,
    ): Promise<void> {
        const client = this.#getClientForRegion(region);
        await client.send(
            new AbortMultipartUploadCommand({
                Bucket: bucket,
                Key: objectKey,
                UploadId: uploadId,
            }),
        );
    }

    async uploadFromServer(
        input: ServerUploadInput,
        region: string,
    ): Promise<void> {
        const client = this.#getClientForRegion(region);
        const maxSingleUploadSize = this.getMaxSingleUploadSize();
        const resolvedContentLength = this.#resolveContentLength(input);
        const shouldUseMultipart =
            input.body instanceof Readable
                ? resolvedContentLength === undefined ||
                  resolvedContentLength > maxSingleUploadSize
                : resolvedContentLength !== undefined &&
                  resolvedContentLength > maxSingleUploadSize;

        if (!shouldUseMultipart) {
            await client.send(
                new PutObjectCommand({
                    Bucket: input.bucket,
                    Key: input.objectKey,
                    ContentType: input.contentType,
                    Body: input.body,
                    // Use the *resolved* length (input.contentLength → sizeHint →
                    // Buffer.byteLength). Without this, a Readable body whose
                    // length we know only via `sizeHint` falls into the SDK's
                    // chunked-streaming path and emits
                    // `x-amz-decoded-content-length: undefined`, which the HTTP
                    // layer rejects as an invalid header value.
                    ...(resolvedContentLength !== undefined
                        ? { ContentLength: resolvedContentLength }
                        : {}),
                }),
            );
            return;
        }

        await this.#uploadFromServerMultipart(
            input,
            region,
            this.#resolveMultipartPartSize(),
        );
    }

    async deleteObject(
        bucket: string,
        objectKey: string,
        region: string,
    ): Promise<void> {
        const client = this.#getClientForRegion(region);
        await client.send(
            new DeleteObjectCommand({
                Bucket: bucket,
                Key: objectKey,
            }),
        );
    }

    // Batch delete up to 1000 objects per S3 API limit; callers chunk if needed.
    async deleteObjects(
        input: DeleteObjectsInput,
        region: string,
    ): Promise<void> {
        if (input.objectKeys.length === 0) return;
        const client = this.#getClientForRegion(region);
        const MAX_BATCH = 1000;
        for (
            let offset = 0;
            offset < input.objectKeys.length;
            offset += MAX_BATCH
        ) {
            const chunk = input.objectKeys.slice(offset, offset + MAX_BATCH);
            await client.send(
                new DeleteObjectsCommand({
                    Bucket: input.bucket,
                    Delete: {
                        Objects: chunk.map((key) => ({ Key: key })),
                        Quiet: true,
                    },
                }),
            );
        }
    }

    // Server-side copy. Avoids downloading/re-uploading bytes.
    async copyObject(input: CopyObjectInput, region: string): Promise<void> {
        const client = this.#getClientForRegion(region);
        await client.send(
            new CopyObjectCommand({
                Bucket: input.destinationBucket,
                Key: input.destinationKey,
                CopySource: `${input.sourceBucket}/${encodeURIComponent(input.sourceKey)}`,
                ...(input.contentType
                    ? { ContentType: input.contentType }
                    : {}),
                ...(input.metadataDirective
                    ? { MetadataDirective: input.metadataDirective }
                    : {}),
            }),
        );
    }

    async getObjectStream(
        input: GetObjectInput,
        region: string,
    ): Promise<GetObjectResult> {
        const client = this.#getClientForRegion(region);
        const response = await client.send(
            new GetObjectCommand({
                Bucket: input.bucket,
                Key: input.objectKey,
                ...(input.range ? { Range: input.range } : {}),
            }),
        );

        const body = response.Body;
        if (!body) {
            throw new Error('S3 getObject returned no body');
        }
        // AWS SDK v3 returns body as Readable in Node.js; other runtimes return a web stream.
        const stream =
            body instanceof Readable
                ? body
                : Readable.fromWeb(
                      body as unknown as import('node:stream/web').ReadableStream,
                  );

        return {
            body: stream,
            contentLength: response.ContentLength ?? null,
            contentType: response.ContentType ?? null,
            contentRange: response.ContentRange ?? null,
            etag: response.ETag ?? null,
            lastModified: response.LastModified ?? null,
        };
    }

    #resolveContentLength(input: ServerUploadInput): number | undefined {
        if (
            Number.isFinite(input.contentLength) &&
            Number(input.contentLength) >= 0
        ) {
            return Number(input.contentLength);
        }
        if (Number.isFinite(input.sizeHint) && Number(input.sizeHint) >= 0) {
            return Number(input.sizeHint);
        }
        if (Buffer.isBuffer(input.body) || input.body instanceof Uint8Array) {
            return input.body.byteLength;
        }
        if (typeof input.body === 'string') {
            return Buffer.byteLength(input.body);
        }
        return undefined;
    }

    #toBuffer(chunk: unknown): Buffer {
        if (Buffer.isBuffer(chunk)) {
            return chunk;
        }
        if (chunk instanceof Uint8Array) {
            return Buffer.from(
                chunk.buffer,
                chunk.byteOffset,
                chunk.byteLength,
            );
        }
        if (typeof chunk === 'string') {
            return Buffer.from(chunk);
        }
        throw new Error('Unsupported chunk type for multipart upload');
    }

    async #uploadFromServerMultipart(
        input: ServerUploadInput,
        region: string,
        partSize: number,
    ): Promise<void> {
        const client = this.#getClientForRegion(region);
        const createResult = await client.send(
            new CreateMultipartUploadCommand({
                Bucket: input.bucket,
                Key: input.objectKey,
                ContentType: input.contentType,
            }),
        );

        const uploadId = createResult.UploadId;
        if (!uploadId) {
            throw new Error('Failed to initialize multipart upload');
        }

        const completedParts: Array<{ ETag: string; PartNumber: number }> = [];
        let partNumber = 1;

        const uploadPart = async (partBody: Buffer) => {
            const uploadPartResult = await client.send(
                new UploadPartCommand({
                    Bucket: input.bucket,
                    Key: input.objectKey,
                    UploadId: uploadId,
                    PartNumber: partNumber,
                    Body: partBody,
                    ContentLength: partBody.byteLength,
                }),
            );
            if (!uploadPartResult.ETag) {
                throw new Error(
                    `Multipart upload returned no ETag for part ${partNumber}`,
                );
            }
            completedParts.push({
                ETag: uploadPartResult.ETag,
                PartNumber: partNumber,
            });
            partNumber++;
        };

        try {
            if (
                Buffer.isBuffer(input.body) ||
                input.body instanceof Uint8Array
            ) {
                const bufferBody = this.#toBuffer(input.body);
                for (
                    let offset = 0;
                    offset < bufferBody.byteLength;
                    offset += partSize
                ) {
                    const partBody = bufferBody.subarray(
                        offset,
                        offset + partSize,
                    );
                    await uploadPart(partBody);
                }
            } else if (typeof input.body === 'string') {
                const bufferBody = Buffer.from(input.body);
                for (
                    let offset = 0;
                    offset < bufferBody.byteLength;
                    offset += partSize
                ) {
                    const partBody = bufferBody.subarray(
                        offset,
                        offset + partSize,
                    );
                    await uploadPart(partBody);
                }
            } else if (input.body instanceof Readable) {
                let pendingChunk: Buffer = Buffer.alloc(0);
                for await (const chunk of input.body) {
                    const chunkBuffer = this.#toBuffer(chunk);
                    if (chunkBuffer.byteLength === 0) {
                        continue;
                    }
                    pendingChunk =
                        pendingChunk.byteLength === 0
                            ? chunkBuffer
                            : Buffer.concat([pendingChunk, chunkBuffer]);
                    while (pendingChunk.byteLength >= partSize) {
                        const partBody = pendingChunk.subarray(0, partSize);
                        await uploadPart(partBody);
                        pendingChunk = pendingChunk.subarray(partSize);
                    }
                }
                if (pendingChunk.byteLength > 0) {
                    await uploadPart(pendingChunk);
                }
            } else {
                throw new Error('Unsupported body type for multipart upload');
            }

            if (completedParts.length === 0) {
                await client.send(
                    new AbortMultipartUploadCommand({
                        Bucket: input.bucket,
                        Key: input.objectKey,
                        UploadId: uploadId,
                    }),
                );
                await client.send(
                    new PutObjectCommand({
                        Bucket: input.bucket,
                        Key: input.objectKey,
                        ContentType: input.contentType,
                        Body: Buffer.alloc(0),
                        ContentLength: 0,
                    }),
                );
                return;
            }

            await client.send(
                new CompleteMultipartUploadCommand({
                    Bucket: input.bucket,
                    Key: input.objectKey,
                    UploadId: uploadId,
                    MultipartUpload: {
                        Parts: completedParts,
                    },
                }),
            );
        } catch (error) {
            await client
                .send(
                    new AbortMultipartUploadCommand({
                        Bucket: input.bucket,
                        Key: input.objectKey,
                        UploadId: uploadId,
                    }),
                )
                .catch(() => undefined);
            throw error;
        }
    }
}
