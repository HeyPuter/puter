import { posix as pathPosix } from 'node:path';
import { createHash } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import type { TransformCallback } from 'node:stream';
import { v4 as uuidv4 } from 'uuid';
import { FSEntryRepository } from '../../stores/fs/FSEntryRepository.js';
import { S3StorageProvider } from '../../stores/fs/S3StorageProvider.js';
import type {
    MultipartCompletePart,
    SignedUploadResult,
} from '../../stores/fs/s3Types.js';
import {
    FSEntry,
    FSEntryCreateInput,
    FSEntryWriteInput,
    PendingUploadCreateInput,
    PendingUploadSession,
} from '../../stores/fs/FSEntry.js';
import {
    BinaryPayload,
    CompleteWriteRequest,
    CompleteWriteResponse,
    SignMultipartPartsRequest,
    SignMultipartPartsResponse,
    SignedWriteRequest,
    SignedWriteResponse,
    UploadMode,
    WriteRequest,
    WriteResponse,
} from '../../controllers/fs/requestTypes.js';
import type {
    BatchWritePrepareRequest,
    NormalizedWriteInput,
    PreparedBatchWrite,
    UploadedBatchWriteItem,
    UploadPayload,
    UploadPreparedBatchItemInput,
    UploadProgressTrackerLike,
} from './types.js';
import { runWithConcurrencyLimitSettled } from '../../utils/concurrency.js';
import { HttpError } from '../../core/http/HttpError.js';
import { PuterService } from '../types.js';
import type { IConfig, LayerInstances, WithLifecycle } from '../../types.js';
import type { puterClients } from '../../clients/index.js';
import type { puterStores } from '../../stores/index.js';
import { FSEntryCacheInvalidationEventHandler } from './cacheInvalidation.js';

const DEFAULT_CONTENT_TYPE = 'application/octet-stream';
const DEFAULT_SIGNED_UPLOAD_EXPIRY_SECONDS = 60 * 15;

interface WriteTargetResolutionInput {
    index: number;
    normalizedInput: NormalizedWriteInput;
}

interface WriteTargetResolutionResult {
    index: number;
    normalizedInput: NormalizedWriteInput;
    existingEntry: FSEntry | null;
    wasOverwrite: boolean;
}

interface SignedMultipartCleanupTarget {
    bucket: string;
    bucketRegion: string;
    objectKey: string;
    signedUploadResult: SignedUploadResult;
}

interface StartSignedWriteResult {
    response: SignedWriteResponse;
    createdDirectoryEntries: FSEntry[];
}

interface BatchStartSignedWriteResult {
    responses: SignedWriteResponse[];
    createdDirectoryEntries: FSEntry[];
}

export class FSEntryService extends PuterService {
    #fsEntryRepository!: FSEntryRepository;
    #s3StorageProvider!: S3StorageProvider;

    constructor (
        config: IConfig,
        clients: LayerInstances<typeof puterClients>,
        stores: LayerInstances<typeof puterStores>,
        services: Partial<Record<string, WithLifecycle>> = {},
    ) {
        super(config, clients, stores, services);
    }

    override onServerStart (): void {
        this.#fsEntryRepository = new FSEntryRepository(
            this.clients.db,
            this.clients.redis.client,
            this.stores.kv,
            this.config,
        );
        this.#s3StorageProvider = new S3StorageProvider(
            this.clients.s3,
        );

        // Wire cache invalidation: listens to events emitted by legacy FS
        // mutations and invalidates redis-cached fs entries.
        new FSEntryCacheInvalidationEventHandler(
            this.#fsEntryRepository,
            this.clients.event,
        );
    }

    #normalizePath (path: string): string {
        const trimmedPath = path.trim();
        if ( trimmedPath.length === 0 ) {
            throw new HttpError(400, 'Path cannot be empty');
        }
        if ( trimmedPath === '~' || trimmedPath.startsWith('~/') ) {
            throw new HttpError(400, 'Home path must be resolved before write');
        }

        let normalizedPath = pathPosix.normalize(trimmedPath);
        if ( ! normalizedPath.startsWith('/') ) {
            normalizedPath = `/${normalizedPath}`;
        }
        if ( normalizedPath.length > 1 && normalizedPath.endsWith('/') ) {
            normalizedPath = normalizedPath.slice(0, -1);
        }
        return normalizedPath;
    }

    #resolveBucket (metadata: FSEntryWriteInput): string {
        const bucket = metadata.bucket ?? this.config.s3_bucket ?? 'puter-local';
        if ( typeof bucket !== 'string' || bucket.length === 0 ) {
            throw new HttpError(500, 'Missing S3 bucket configuration');
        }
        return bucket;
    }

    #resolveBucketRegion (metadata: FSEntryWriteInput): string {
        const bucketRegion = metadata.bucketRegion
            ?? this.config.s3_region
            ?? this.config.region
            ?? 'us-west-2';

        if ( typeof bucketRegion !== 'string' || bucketRegion.length === 0 ) {
            throw new HttpError(500, 'Missing S3 region configuration');
        }

        return bucketRegion;
    }

    #normalizeWriteInput (userId: number, metadata: FSEntryWriteInput): NormalizedWriteInput {
        const normalizedPath = this.#normalizePath(metadata.path);
        if ( normalizedPath === '/' ) {
            throw new HttpError(400, 'Cannot write to root path');
        }

        const size = Number(metadata.size);
        if ( Number.isNaN(size) || size < 0 ) {
            throw new HttpError(400, 'Invalid file size');
        }

        const metadataRecord = metadata as unknown as Record<string, unknown>;
        const dedupeName = Boolean(
            metadata.dedupeName
            ?? metadataRecord.dedupe_name,
        );

        return {
            userId,
            path: normalizedPath,
            size,
            contentType: metadata.contentType ?? DEFAULT_CONTENT_TYPE,
            checksumSha256: metadata.checksumSha256,
            metadata: metadata.metadata,
            thumbnail: metadata.thumbnail,
            associatedAppId: metadata.associatedAppId,
            overwrite: Boolean(metadata.overwrite),
            dedupeName,
            createMissingParents: Boolean(metadata.createMissingParents),
            immutable: Boolean(metadata.immutable),
            isPublic: metadata.isPublic,
            multipartPartSize: metadata.multipartPartSize,
            bucket: this.#resolveBucket(metadata),
            bucketRegion: this.#resolveBucketRegion(metadata),
        };
    }

    async #findDedupedPath (
        targetPath: string,
        reservedPaths: Set<string>,
        loadExistingEntry: (path: string) => Promise<FSEntry | null>,
    ): Promise<string> {
        const parentPath = pathPosix.dirname(targetPath);
        const extension = pathPosix.extname(targetPath);
        const fileName = pathPosix.basename(targetPath, extension);

        for ( let suffix = 1; suffix < 100_000; suffix++ ) {
            const dedupedPath = pathPosix.join(parentPath, `${fileName} (${suffix})${extension}`);
            if ( reservedPaths.has(dedupedPath) ) {
                continue;
            }
            const existingEntry = await loadExistingEntry(dedupedPath);
            if ( ! existingEntry ) {
                return dedupedPath;
            }
        }

        throw new HttpError(409, 'Unable to resolve deduped file path');
    }

    async #resolveWriteTargets (
        userId: number,
        inputs: WriteTargetResolutionInput[],
    ): Promise<WriteTargetResolutionResult[]> {
        const reservedPaths = new Set<string>();
        const existingEntryCache = new Map<string, Promise<FSEntry | null>>();
        const initialPaths = Array.from(new Set(inputs.map((input) => input.normalizedInput.path)));
        const initialEntries = await this.#fsEntryRepository.getEntriesByPathsForUser(
            userId,
            initialPaths,
            {
                useTryHardRead: true,
                skipCache: true,
            },
        );
        for ( let index = 0; index < initialPaths.length; index++ ) {
            const path = initialPaths[index];
            if ( ! path ) {
                continue;
            }
            existingEntryCache.set(path, Promise.resolve(initialEntries[index] ?? null));
        }

        const loadExistingEntry = async (path: string): Promise<FSEntry | null> => {
            const cachedPromise = existingEntryCache.get(path);
            if ( cachedPromise ) {
                return await cachedPromise;
            }

            const readPromise = this.#fsEntryRepository.getEntryByPathForUser(path, userId, {
                useTryHardRead: true,
                skipCache: true,
            });
            existingEntryCache.set(path, readPromise);
            return await readPromise;
        };

        const results: WriteTargetResolutionResult[] = [];
        for ( const input of inputs ) {
            let normalizedInput = input.normalizedInput;
            let existingEntry = await loadExistingEntry(normalizedInput.path);
            const pathReservedInBatch = reservedPaths.has(normalizedInput.path);

            if ( pathReservedInBatch || existingEntry ) {
                if ( normalizedInput.dedupeName ) {
                    const dedupedPath = await this.#findDedupedPath(
                        normalizedInput.path,
                        reservedPaths,
                        loadExistingEntry,
                    );
                    normalizedInput = {
                        ...normalizedInput,
                        path: dedupedPath,
                    };
                    existingEntry = await loadExistingEntry(dedupedPath);
                } else if ( pathReservedInBatch ) {
                    throw new HttpError(409, `Batch contains duplicate target path: ${normalizedInput.path}`);
                }
            }

            if ( existingEntry && existingEntry.isDir ) {
                throw new HttpError(409, 'Cannot overwrite an existing directory');
            }
            if ( existingEntry && !normalizedInput.overwrite ) {
                throw new HttpError(409, 'A file already exists at this path and overwrite was not requested');
            }

            reservedPaths.add(normalizedInput.path);
            results.push({
                index: input.index,
                normalizedInput,
                existingEntry,
                wasOverwrite: Boolean(existingEntry),
            });
        }

        return results;
    }

    #toCreateInput (normalizedInput: NormalizedWriteInput, objectKey: string): FSEntryCreateInput {
        return {
            userId: normalizedInput.userId,
            uuid: objectKey,
            path: normalizedInput.path,
            size: normalizedInput.size,
            contentType: normalizedInput.contentType,
            checksumSha256: normalizedInput.checksumSha256,
            metadata: normalizedInput.metadata,
            thumbnail: normalizedInput.thumbnail,
            associatedAppId: normalizedInput.associatedAppId,
            overwrite: normalizedInput.overwrite,
            createMissingParents: normalizedInput.createMissingParents,
            immutable: normalizedInput.immutable,
            isPublic: normalizedInput.isPublic,
            multipartPartSize: normalizedInput.multipartPartSize,
            bucket: normalizedInput.bucket,
            bucketRegion: normalizedInput.bucketRegion,
        };
    }

    #determineUploadMode (requestUploadMode: UploadMode | 'auto' | undefined, size: number): UploadMode {
        const maxSingleUploadSize = this.#s3StorageProvider.getMaxSingleUploadSize();
        if ( requestUploadMode === 'multipart' ) {
            return 'multipart';
        }
        if ( requestUploadMode === 'single' ) {
            return size > maxSingleUploadSize ? 'multipart' : 'single';
        }
        return size > maxSingleUploadSize ? 'multipart' : 'single';
    }

    #resolveStorageMax (
        allowanceMax: number,
        storageAllowanceMaxOverride?: number,
    ): number {
        if ( allowanceMax === Number.MAX_SAFE_INTEGER ) {
            return allowanceMax;
        }
        if ( storageAllowanceMaxOverride === undefined ) {
            return allowanceMax;
        }
        if ( !Number.isFinite(storageAllowanceMaxOverride) || storageAllowanceMaxOverride < 0 ) {
            return allowanceMax;
        }
        return Math.max(allowanceMax, storageAllowanceMaxOverride);
    }

    async #assertStorageAllowance (
        userId: number,
        incomingSize: number,
        existingSize = 0,
        storageAllowanceMaxOverride?: number,
    ): Promise<void> {
        const allowance = await this.#fsEntryRepository.getUserStorageAllowance(userId);
        const maxStorage = this.#resolveStorageMax(allowance.max, storageAllowanceMaxOverride);
        if ( maxStorage === Number.MAX_SAFE_INTEGER ) {
            return;
        }

        const projectedUsage = allowance.curr - existingSize + incomingSize;
        if ( projectedUsage > maxStorage ) {
            throw new HttpError(413, 'Storage limit reached');
        }
    }

    async #assertStorageAllowanceForBatch (
        userId: number,
        sizeChanges: Array<{ incomingSize: number; existingSize: number }>,
        storageAllowanceMaxOverride?: number,
    ): Promise<void> {
        if ( sizeChanges.length === 0 ) {
            return;
        }

        const allowance = await this.#fsEntryRepository.getUserStorageAllowance(userId);
        const maxStorage = this.#resolveStorageMax(allowance.max, storageAllowanceMaxOverride);
        if ( maxStorage === Number.MAX_SAFE_INTEGER ) {
            return;
        }

        let projectedUsage = allowance.curr;
        for ( const sizeChange of sizeChanges ) {
            projectedUsage = projectedUsage - sizeChange.existingSize + sizeChange.incomingSize;
        }

        if ( projectedUsage > maxStorage ) {
            throw new HttpError(413, 'Storage limit reached');
        }
    }

    #toErrorMessage (error: unknown): string {
        if ( error instanceof Error ) {
            return error.message;
        }
        return 'Unknown error';
    }

    #toError (error: unknown, fallbackMessage: string): Error {
        if ( error instanceof Error ) {
            return error;
        }
        return new Error(fallbackMessage);
    }

    #toMultipartParts (parts: CompleteWriteRequest['parts']): MultipartCompletePart[] {
        if ( !parts || parts.length === 0 ) {
            return [];
        }
        return parts.map((part) => ({
            partNumber: Number(part.partNumber),
            etag: part.etag,
        }));
    }

    #parseSessionMetadata (session: PendingUploadSession): FSEntryCreateInput {
        if ( ! session.metadataJson ) {
            throw new HttpError(500, 'Upload session metadata is missing');
        }

        const parsedMetadata = JSON.parse(session.metadataJson) as FSEntryCreateInput;
        return {
            ...parsedMetadata,
            userId: session.userId,
            uuid: session.objectKey,
            path: session.targetPath,
            size: session.size,
            contentType: session.contentType,
            checksumSha256: session.checksumSha256 ?? undefined,
            bucket: session.bucket ?? undefined,
            bucketRegion: session.bucketRegion ?? undefined,
            overwrite: Boolean(session.overwriteTargetUid),
        };
    }

    #isBinaryPayload (value: unknown): value is BinaryPayload {
        return Boolean(
            value
            && typeof value === 'object'
            && 'base64' in value
            && typeof (value as BinaryPayload).base64 === 'string',
        );
    }

    #isNodeStream (value: unknown): value is Readable {
        return Boolean(value && typeof value === 'object' && typeof (value as Readable).pipe === 'function');
    }

    #isWebReadableStream (value: unknown): value is ReadableStream {
        return Boolean(value && typeof value === 'object' && typeof (value as ReadableStream).getReader === 'function');
    }

    #createCountingStream (
        source: Readable,
        uploadTracker?: UploadProgressTrackerLike,
    ): { stream: Readable; uploadedSize: () => number; contentHashSha256: () => string } {
        let uploadedBytes = 0;
        const hash = createHash('sha256');
        const countingStream = new Transform({
            transform (chunk: unknown, _encoding: string, callback: TransformCallback) {
                let chunkLength = 0;
                if ( Buffer.isBuffer(chunk) || chunk instanceof Uint8Array ) {
                    chunkLength = chunk.byteLength;
                    hash.update(chunk);
                } else if ( typeof chunk === 'string' ) {
                    chunkLength = Buffer.byteLength(chunk);
                    hash.update(chunk);
                }
                uploadedBytes += chunkLength;
                if ( chunkLength > 0 && uploadTracker ) {
                    uploadTracker.add(chunkLength);
                }
                callback(null, chunk as Buffer | Uint8Array | string);
            },
        });

        source.on('error', (error) => {
            countingStream.destroy(error);
        });
        source.pipe(countingStream);

        return {
            stream: countingStream,
            uploadedSize: () => uploadedBytes,
            contentHashSha256: () => hash.digest('hex'),
        };
    }

    async #toUploadBody (
        content: WriteRequest['fileContent'],
        encoding: WriteRequest['encoding'],
        uploadTracker?: UploadProgressTrackerLike,
    ): Promise<UploadPayload> {
        if ( Buffer.isBuffer(content) ) {
            const hash = createHash('sha256');
            hash.update(content);
            return {
                body: content,
                contentLength: content.byteLength,
                uploadedSize: () => content.byteLength,
                contentHashSha256: hash.digest('hex'),
            };
        }
        if ( this.#isBinaryPayload(content) ) {
            const buffer = Buffer.from(content.base64, 'base64');
            const hash = createHash('sha256');
            hash.update(buffer);
            return {
                body: buffer,
                contentLength: buffer.byteLength,
                uploadedSize: () => buffer.byteLength,
                contentHashSha256: hash.digest('hex'),
            };
        }
        if ( typeof content === 'string' ) {
            if ( encoding === 'base64' ) {
                const buffer = Buffer.from(content, 'base64');
                const hash = createHash('sha256');
                hash.update(buffer);
                return {
                    body: buffer,
                    contentLength: buffer.byteLength,
                    uploadedSize: () => buffer.byteLength,
                    contentHashSha256: hash.digest('hex'),
                };
            }
            const buffer = Buffer.from(content, encoding ?? 'utf8');
            const hash = createHash('sha256');
            hash.update(buffer);
            return {
                body: buffer,
                contentLength: buffer.byteLength,
                uploadedSize: () => buffer.byteLength,
                contentHashSha256: hash.digest('hex'),
            };
        }
        if ( content instanceof Uint8Array ) {
            const hash = createHash('sha256');
            hash.update(content);
            return {
                body: content,
                contentLength: content.byteLength,
                uploadedSize: () => content.byteLength,
                contentHashSha256: hash.digest('hex'),
            };
        }
        if ( content instanceof ArrayBuffer ) {
            const buffer = Buffer.from(content);
            const hash = createHash('sha256');
            hash.update(buffer);
            return {
                body: buffer,
                contentLength: buffer.byteLength,
                uploadedSize: () => buffer.byteLength,
                contentHashSha256: hash.digest('hex'),
            };
        }
        if ( this.#isNodeStream(content) ) {
            const streamPayload = this.#createCountingStream(content, uploadTracker);
            return {
                body: streamPayload.stream,
                uploadedSize: streamPayload.uploadedSize,
                contentHashSha256: null,
                finalizeContentHashSha256: () => streamPayload.contentHashSha256(),
            };
        }
        if ( this.#isWebReadableStream(content) ) {
            const reader = content.getReader();
            const asyncIterable = {
                async *[Symbol.asyncIterator] (): AsyncGenerator<Uint8Array, void, void> {
                    while ( true ) {
                        const readResult = await reader.read();
                        if ( readResult.done ) {
                            return;
                        }
                        if ( readResult.value ) {
                            yield readResult.value;
                        }
                    }
                },
            };
            const streamPayload = this.#createCountingStream(
                Readable.from(asyncIterable),
                uploadTracker,
            );
            return {
                body: streamPayload.stream,
                uploadedSize: streamPayload.uploadedSize,
                contentHashSha256: null,
                finalizeContentHashSha256: () => streamPayload.contentHashSha256(),
            };
        }
        if ( content instanceof Blob ) {
            const reader = content.stream().getReader();
            const asyncIterable = {
                async *[Symbol.asyncIterator] (): AsyncGenerator<Uint8Array, void, void> {
                    while ( true ) {
                        const readResult = await reader.read();
                        if ( readResult.done ) {
                            return;
                        }
                        if ( readResult.value ) {
                            yield readResult.value;
                        }
                    }
                },
            };
            const streamPayload = this.#createCountingStream(
                Readable.from(asyncIterable),
                uploadTracker,
            );
            return {
                body: streamPayload.stream,
                contentLength: Number.isFinite(content.size) ? content.size : undefined,
                uploadedSize: streamPayload.uploadedSize,
                contentHashSha256: null,
                finalizeContentHashSha256: () => streamPayload.contentHashSha256(),
            };
        }

        throw new HttpError(400, 'Unsupported file content payload');
    }

    async #cleanupPreparedBatchUploads (
        preparedBatch: PreparedBatchWrite,
        uploadedItems: UploadedBatchWriteItem[],
    ): Promise<void> {
        const cleanupTargets = uploadedItems.map((uploadedItem) => {
            const preparedItem = preparedBatch.itemsByIndex.get(uploadedItem.index);
            if ( !preparedItem || preparedItem.wasOverwrite ) {
                return null;
            }

            return {
                bucket: preparedItem.normalizedInput.bucket,
                bucketRegion: preparedItem.normalizedInput.bucketRegion,
                objectKey: uploadedItem.objectKey,
            };
        }).filter((target): target is {
            bucket: string;
            bucketRegion: string;
            objectKey: string;
        } => Boolean(target));

        if ( cleanupTargets.length === 0 ) {
            return;
        }

        const cleanupResults = await Promise.allSettled(cleanupTargets.map((target) => {
            return this.#s3StorageProvider.deleteObject(
                target.bucket,
                target.objectKey,
                target.bucketRegion,
            );
        }));

        const cleanupFailures = cleanupResults.filter((result) => result.status === 'rejected');
        if ( cleanupFailures.length > 0 ) {
            console.error('prodfsv2 failed to clean up batch upload objects', cleanupFailures);
        }
    }

    getMaxSingleUploadSize (): number {
        return this.#s3StorageProvider.getMaxSingleUploadSize();
    }

    async #cleanupSignedMultipartUploads (uploads: SignedMultipartCleanupTarget[]): Promise<void> {
        if ( uploads.length === 0 ) {
            return;
        }

        const cleanupResults = await Promise.allSettled(uploads.map((upload) => {
            if ( upload.signedUploadResult.uploadMode !== 'multipart' || !upload.signedUploadResult.multipartUploadId ) {
                return Promise.resolve();
            }

            return this.#s3StorageProvider.abortMutipartUpload(
                upload.signedUploadResult.multipartUploadId,
                upload.bucketRegion,
                upload.bucket,
                upload.objectKey,
            );
        }));

        const cleanupFailures = cleanupResults.filter((result) => result.status === 'rejected');
        if ( cleanupFailures.length > 0 ) {
            console.error('prodfsv2 failed to abort signed multipart uploads', cleanupFailures);
        }
    }

    #toSignedMultipartCleanupTargets (
        items: Array<{
            index: number;
            normalizedInput: NormalizedWriteInput;
        }>,
        objectKeys: string[],
        signedResultsByIndex: Map<number, SignedUploadResult>,
    ): SignedMultipartCleanupTarget[] {
        return items.map((item, index) => {
            const signedUploadResult = signedResultsByIndex.get(item.index);
            const objectKey = objectKeys[index];
            if ( !signedUploadResult || !objectKey ) {
                return null;
            }

            return {
                bucket: item.normalizedInput.bucket,
                bucketRegion: item.normalizedInput.bucketRegion,
                objectKey,
                signedUploadResult,
            };
        }).filter((upload): upload is SignedMultipartCleanupTarget => Boolean(upload));
    }

    #toSignedWriteResponse (
        sessionId: string,
        normalizedInput: NormalizedWriteInput,
        objectKey: string,
        signedUploadResult: SignedUploadResult,
    ): SignedWriteResponse {
        return {
            sessionId,
            uploadMode: signedUploadResult.uploadMode,
            objectKey,
            bucket: normalizedInput.bucket,
            bucketRegion: normalizedInput.bucketRegion,
            contentType: normalizedInput.contentType,
            expiresAt: signedUploadResult.expiresAt,
            ...(signedUploadResult.url ? { url: signedUploadResult.url } : {}),
            ...(signedUploadResult.multipartUploadId ? { multipartUploadId: signedUploadResult.multipartUploadId } : {}),
            ...(signedUploadResult.multipartPartSize ? { multipartPartSize: signedUploadResult.multipartPartSize } : {}),
            ...(signedUploadResult.multipartPartCount ? { multipartPartCount: signedUploadResult.multipartPartCount } : {}),
            ...(signedUploadResult.multipartPartUrls ? { multipartPartUrls: signedUploadResult.multipartPartUrls } : {}),
        };
    }

    #toDirectorySignedWriteResponse (
        fsEntry: FSEntry,
        directoryCreated: boolean,
    ): SignedWriteResponse {
        return {
            sessionId: '',
            uploadMode: 'single',
            objectKey: fsEntry.uuid,
            bucket: fsEntry.bucket ?? '',
            bucketRegion: fsEntry.bucketRegion ?? '',
            contentType: 'inode/directory',
            expiresAt: Date.now(),
            directoryCreated,
            fsEntry,
        };
    }

    async entryExistsByPath (path: string): Promise<boolean> {
        const entry = await this.#fsEntryRepository.getEntryByPath(path);
        return entry !== null;
    }

    async getAncestorChain (path: string): Promise<Array<{ uid: string; path: string }>> {
        const paths: string[] = [];
        let cursor = this.#normalizePath(path);
        while ( cursor !== '/' ) {
            paths.push(cursor);
            cursor = pathPosix.dirname(cursor);
        }

        const entriesByPath = await this.#fsEntryRepository.getEntriesByPaths(paths);

        const ancestors: Array<{ uid: string; path: string }> = [];
        for ( const p of paths ) {
            const entry = entriesByPath.get(p);
            if ( entry ) {
                ancestors.push({ uid: entry.uid, path: entry.path });
            }
        }
        return ancestors;
    }

    async prepareBatchWrites (
        userId: number,
        writeRequests: BatchWritePrepareRequest[],
        storageAllowanceMax?: number,
    ): Promise<PreparedBatchWrite> {
        if ( writeRequests.length === 0 ) {
            return {
                userId,
                items: [],
                itemsByIndex: new Map(),
                ...(storageAllowanceMax !== undefined ? { storageAllowanceMax } : {}),
            };
        }

        const normalizedRequests = writeRequests.map((writeRequest, index) => {
            const normalizedInput = this.#normalizeWriteInput(userId, writeRequest.fileMetadata);
            const requestedThumbnail = writeRequest.thumbnailData ?? normalizedInput.thumbnail ?? null;
            normalizedInput.thumbnail = null;
            return {
                index,
                normalizedInput,
                requestedThumbnail,
                guiMetadata: writeRequest.guiMetadata,
            };
        });

        const resolvedTargets = await this.#resolveWriteTargets(
            userId,
            normalizedRequests.map((request) => ({
                index: request.index,
                normalizedInput: request.normalizedInput,
            })),
        );
        const resolvedTargetMap = new Map<number, WriteTargetResolutionResult>(
            resolvedTargets.map((resolvedTarget) => [resolvedTarget.index, resolvedTarget]),
        );
        const resolvedRequests = normalizedRequests.map((request) => {
            const resolvedTarget = resolvedTargetMap.get(request.index);
            if ( ! resolvedTarget ) {
                throw new Error(`Failed to resolve write target for index ${request.index}`);
            }
            return {
                ...request,
                normalizedInput: resolvedTarget.normalizedInput,
                existingEntry: resolvedTarget.existingEntry,
                wasOverwrite: resolvedTarget.wasOverwrite,
            };
        });

        await this.#fsEntryRepository.resolveParentDirectoriesBatch(
            userId,
            resolvedRequests.map((item) => ({
                parentPath: pathPosix.dirname(item.normalizedInput.path),
                createPaths: item.normalizedInput.createMissingParents,
            })),
        );

        const items = resolvedRequests.map((item) => ({
            index: item.index,
            normalizedInput: item.normalizedInput,
            existingEntry: item.existingEntry,
            objectKey: item.existingEntry?.uuid ?? uuidv4(),
            wasOverwrite: item.wasOverwrite,
            requestedThumbnail: item.requestedThumbnail,
            guiMetadata: item.guiMetadata,
        }));
        const itemsByIndex = new Map<number, (typeof items)[number]>();
        for ( const item of items ) {
            itemsByIndex.set(item.index, item);
        }

        return {
            userId,
            items,
            itemsByIndex,
            ...(storageAllowanceMax !== undefined ? { storageAllowanceMax } : {}),
        };
    }

    async assertStorageAllowanceForPreparedBatch (
        preparedBatch: PreparedBatchWrite,
        uploadedItems?: UploadedBatchWriteItem[],
        storageAllowanceMaxOverride?: number,
    ): Promise<void> {
        if ( preparedBatch.items.length === 0 ) {
            return;
        }

        const uploadedItemMap = new Map<number, UploadedBatchWriteItem>();
        if ( uploadedItems ) {
            for ( const uploadedItem of uploadedItems ) {
                uploadedItemMap.set(uploadedItem.index, uploadedItem);
            }
        }

        const sizeChanges = preparedBatch.items.map((item) => {
            const uploadedItem = uploadedItemMap.get(item.index);
            return {
                incomingSize: uploadedItem ? uploadedItem.uploadedSize : item.normalizedInput.size,
                existingSize: item.existingEntry?.size ?? 0,
            };
        });

        const storageAllowanceMax = storageAllowanceMaxOverride ?? preparedBatch.storageAllowanceMax;
        await this.#assertStorageAllowanceForBatch(preparedBatch.userId, sizeChanges, storageAllowanceMax);
    }

    async uploadPreparedBatchItem (
        input: UploadPreparedBatchItemInput,
    ): Promise<UploadedBatchWriteItem> {
        const preparedItem = input.preparedBatch.itemsByIndex.get(input.itemIndex);
        if ( ! preparedItem ) {
            throw new HttpError(400, `Batch metadata was not found for index ${input.itemIndex}`);
        }

        const uploadBody = await this.#toUploadBody(
            input.fileContent,
            input.encoding,
            input.uploadTracker,
        );

        await this.#s3StorageProvider.uploadFromServer({
            bucket: preparedItem.normalizedInput.bucket,
            objectKey: preparedItem.objectKey,
            contentType: preparedItem.normalizedInput.contentType,
            body: uploadBody.body,
            ...(uploadBody.contentLength !== undefined ? { contentLength: uploadBody.contentLength } : {}),
            ...(Number.isFinite(preparedItem.normalizedInput.size)
                ? { sizeHint: preparedItem.normalizedInput.size }
                : {}),
        }, preparedItem.normalizedInput.bucketRegion);

        const uploadedSize = uploadBody.uploadedSize();
        if ( input.uploadTracker ) {
            const currentTrackedSize = Number(input.uploadTracker.progress ?? 0);
            if ( uploadedSize > currentTrackedSize ) {
                input.uploadTracker.add(uploadedSize - currentTrackedSize);
            }
        }

        return {
            index: preparedItem.index,
            objectKey: preparedItem.objectKey,
            uploadedSize,
            contentHashSha256: uploadBody.finalizeContentHashSha256
                ? uploadBody.finalizeContentHashSha256()
                : uploadBody.contentHashSha256,
        };
    }

    async finalizePreparedBatchWrites (
        preparedBatch: PreparedBatchWrite,
        uploadedItems: UploadedBatchWriteItem[],
    ): Promise<WriteResponse[]> {
        try {
            if ( preparedBatch.items.length !== uploadedItems.length ) {
                throw new HttpError(400, 'Some batch files were missing upload content');
            }

            await this.assertStorageAllowanceForPreparedBatch(preparedBatch, uploadedItems);

            const uploadedItemMap = new Map<number, UploadedBatchWriteItem>();
            for ( const uploadedItem of uploadedItems ) {
                uploadedItemMap.set(uploadedItem.index, uploadedItem);
            }

            const createInputs = preparedBatch.items.map((item) => {
                const uploadedItem = uploadedItemMap.get(item.index);
                if ( ! uploadedItem ) {
                    throw new HttpError(400, `Missing uploaded file content for index ${item.index}`);
                }
                item.normalizedInput.size = uploadedItem.uploadedSize;
                return this.#toCreateInput(item.normalizedInput, uploadedItem.objectKey);
            });

            const fsEntries = await this.#fsEntryRepository.batchCreateEntries(createInputs, true);
            return preparedBatch.items.map((item, index) => {
                const fsEntry = fsEntries[index];
                if ( ! fsEntry ) {
                    throw new Error(`Failed to resolve batch write result at index ${index}`);
                }
                const uploadedItem = uploadedItemMap.get(item.index);
                return {
                    fsEntry,
                    wasOverwrite: item.wasOverwrite,
                    requestedThumbnail: item.requestedThumbnail,
                    contentHashSha256: uploadedItem?.contentHashSha256 ?? null,
                };
            });
        } catch ( error ) {
            await this.#cleanupPreparedBatchUploads(preparedBatch, uploadedItems);
            throw error;
        }
    }

    async startUrlWrite (
        userId: number,
        signedWriteRequest: SignedWriteRequest,
        storageAllowanceMax?: number,
    ): Promise<SignedWriteResponse> {
        const result = await this.startUrlWriteWithCreatedDirectories(
            userId,
            signedWriteRequest,
            storageAllowanceMax,
        );
        return result.response;
    }

    async startUrlWriteWithCreatedDirectories (
        userId: number,
        signedWriteRequest: SignedWriteRequest,
        storageAllowanceMax?: number,
    ): Promise<StartSignedWriteResult> {
        let normalizedInput = this.#normalizeWriteInput(userId, signedWriteRequest.fileMetadata);
        if ( signedWriteRequest.directory ) {
            const {
                entries,
                createdDirectoryEntries,
            } = await this.#fsEntryRepository.ensureDirectoriesForUserWithCreated(
                userId,
                [{
                    path: normalizedInput.path,
                    createPaths: normalizedInput.createMissingParents,
                }],
            );
            const [directoryEntry] = entries;
            if ( ! directoryEntry ) {
                throw new Error('Failed to resolve directory entry after start write');
            }
            const createdDirectoryPathSet = new Set(createdDirectoryEntries.map((entry) => entry.path));
            return {
                response: this.#toDirectorySignedWriteResponse(
                    directoryEntry,
                    createdDirectoryPathSet.has(normalizedInput.path),
                ),
                createdDirectoryEntries,
            };
        }

        const [resolvedTarget] = await this.#resolveWriteTargets(userId, [{
            index: 0,
            normalizedInput,
        }]);
        if ( ! resolvedTarget ) {
            throw new Error('Failed to resolve write target');
        }
        normalizedInput = resolvedTarget.normalizedInput;
        const existingEntry = resolvedTarget.existingEntry;

        const existingSize = existingEntry?.size ?? 0;
        const parentPath = pathPosix.dirname(normalizedInput.path);
        const [, {
            parentEntries,
            createdDirectoryEntries,
        }] = await Promise.all([
            this.#assertStorageAllowance(userId, normalizedInput.size, existingSize, storageAllowanceMax),
            this.#fsEntryRepository.resolveParentDirectoriesBatchWithCreated(
                userId,
                [{
                    parentPath,
                    createPaths: normalizedInput.createMissingParents,
                }],
            ),
        ]);
        const [parentEntry] = parentEntries;
        if ( ! parentEntry ) {
            throw new Error('Failed to resolve parent directory for signed write');
        }

        const objectKey = existingEntry?.uuid ?? uuidv4();
        const uploadMode = this.#determineUploadMode(signedWriteRequest.uploadMode, normalizedInput.size);
        const expiresInSeconds = signedWriteRequest.expiresInSeconds ?? DEFAULT_SIGNED_UPLOAD_EXPIRY_SECONDS;
        const createInput = this.#toCreateInput(normalizedInput, objectKey);

        const signedUploadResult = await this.#s3StorageProvider.createSignedUploadUrl({
            bucket: normalizedInput.bucket,
            objectKey,
            size: normalizedInput.size,
            contentType: normalizedInput.contentType,
            uploadMode,
            expiresInSeconds,
            multipartPartSize: normalizedInput.multipartPartSize,
        }, normalizedInput.bucketRegion);

        const sessionId = uuidv4();
        const pendingUploadInput: PendingUploadCreateInput = {
            sessionId,
            userId,
            appId: normalizedInput.associatedAppId ?? null,
            parentUid: parentEntry.uuid,
            parentPath: parentEntry.path,
            targetName: pathPosix.basename(normalizedInput.path),
            targetPath: normalizedInput.path,
            overwriteTargetUid: existingEntry?.uuid ?? null,
            contentType: normalizedInput.contentType,
            size: normalizedInput.size,
            checksumSha256: normalizedInput.checksumSha256 ?? null,
            uploadMode,
            multipartUploadId: signedUploadResult.multipartUploadId ?? null,
            multipartPartSize: signedUploadResult.multipartPartSize ?? null,
            multipartPartCount: signedUploadResult.multipartPartCount ?? null,
            storageProvider: 's3',
            bucket: normalizedInput.bucket,
            bucketRegion: normalizedInput.bucketRegion,
            objectKey,
            metadataJson: JSON.stringify(createInput),
            expiresAt: signedUploadResult.expiresAt,
        };

        try {
            await this.#fsEntryRepository.createPendingEntry(pendingUploadInput);
        } catch ( error ) {
            await this.#cleanupSignedMultipartUploads([{
                bucket: normalizedInput.bucket,
                bucketRegion: normalizedInput.bucketRegion,
                objectKey,
                signedUploadResult,
            }]);
            throw error;
        }

        return {
            response: this.#toSignedWriteResponse(sessionId, normalizedInput, objectKey, signedUploadResult),
            createdDirectoryEntries,
        };
    }

    async batchStartUrlWrites (
        userId: number,
        signedWriteRequests: SignedWriteRequest[],
        storageAllowanceMax?: number,
    ): Promise<SignedWriteResponse[]> {
        const result = await this.batchStartUrlWritesWithCreatedDirectories(
            userId,
            signedWriteRequests,
            storageAllowanceMax,
        );
        return result.responses;
    }

    async batchStartUrlWritesWithCreatedDirectories (
        userId: number,
        signedWriteRequests: SignedWriteRequest[],
        storageAllowanceMax?: number,
    ): Promise<BatchStartSignedWriteResult> {
        if ( signedWriteRequests.length === 0 ) {
            return {
                responses: [],
                createdDirectoryEntries: [],
            };
        }

        const normalizedRequests = signedWriteRequests.map((signedWriteRequest, index) => ({
            index,
            request: signedWriteRequest,
            isDirectory: Boolean(signedWriteRequest.directory),
            normalizedInput: this.#normalizeWriteInput(userId, signedWriteRequest.fileMetadata),
        }));
        const responsesByIndex = new Map<number, SignedWriteResponse>();
        const createdDirectoryEntriesByPath = new Map<string, FSEntry>();

        const directoryItems = normalizedRequests.filter((item) => item.isDirectory);
        const directoryPathSet = new Set<string>();
        for ( const directoryItem of directoryItems ) {
            const targetPath = directoryItem.normalizedInput.path;
            if ( directoryPathSet.has(targetPath) ) {
                throw new HttpError(409, `Batch contains duplicate target path: ${targetPath}`);
            }
            directoryPathSet.add(targetPath);
        }
        if ( directoryItems.length > 0 ) {
            const {
                entries: ensuredDirectoryEntries,
                createdDirectoryEntries,
            } = await this.#fsEntryRepository.ensureDirectoriesForUserWithCreated(
                userId,
                directoryItems.map((item) => ({
                    path: item.normalizedInput.path,
                    createPaths: item.normalizedInput.createMissingParents,
                })),
            );
            for ( const createdDirectoryEntry of createdDirectoryEntries ) {
                createdDirectoryEntriesByPath.set(createdDirectoryEntry.path, createdDirectoryEntry);
            }

            for ( let index = 0; index < directoryItems.length; index++ ) {
                const item = directoryItems[index];
                const directoryEntry = ensuredDirectoryEntries[index];
                if ( !item || !directoryEntry ) {
                    throw new Error('Failed to build directory response from batch start data');
                }
                responsesByIndex.set(
                    item.index,
                    this.#toDirectorySignedWriteResponse(
                        directoryEntry,
                        createdDirectoryEntriesByPath.has(item.normalizedInput.path),
                    ),
                );
            }
        }

        const fileItems = normalizedRequests.filter((item) => !item.isDirectory);
        if ( fileItems.length > 0 ) {
            const resolvedTargets = await this.#resolveWriteTargets(
                userId,
                fileItems.map((item) => ({
                    index: item.index,
                    normalizedInput: item.normalizedInput,
                })),
            );
            const resolvedTargetMap = new Map<number, WriteTargetResolutionResult>(
                resolvedTargets.map((resolvedTarget) => [resolvedTarget.index, resolvedTarget]),
            );
            const resolvedFileItems = fileItems.map((item) => {
                const resolvedTarget = resolvedTargetMap.get(item.index);
                if ( ! resolvedTarget ) {
                    throw new Error(`Failed to resolve write target for batch index ${item.index}`);
                }

                return {
                    ...item,
                    normalizedInput: resolvedTarget.normalizedInput,
                    existingEntry: resolvedTarget.existingEntry,
                };
            });

            const allowanceChecks: Array<{ incomingSize: number; existingSize: number }> = [];
            for ( const item of resolvedFileItems ) {
                allowanceChecks.push({
                    incomingSize: item.normalizedInput.size,
                    existingSize: item.existingEntry?.size ?? 0,
                });
            }
            const [, {
                parentEntries,
                createdDirectoryEntries: createdParentDirectoryEntries,
            }] = await Promise.all([
                this.#assertStorageAllowanceForBatch(userId, allowanceChecks, storageAllowanceMax),
                this.#fsEntryRepository.resolveParentDirectoriesBatchWithCreated(
                    userId,
                    resolvedFileItems.map((item) => ({
                        parentPath: pathPosix.dirname(item.normalizedInput.path),
                        createPaths: item.normalizedInput.createMissingParents,
                    })),
                ),
            ]);
            for ( const createdParentDirectoryEntry of createdParentDirectoryEntries ) {
                createdDirectoryEntriesByPath.set(createdParentDirectoryEntry.path, createdParentDirectoryEntry);
            }

            const objectKeys = resolvedFileItems.map((item) => {
                return item.existingEntry?.uuid ?? uuidv4();
            });
            const uploadModes = resolvedFileItems.map((item) => {
                return this.#determineUploadMode(item.request.uploadMode, item.normalizedInput.size);
            });
            const sessionIds = resolvedFileItems.map(() => uuidv4());

            const signedResultsByIndex = new Map<number, SignedUploadResult>();
            const writesByRegion = new Map<string, Array<{ requestIndex: number;
                input: {
                    bucket: string;
                    objectKey: string;
                    size: number;
                    contentType: string;
                    uploadMode: UploadMode;
                    expiresInSeconds: number;
                    multipartPartSize?: number;
                } }>>();
            for ( let index = 0; index < resolvedFileItems.length; index++ ) {
                const item = resolvedFileItems[index];
                const objectKey = objectKeys[index];
                const uploadMode = uploadModes[index];
                if ( !item || !objectKey || !uploadMode ) {
                    throw new Error('Failed to build batch signed upload request');
                }
                const regionEntries = writesByRegion.get(item.normalizedInput.bucketRegion) ?? [];
                regionEntries.push({
                    requestIndex: item.index,
                    input: {
                        bucket: item.normalizedInput.bucket,
                        objectKey,
                        size: item.normalizedInput.size,
                        contentType: item.normalizedInput.contentType,
                        uploadMode,
                        expiresInSeconds: item.request.expiresInSeconds ?? DEFAULT_SIGNED_UPLOAD_EXPIRY_SECONDS,
                        multipartPartSize: item.normalizedInput.multipartPartSize,
                    },
                });
                writesByRegion.set(item.normalizedInput.bucketRegion, regionEntries);
            }

            const regionResults = await Promise.allSettled(Array.from(writesByRegion.entries()).map(async ([region, regionWrites]) => {
                const signedResults = await this.#s3StorageProvider.batchCreateSignedUploadUrls(
                    regionWrites.map((item) => item.input),
                    region,
                );
                for ( let index = 0; index < regionWrites.length; index++ ) {
                    const regionWrite = regionWrites[index];
                    const signedResult = signedResults[index];
                    if ( !regionWrite || !signedResult ) {
                        throw new Error('Failed to map signed upload result to request');
                    }
                    signedResultsByIndex.set(regionWrite.requestIndex, signedResult);
                }
            }));
            const signedMultipartCleanupTargets = this.#toSignedMultipartCleanupTargets(
                resolvedFileItems,
                objectKeys,
                signedResultsByIndex,
            );

            const failedRegionResult = regionResults.find((result) => result.status === 'rejected');
            if ( failedRegionResult?.status === 'rejected' ) {
                await this.#cleanupSignedMultipartUploads(signedMultipartCleanupTargets);

                throw this.#toError(failedRegionResult.reason, 'Failed to create batch signed upload urls');
            }

            try {
                const pendingInputs: PendingUploadCreateInput[] = [];
                for ( let index = 0; index < resolvedFileItems.length; index++ ) {
                    const item = resolvedFileItems[index];
                    const parentEntry = parentEntries[index];
                    const objectKey = objectKeys[index];
                    const sessionId = sessionIds[index];
                    const uploadMode = uploadModes[index];
                    const existingEntry = item?.existingEntry;
                    if ( !item || !parentEntry || !objectKey || !sessionId || !uploadMode ) {
                        throw new Error('Failed to build pending upload input from batch start data');
                    }
                    const signedUploadResult = signedResultsByIndex.get(item.index);
                    if ( ! signedUploadResult ) {
                        throw new Error('Failed to resolve signed upload result for batch start data');
                    }

                    const createInput = this.#toCreateInput(item.normalizedInput, objectKey);
                    pendingInputs.push({
                        sessionId,
                        userId,
                        appId: item.normalizedInput.associatedAppId ?? null,
                        parentUid: parentEntry.uuid,
                        parentPath: parentEntry.path,
                        targetName: pathPosix.basename(item.normalizedInput.path),
                        targetPath: item.normalizedInput.path,
                        overwriteTargetUid: existingEntry?.uuid ?? null,
                        contentType: item.normalizedInput.contentType,
                        size: item.normalizedInput.size,
                        checksumSha256: item.normalizedInput.checksumSha256 ?? null,
                        uploadMode,
                        multipartUploadId: signedUploadResult.multipartUploadId ?? null,
                        multipartPartSize: signedUploadResult.multipartPartSize ?? null,
                        multipartPartCount: signedUploadResult.multipartPartCount ?? null,
                        storageProvider: 's3',
                        bucket: item.normalizedInput.bucket,
                        bucketRegion: item.normalizedInput.bucketRegion,
                        objectKey,
                        metadataJson: JSON.stringify(createInput),
                        expiresAt: signedUploadResult.expiresAt,
                    });
                }

                await this.#fsEntryRepository.batchCreatePendingEntries(pendingInputs);

                for ( let index = 0; index < resolvedFileItems.length; index++ ) {
                    const item = resolvedFileItems[index];
                    const sessionId = sessionIds[index];
                    const objectKey = objectKeys[index];
                    if ( !item || !sessionId || !objectKey ) {
                        throw new Error('Failed to build signed write response from batch start data');
                    }
                    const signedUploadResult = signedResultsByIndex.get(item.index);
                    if ( ! signedUploadResult ) {
                        throw new Error('Failed to resolve signed upload result for batch response data');
                    }
                    responsesByIndex.set(item.index, this.#toSignedWriteResponse(
                        sessionId,
                        item.normalizedInput,
                        objectKey,
                        signedUploadResult,
                    ));
                }
            } catch ( error ) {
                await this.#cleanupSignedMultipartUploads(signedMultipartCleanupTargets);
                throw error;
            }
        }

        const responses = normalizedRequests.map((request) => {
            const response = responsesByIndex.get(request.index);
            if ( ! response ) {
                throw new Error(`Failed to resolve signed batch response for index ${request.index}`);
            }
            return response;
        });
        return {
            responses,
            createdDirectoryEntries: Array.from(createdDirectoryEntriesByPath.values()),
        };
    }

    async signMultipartParts (
        userId: number,
        request: SignMultipartPartsRequest,
    ): Promise<SignMultipartPartsResponse> {
        if ( ! request?.uploadId ) {
            throw new HttpError(400, 'Missing uploadId');
        }
        if ( !Array.isArray(request.partNumbers) || request.partNumbers.length === 0 ) {
            throw new HttpError(400, 'Missing partNumbers');
        }

        const uniquePartNumbers = Array.from(new Set(request.partNumbers.map((value) => Number(value))));
        if ( uniquePartNumbers.some((partNumber) => !Number.isInteger(partNumber) || partNumber <= 0) ) {
            throw new HttpError(400, 'Invalid partNumbers');
        }

        const session = await this.#fsEntryRepository.getPendingEntryBySessionId(request.uploadId);
        if ( ! session ) {
            throw new HttpError(404, 'Upload session was not found');
        }
        if ( session.userId !== userId ) {
            throw new HttpError(403, 'Upload session access denied');
        }
        if ( session.status !== 'pending' ) {
            throw new HttpError(409, `Upload session is not pending (status=${session.status})`);
        }
        if ( session.expiresAt < Date.now() ) {
            await this.#fsEntryRepository.markPendingEntryFailed(session.sessionId, 'Upload session expired');
            throw new HttpError(400, 'Upload session expired');
        }
        if ( session.uploadMode !== 'multipart' ) {
            throw new HttpError(400, 'Upload session is not multipart');
        }
        if ( ! session.multipartUploadId ) {
            throw new HttpError(400, 'Multipart upload id missing from session');
        }
        const multipartPartCount = session.multipartPartCount;
        if (
            multipartPartCount !== null
            && uniquePartNumbers.some((partNumber) => partNumber > multipartPartCount)
        ) {
            throw new HttpError(400, 'Part number exceeds multipart part count');
        }
        if ( !session.bucket || !session.bucketRegion ) {
            throw new HttpError(500, 'Upload session storage metadata is missing');
        }

        const expiresInSeconds = request.expiresInSeconds ?? DEFAULT_SIGNED_UPLOAD_EXPIRY_SECONDS;
        const multipartPartUrls = await this.#s3StorageProvider.createSignedMultipartPartUrls({
            bucket: session.bucket,
            objectKey: session.objectKey,
            multipartUploadId: session.multipartUploadId,
            partNumbers: uniquePartNumbers,
            expiresInSeconds,
        }, session.bucketRegion);

        const expiresAt = Date.now() + Math.max(60, Math.min(60 * 60, expiresInSeconds)) * 1000;

        return {
            uploadId: session.sessionId,
            multipartUploadId: session.multipartUploadId,
            objectKey: session.objectKey,
            bucket: session.bucket,
            bucketRegion: session.bucketRegion,
            expiresAt,
            multipartPartUrls,
        };
    }

    async completeUrlWrite (userId: number, completeWriteRequest: CompleteWriteRequest): Promise<CompleteWriteResponse> {
        const session = await this.#fsEntryRepository.getPendingEntryBySessionId(completeWriteRequest.uploadId);
        if ( ! session ) {
            throw new HttpError(404, 'Upload session was not found');
        }
        if ( session.userId !== userId ) {
            throw new HttpError(403, 'Upload session access denied');
        }
        if ( session.status !== 'pending' ) {
            throw new HttpError(409, `Upload session is not pending (status=${session.status})`);
        }
        if ( session.expiresAt < Date.now() ) {
            await this.#fsEntryRepository.markPendingEntryFailed(session.sessionId, 'Upload session expired');
            throw new HttpError(400, 'Upload session expired');
        }

        const createInput = this.#parseSessionMetadata(session);
        const requestedThumbnail = completeWriteRequest.thumbnailData ?? createInput.thumbnail ?? null;
        createInput.thumbnail = null;

        try {
            if ( session.uploadMode === 'multipart' ) {
                if ( ! session.multipartUploadId ) {
                    throw new HttpError(400, 'Multipart upload id missing from session');
                }

                const completeParts = this.#toMultipartParts(completeWriteRequest.parts);
                if ( completeParts.length === 0 ) {
                    throw new HttpError(400, 'Multipart upload completion requires parts');
                }

                await this.#s3StorageProvider.completeMultipartUpload({
                    bucket: session.bucket ?? createInput.bucket ?? this.#resolveBucket(createInput),
                    objectKey: session.objectKey,
                    multipartUploadId: session.multipartUploadId,
                    parts: completeParts,
                }, session.bucketRegion ?? createInput.bucketRegion ?? this.#resolveBucketRegion(createInput));
            }

            const fsEntry = await this.#fsEntryRepository.completePendingEntry(session.sessionId, createInput);
            return {
                sessionId: session.sessionId,
                fsEntry,
                wasOverwrite: Boolean(session.overwriteTargetUid),
                requestedThumbnail,
            };
        } catch ( error ) {
            await this.#fsEntryRepository.markPendingEntryFailed(
                session.sessionId,
                error instanceof Error ? error.message : 'Unknown error while completing upload',
            );
            throw error;
        }
    }

    async batchCompleteUrlWrite (
        userId: number,
        completeWriteRequests: CompleteWriteRequest[],
    ): Promise<CompleteWriteResponse[]> {
        if ( completeWriteRequests.length === 0 ) {
            return [];
        }

        const uploadIds = completeWriteRequests.map((request) => request.uploadId);
        const uniqueUploadIds = new Set(uploadIds);
        if ( uniqueUploadIds.size !== uploadIds.length ) {
            throw new HttpError(409, 'Batch contains duplicate upload session ids');
        }

        const sessions = await this.#fsEntryRepository.getPendingEntriesBySessionIds(uploadIds);
        const completionItems: Array<{
            index: number;
            request: CompleteWriteRequest;
            session: PendingUploadSession;
            finalData: FSEntryCreateInput;
            requestedThumbnail: string | null | undefined;
        }> = [];
        const expiredSessionIds: string[] = [];

        for ( let index = 0; index < completeWriteRequests.length; index++ ) {
            const request = completeWriteRequests[index];
            const session = sessions[index];
            if ( !request || !session ) {
                throw new HttpError(404, 'Upload session was not found');
            }
            if ( session.userId !== userId ) {
                throw new HttpError(403, 'Upload session access denied');
            }
            if ( session.status !== 'pending' ) {
                throw new HttpError(409, `Upload session is not pending (status=${session.status})`);
            }
            if ( session.expiresAt < Date.now() ) {
                expiredSessionIds.push(session.sessionId);
                continue;
            }

            const finalData = this.#parseSessionMetadata(session);
            const requestedThumbnail = request.thumbnailData ?? finalData.thumbnail ?? null;
            finalData.thumbnail = null;
            completionItems.push({
                index,
                request,
                session,
                finalData,
                requestedThumbnail,
            });
        }

        if ( expiredSessionIds.length > 0 ) {
            await this.#fsEntryRepository.markPendingEntriesFailed(expiredSessionIds, 'Upload session expired');
            throw new HttpError(400, 'Upload session expired');
        }

        const multipartItems = completionItems.filter((item) => item.session.uploadMode === 'multipart');
        const multipartCompletions = await Promise.allSettled(multipartItems.map(async (item) => {
            if ( ! item.session.multipartUploadId ) {
                throw new HttpError(400, 'Multipart upload id missing from session');
            }

            const completeParts = this.#toMultipartParts(item.request.parts);
            if ( completeParts.length === 0 ) {
                throw new HttpError(400, 'Multipart upload completion requires parts');
            }

            await this.#s3StorageProvider.completeMultipartUpload({
                bucket: item.session.bucket ?? item.finalData.bucket ?? this.#resolveBucket(item.finalData),
                objectKey: item.session.objectKey,
                multipartUploadId: item.session.multipartUploadId,
                parts: completeParts,
            }, item.session.bucketRegion ?? item.finalData.bucketRegion ?? this.#resolveBucketRegion(item.finalData));
        }));

        const failedMultipartItems: Array<{ sessionId: string; reason: unknown }> = [];
        for ( let index = 0; index < multipartCompletions.length; index++ ) {
            const completion = multipartCompletions[index];
            const multipartItem = multipartItems[index];
            if ( completion?.status === 'rejected' && multipartItem ) {
                failedMultipartItems.push({
                    sessionId: multipartItem.session.sessionId,
                    reason: completion.reason,
                });
            }
        }

        if ( failedMultipartItems.length > 0 ) {
            await Promise.all(failedMultipartItems.map((item) => {
                return this.#fsEntryRepository.markPendingEntryFailed(item.sessionId, this.#toErrorMessage(item.reason));
            }));

            const firstReason = failedMultipartItems[0]?.reason;
            if ( firstReason instanceof HttpError ) {
                throw firstReason;
            }
            if ( firstReason instanceof Error ) {
                throw firstReason;
            }
            throw new Error('Failed to complete multipart upload');
        }

        const completedEntries = await this.#fsEntryRepository.batchCompletePendingEntries(
            completionItems.map((item) => ({
                sessionId: item.session.sessionId,
                finalData: item.finalData,
            })),
        );

        const responseByIndex = new Map<number, CompleteWriteResponse>();
        for ( let index = 0; index < completionItems.length; index++ ) {
            const completionItem = completionItems[index];
            const completedEntry = completedEntries[index];
            if ( !completionItem || !completedEntry ) {
                throw new Error('Failed to build completed batch write response');
            }

            responseByIndex.set(completionItem.index, {
                sessionId: completionItem.session.sessionId,
                fsEntry: completedEntry,
                wasOverwrite: Boolean(completionItem.session.overwriteTargetUid),
                requestedThumbnail: completionItem.requestedThumbnail,
            });
        }

        const response: CompleteWriteResponse[] = [];
        for ( let index = 0; index < completeWriteRequests.length; index++ ) {
            const result = responseByIndex.get(index);
            if ( ! result ) {
                throw new Error(`Failed to resolve completed batch response for index ${index}`);
            }
            response.push(result);
        }
        return response;
    }

    async abortUrlWrite (userId: number, uploadId: string): Promise<void> {
        const session = await this.#fsEntryRepository.getPendingEntryBySessionId(uploadId);
        if ( ! session ) {
            return;
        }
        if ( session.userId !== userId ) {
            throw new HttpError(403, 'Upload session access denied');
        }

        try {
            const bucket = session.bucket;
            const bucketRegion = session.bucketRegion;
            if ( bucket && bucketRegion ) {
                if ( session.uploadMode === 'multipart' && session.multipartUploadId ) {
                    await this.#s3StorageProvider.abortMutipartUpload(
                        session.multipartUploadId,
                        bucketRegion,
                        bucket,
                        session.objectKey,
                    );
                } else {
                    await this.#s3StorageProvider.deleteObject(bucket, session.objectKey, bucketRegion);
                }
            }
        } finally {
            await this.#fsEntryRepository.abortPendingEntry(session.sessionId, 'Upload aborted by caller');
        }
    }

    async write (
        userId: number,
        writeRequest: WriteRequest,
        uploadTracker?: UploadProgressTrackerLike,
        storageAllowanceMax?: number,
    ): Promise<WriteResponse> {

        let normalizedInput = this.#normalizeWriteInput(userId, writeRequest.fileMetadata);
        const [resolvedTarget] = await this.#resolveWriteTargets(userId, [{
            index: 0,
            normalizedInput,
        }]);
        if ( ! resolvedTarget ) {
            throw new Error('Failed to resolve write target');
        }
        normalizedInput = resolvedTarget.normalizedInput;
        const existingEntry = resolvedTarget.existingEntry;
        const requestedThumbnail = writeRequest.thumbnailData ?? normalizedInput.thumbnail ?? null;
        normalizedInput.thumbnail = null;

        const existingSize = existingEntry?.size ?? 0;
        await this.#assertStorageAllowance(userId, normalizedInput.size, existingSize, storageAllowanceMax);

        const uploadBody = await this.#toUploadBody(
            writeRequest.fileContent,
            writeRequest.encoding,
            uploadTracker,
        );
        const objectKey = existingEntry?.uuid ?? uuidv4();
        await this.#s3StorageProvider.uploadFromServer({
            bucket: normalizedInput.bucket,
            objectKey,
            contentType: normalizedInput.contentType,
            body: uploadBody.body,
            ...(uploadBody.contentLength !== undefined ? { contentLength: uploadBody.contentLength } : {}),
            ...(Number.isFinite(normalizedInput.size)
                ? { sizeHint: normalizedInput.size }
                : {}),
        }, normalizedInput.bucketRegion);

        const uploadedSize = uploadBody.uploadedSize();
        if ( uploadTracker ) {
            const currentTrackedSize = Number(uploadTracker.progress ?? 0);
            if ( uploadedSize > currentTrackedSize ) {
                uploadTracker.add(uploadedSize - currentTrackedSize);
            }
        }
        if ( uploadedSize > normalizedInput.size ) {
            await this.#assertStorageAllowance(userId, uploadedSize, existingSize, storageAllowanceMax);
        }
        normalizedInput.size = uploadedSize;
        const contentHashSha256 = uploadBody.finalizeContentHashSha256
            ? uploadBody.finalizeContentHashSha256()
            : uploadBody.contentHashSha256;

        const createInput = this.#toCreateInput(normalizedInput, objectKey);
        const fsEntry = await this.#fsEntryRepository.createEntry(
            createInput,
            normalizedInput.createMissingParents,
        );

        return {
            fsEntry,
            wasOverwrite: Boolean(existingEntry),
            requestedThumbnail,
            contentHashSha256,
        };
    }

    async batchWrites (
        userId: number,
        writeRequests: WriteRequest[],
        storageAllowanceMax?: number,
    ): Promise<WriteResponse[]> {
        if ( writeRequests.length === 0 ) {
            return [];
        }
        const preparedBatch = await this.prepareBatchWrites(
            userId,
            writeRequests.map((writeRequest) => ({
                fileMetadata: writeRequest.fileMetadata,
                thumbnailData: writeRequest.thumbnailData,
                guiMetadata: writeRequest.guiMetadata,
            })),
            storageAllowanceMax,
        );
        await this.assertStorageAllowanceForPreparedBatch(preparedBatch, undefined, storageAllowanceMax);

        const uploadResults = await runWithConcurrencyLimitSettled(
            writeRequests,
            8,
            async (writeRequest, index) => {
                return this.uploadPreparedBatchItem({
                    preparedBatch,
                    itemIndex: index,
                    fileContent: writeRequest.fileContent,
                    encoding: writeRequest.encoding,
                });
            },
        );
        const uploadedItems = uploadResults
            .filter((result): result is PromiseFulfilledResult<UploadedBatchWriteItem> => result.status === 'fulfilled')
            .map((result) => result.value);
        const failedUpload = uploadResults.find((result) => result.status === 'rejected');
        if ( failedUpload?.status === 'rejected' ) {
            await this.#cleanupPreparedBatchUploads(preparedBatch, uploadedItems);
            throw this.#toError(failedUpload.reason, 'Failed to upload batch write item');
        }

        return this.finalizePreparedBatchWrites(preparedBatch, uploadedItems);
    }

    async cleanupPreparedBatchUploads (
        preparedBatch: PreparedBatchWrite,
        uploadedItems: UploadedBatchWriteItem[],
    ): Promise<void> {
        await this.#cleanupPreparedBatchUploads(preparedBatch, uploadedItems);
    }

    async updateEntryThumbnail (
        userId: number,
        entryUuid: string,
        thumbnail: string | null,
    ): Promise<FSEntry> {
        if ( typeof entryUuid !== 'string' || entryUuid.length === 0 ) {
            throw new HttpError(400, 'Invalid file entry identifier for thumbnail update');
        }

        return this.#fsEntryRepository.updateEntryThumbnailByUuidForUser(
            userId,
            entryUuid,
            thumbnail,
        );
    }

    async getUsersStorageAllowance (userId: string | number): Promise<{ curr: number; max: number }> {
        const numericUserId = typeof userId === 'string' ? Number(userId) : userId;
        if ( Number.isNaN(numericUserId) ) {
            throw new HttpError(400, 'Invalid user id');
        }
        return this.#fsEntryRepository.getUserStorageAllowance(numericUserId);
    }

    // ── Public repository accessors ─────────────────────────────────────
    //
    // A few controllers (notably the legacy FS shims) need repository reads
    // without duplicating the full service method wrapper. Expose a getter
    // rather than threading the repo separately.
    get entryRepository (): FSEntryRepository {
        return this.#fsEntryRepository;
    }

    get storageProvider (): S3StorageProvider {
        return this.#s3StorageProvider;
    }

    // ── Reads ───────────────────────────────────────────────────────────

    /**
     * List direct children of a directory. Caller is responsible for any ACL
     * check on the parent (usually 'list' mode). Returns entries in the
     * requested sort order.
     */
    async listDirectory (parentUid: string, options: {
        limit?: number;
        offset?: number;
        sortBy?: 'name' | 'modified' | 'type' | 'size' | null;
        sortOrder?: 'asc' | 'desc' | null;
    } = {}): Promise<FSEntry[]> {
        return this.#fsEntryRepository.listChildren(parentUid, options);
    }

    /**
     * Search by file name for a user. Linear-scan with LIKE — cheap for
     * typical library sizes, revisit if we need full-text.
     */
    async searchByName (userId: number, query: string, limit = 200): Promise<FSEntry[]> {
        return this.#fsEntryRepository.searchByNameForUser(userId, query, limit);
    }

    /**
     * Recursively compute total byte size under a directory. Called on demand
     * from `stat` when the client asks for `size: true`. See the repository
     * method for the perf caveat — this is O(descendants) and should get a
     * materialized counter eventually.
     */
    async getSubtreeSize (userId: number, path: string): Promise<number> {
        return this.#fsEntryRepository.getSubtreeSize(userId, path);
    }

    /**
     * Stream bytes of a file entry from S3. The returned stream is a Node
     * Readable; caller pipes it into the HTTP response and emits metering
     * once the stream ends. Honours HTTP Range when provided.
     *
     * Throws 400 if the entry isn't a file, 500 if the entry has no backing
     * bucket (should never happen for real files).
     */
    async readContent (entry: FSEntry, options: { range?: string } = {}): Promise<{
        body: Readable;
        contentLength: number | null;
        contentType: string | null;
        contentRange: string | null;
        etag: string | null;
        lastModified: Date | null;
    }> {
        if ( entry.isDir ) {
            throw new HttpError(400, 'Cannot read content of a directory');
        }
        if ( entry.isSymlink || entry.isShortcut ) {
            // Caller should resolve the link target before calling readContent.
            throw new HttpError(400, 'Cannot read content of a symlink or shortcut directly');
        }
        if ( ! entry.bucket || ! entry.bucketRegion ) {
            throw new HttpError(500, 'Entry has no backing storage');
        }

        // Derive the S3 object key from entry metadata if present, else fall
        // back to the uuid convention used elsewhere (objectKey defaults to
        // uuid during write when no metadata override is set).
        const objectKey = this.#deriveObjectKeyFromEntry(entry);
        return this.#s3StorageProvider.getObjectStream(
            { bucket: entry.bucket, objectKey, range: options.range },
            entry.bucketRegion,
        );
    }

    // Objects written by fsv2 use the pending-session's objectKey, which is
    // persisted in FSEntry.metadata JSON under `objectKey`. Falls back to the
    // entry uuid for entries that didn't record it (older data).
    #deriveObjectKeyFromEntry (entry: FSEntry): string {
        if ( entry.metadata ) {
            try {
                const parsed = JSON.parse(entry.metadata);
                if ( parsed && typeof parsed.objectKey === 'string' && parsed.objectKey.length > 0 ) {
                    return parsed.objectKey;
                }
            } catch {
                // Not JSON — fall through.
            }
        }
        return entry.uuid;
    }

    // ── Mutation: mkdir / touch / rename / mkshortcut / mklink ─────────

    /**
     * Resolve a free child name under `parentEntry` by appending ` (N)` when
     * `name` already exists. Mirrors the deduping convention used by
     * `#findDedupedPath` but operates on the parent+name shape.
     */
    async #findDedupedName (parentEntry: FSEntry, name: string): Promise<string> {
        const repo = this.#fsEntryRepository;
        const parentPath = parentEntry.path;
        const ext = pathPosix.extname(name);
        const base = pathPosix.basename(name, ext);
        for ( let suffix = 1; suffix < 100_000; suffix++ ) {
            const candidate = `${base} (${suffix})${ext}`;
            const candidatePath = parentPath === '/' ? `/${candidate}` : `${parentPath}/${candidate}`;
            const existing = await repo.getEntryByPathForUser(candidatePath, parentEntry.userId);
            if ( ! existing ) return candidate;
        }
        throw new HttpError(500, 'Could not dedupe name within 100000 attempts');
    }

    /**
     * Resolve or create a parent directory for a given target path. Returns
     * the parent entry. Throws 400 if the path has no parent (root) or 404
     * when parents are missing and create is disabled.
     */
    async #resolveOrCreateParent (userId: number, targetPath: string, createMissingParents: boolean): Promise<FSEntry> {
        const normalized = targetPath.trim();
        if ( normalized === '/' ) throw new HttpError(400, 'Cannot operate on root');
        const parentPath = pathPosix.dirname(normalized);
        if ( parentPath === '/' ) throw new HttpError(400, 'Cannot operate at root');
        return this.#fsEntryRepository.resolveParentDirectory(userId, parentPath, createMissingParents);
    }

    /**
     * Create a directory at `path`. Mirrors v1 HLMkdir options:
     *   - overwrite: if a non-directory exists, remove it and create dir
     *   - dedupeName: if conflict, append ` (N)`
     *   - createMissingParents: create intermediate dirs
     *
     * Returns the created (or existing-on-dedupe-false-no-conflict) entry.
     */
    async mkdir (userId: number, input: {
        path: string;
        overwrite?: boolean;
        dedupeName?: boolean;
        createMissingParents?: boolean;
    }): Promise<FSEntry> {
        const targetPath = input.path.trim();
        const parent = await this.#resolveOrCreateParent(userId, targetPath, !!input.createMissingParents);

        let name = pathPosix.basename(targetPath);
        const existing = await this.#fsEntryRepository.getEntryByPathForUser(targetPath, userId);
        if ( existing ) {
            if ( existing.isDir ) {
                // A directory already exists at path: idempotent success.
                return existing;
            }
            if ( input.overwrite ) {
                // Remove the non-directory occupant then create the dir.
                await this.remove(userId, { entry: existing, recursive: false });
            } else if ( input.dedupeName ) {
                name = await this.#findDedupedName(parent, name);
            } else {
                throw new HttpError(409, `An entry already exists at ${targetPath}`);
            }
        }

        return this.#fsEntryRepository.createNonFileEntry({
            userId,
            parent,
            name,
            kind: 'directory',
        });
    }

    /**
     * Touch: create an empty file at `path` if missing; otherwise bump
     * timestamps. Mirrors v1 `/touch` semantics.
     */
    async touch (userId: number, input: {
        path: string;
        setAccessed?: boolean;
        setModified?: boolean;
        setCreated?: boolean;
        createMissingParents?: boolean;
    }): Promise<FSEntry> {
        const targetPath = input.path.trim();
        const parent = await this.#resolveOrCreateParent(userId, targetPath, !!input.createMissingParents);
        const name = pathPosix.basename(targetPath);
        const existing = await this.#fsEntryRepository.getEntryByPathForUser(targetPath, userId);
        if ( existing ) {
            return this.#fsEntryRepository.touchEntryTimestamps(existing.uuid, {
                setAccessed: input.setAccessed,
                setModified: input.setModified,
                setCreated: input.setCreated,
            });
        }
        return this.#fsEntryRepository.createNonFileEntry({
            userId,
            parent,
            name,
            kind: 'empty-file',
        });
    }

    /**
     * Rename an entry in place. The name changes and path rewrites; if the
     * entry is a directory, descendant paths are rewritten too.
     */
    async rename (entry: FSEntry, newName: string): Promise<FSEntry> {
        if ( newName.includes('/') ) throw new HttpError(400, 'Name cannot contain a slash');
        if ( newName.trim().length === 0 ) throw new HttpError(400, 'Name cannot be empty');
        if ( entry.name === newName ) return entry;

        const parentPath = pathPosix.dirname(entry.path);
        const newPath = parentPath === '/' ? `/${newName}` : `${parentPath}/${newName}`;

        // Reject if another entry already owns the target path.
        const collision = await this.#fsEntryRepository.getEntryByPathForUser(newPath, entry.userId);
        if ( collision && collision.uuid !== entry.uuid ) {
            throw new HttpError(409, `An entry already exists at ${newPath}`);
        }

        const updated = await this.#fsEntryRepository.updateEntry(entry.uuid, {
            name: newName,
            path: newPath,
        });

        if ( entry.isDir ) {
            await this.#fsEntryRepository.updatePathPrefixForUser(entry.userId, entry.path, newPath);
        }
        return updated;
    }

    /**
     * Create a shortcut pointing at `target`. Shortcuts are FS entries with
     * `is_shortcut = 1` and `shortcut_to = target.id`.
     */
    async mkshortcut (userId: number, input: {
        parent: FSEntry;
        name: string;
        target: FSEntry;
        dedupeName?: boolean;
    }): Promise<FSEntry> {
        let name = input.name;
        const childPath = input.parent.path === '/' ? `/${name}` : `${input.parent.path}/${name}`;
        const collision = await this.#fsEntryRepository.getEntryByPathForUser(childPath, userId);
        if ( collision ) {
            if ( input.dedupeName ) {
                name = await this.#findDedupedName(input.parent, name);
            } else {
                throw new HttpError(409, `An entry already exists at ${childPath}`);
            }
        }
        return this.#fsEntryRepository.createNonFileEntry({
            userId,
            parent: input.parent,
            name,
            kind: 'shortcut',
            shortcutTo: input.target.id,
        });
    }

    /**
     * Create a symlink row at `parent/name` pointing to raw string
     * `targetPath`. No verification that target resolves — v1 allowed broken
     * links by design.
     */
    async mklink (userId: number, input: {
        parent: FSEntry;
        name: string;
        targetPath: string;
        dedupeName?: boolean;
    }): Promise<FSEntry> {
        let name = input.name;
        const childPath = input.parent.path === '/' ? `/${name}` : `${input.parent.path}/${name}`;
        const collision = await this.#fsEntryRepository.getEntryByPathForUser(childPath, userId);
        if ( collision ) {
            if ( input.dedupeName ) {
                name = await this.#findDedupedName(input.parent, name);
            } else {
                throw new HttpError(409, `An entry already exists at ${childPath}`);
            }
        }
        return this.#fsEntryRepository.createNonFileEntry({
            userId,
            parent: input.parent,
            name,
            kind: 'symlink',
            symlinkPath: input.targetPath,
        });
    }

    // ── Mutation: remove / move / copy ─────────────────────────────────

    /**
     * Remove an entry. For directories, descendants are walked and removed
     * (both DB rows and S3 objects). Emits `fs.remove.node` per file so the
     * thumbnail extension (and any other listener) can clean up side state.
     *
     * Does NOT enforce ACL — caller (controller) performs the `write` check.
     */
    async remove (userId: number, input: {
        entry: FSEntry;
        recursive?: boolean;
        descendantsOnly?: boolean;
    }): Promise<void> {
        const { entry } = input;
        if ( entry.userId !== userId ) {
            // Defensive — only the owner should be hitting this path; higher
            // layers grant access via ACL, not raw ownership, but we still
            // want to avoid a misrouted call taking out someone else's tree.
            throw new HttpError(403, 'Cannot remove an entry owned by another user');
        }

        if ( entry.isDir ) {
            const descendants = await this.#fsEntryRepository.listDescendantsByPath(userId, entry.path);
            if ( descendants.length > 0 && ! input.recursive ) {
                throw new HttpError(409, 'Directory is not empty');
            }

            // Delete descendants first (depth-descending). S3 objects are
            // batched per bucket+region for efficiency.
            await this.#removeDescendantsStorage(descendants);
            if ( descendants.length > 0 ) {
                await this.#fsEntryRepository.deleteEntries(descendants);
            }

            if ( ! input.descendantsOnly ) {
                await this.#fsEntryRepository.deleteEntry(entry);
                this.#emitRemoveEvent(entry);
            }
            return;
        }

        // File / shortcut / symlink: delete backing S3 object (if any) then the row.
        if ( entry.bucket && entry.bucketRegion && !entry.isShortcut && !entry.isSymlink ) {
            try {
                await this.#s3StorageProvider.deleteObject(
                    entry.bucket,
                    this.#deriveObjectKeyFromEntry(entry),
                    entry.bucketRegion,
                );
            } catch {
                // Best effort — DB row is the source of truth. Extensions
                // will get the `fs.remove.node` event regardless.
            }
        }
        await this.#fsEntryRepository.deleteEntry(entry);
        this.#emitRemoveEvent(entry);
    }

    async #removeDescendantsStorage (descendants: FSEntry[]): Promise<void> {
        // Group file descendants by bucket+region for batch delete.
        const grouped = new Map<string, { bucket: string; region: string; keys: string[] }>();
        for ( const child of descendants ) {
            if ( child.isDir || child.isShortcut || child.isSymlink ) continue;
            if ( ! child.bucket || ! child.bucketRegion ) continue;
            const groupKey = `${child.bucketRegion}::${child.bucket}`;
            const group = grouped.get(groupKey) ?? { bucket: child.bucket, region: child.bucketRegion, keys: [] };
            group.keys.push(this.#deriveObjectKeyFromEntry(child));
            grouped.set(groupKey, group);
            // Fire individual removal events so thumbnail extension can clean up.
            this.#emitRemoveEvent(child);
        }
        await Promise.allSettled(
            Array.from(grouped.values()).map((group) =>
                this.#s3StorageProvider.deleteObjects({ bucket: group.bucket, objectKeys: group.keys }, group.region),
            ),
        );
    }

    #emitRemoveEvent (entry: FSEntry): void {
        // Extensions (thumbnails) listen to `fs.remove.node` with a { node }-like payload.
        // We pass the plain FSEntry — consumers already tolerate various shapes.
        try {
            this.clients.event.emit('fs.remove.node', { node: entry, entry }, {});
        } catch {
            // Non-critical.
        }
    }

    /**
     * Move an entry to a new parent (and optionally rename in the same op).
     * Works for files and directories. Updates descendant paths when moving
     * a directory.
     */
    async move (userId: number, input: {
        source: FSEntry;
        destinationParent: FSEntry;
        newName?: string;
        overwrite?: boolean;
        dedupeName?: boolean;
    }): Promise<FSEntry> {
        const { source, destinationParent } = input;
        if ( source.userId !== userId ) {
            throw new HttpError(403, 'Cannot move an entry owned by another user');
        }
        if ( ! destinationParent.isDir ) {
            throw new HttpError(400, 'Destination parent is not a directory');
        }
        if ( source.isDir && destinationParent.path.startsWith(source.path + '/') ) {
            throw new HttpError(400, 'Cannot move a directory into itself');
        }

        let name = input.newName ?? source.name;
        const targetPath = destinationParent.path === '/'
            ? `/${name}`
            : `${destinationParent.path}/${name}`;

        const collision = await this.#fsEntryRepository.getEntryByPathForUser(targetPath, userId);
        if ( collision && collision.uuid !== source.uuid ) {
            if ( input.overwrite ) {
                await this.remove(userId, { entry: collision, recursive: true });
            } else if ( input.dedupeName ) {
                name = await this.#findDedupedName(destinationParent, name);
            } else {
                throw new HttpError(409, `An entry already exists at ${targetPath}`);
            }
        }

        const finalPath = destinationParent.path === '/'
            ? `/${name}`
            : `${destinationParent.path}/${name}`;

        const updated = await this.#fsEntryRepository.updateEntry(source.uuid, {
            name,
            path: finalPath,
            parentId: destinationParent.id,
            parentUid: destinationParent.uuid,
        });

        if ( source.isDir && source.path !== finalPath ) {
            await this.#fsEntryRepository.updatePathPrefixForUser(userId, source.path, finalPath);
        }

        try {
            this.clients.event.emit('fs.move.node', {
                node: updated,
                fromPath: source.path,
                toPath: finalPath,
            }, {});
        } catch {
            // ignore — non-critical.
        }
        return updated;
    }

    /**
     * Copy an entry to a new parent. For directories, walks descendants and
     * issues S3 CopyObject + DB inserts. Thumbnail URLs on entries ride
     * along in the DB column — the thumbnail extension is notified via
     * `fs.copy.node` so it can duplicate the backing S3 object (otherwise
     * deleting one copy would nuke the other's thumbnail).
     */
    async copy (userId: number, input: {
        source: FSEntry;
        destinationParent: FSEntry;
        newName?: string;
        overwrite?: boolean;
        dedupeName?: boolean;
    }): Promise<FSEntry> {
        const { source, destinationParent } = input;
        if ( ! destinationParent.isDir ) {
            throw new HttpError(400, 'Destination parent is not a directory');
        }
        if ( source.isDir && (destinationParent.path === source.path || destinationParent.path.startsWith(source.path + '/')) ) {
            throw new HttpError(400, 'Cannot copy a directory into itself or a descendant');
        }

        let name = input.newName ?? source.name;
        const targetPath = destinationParent.path === '/'
            ? `/${name}`
            : `${destinationParent.path}/${name}`;

        const collision = await this.#fsEntryRepository.getEntryByPathForUser(targetPath, userId);
        if ( collision ) {
            if ( input.overwrite ) {
                await this.remove(userId, { entry: collision, recursive: true });
            } else if ( input.dedupeName ) {
                name = await this.#findDedupedName(destinationParent, name);
            } else {
                throw new HttpError(409, `An entry already exists at ${targetPath}`);
            }
        }

        const finalPath = destinationParent.path === '/'
            ? `/${name}`
            : `${destinationParent.path}/${name}`;

        if ( ! source.isDir ) {
            return this.#copyLeafEntry(userId, source, destinationParent, name, finalPath);
        }

        // Recursive directory copy:
        // 1) Create the new root directory at destination
        // 2) Walk descendants; for each, compute new path by swapping prefix
        // 3) Create a new row (files copy S3 object; dirs just insert)
        const newRoot = await this.#fsEntryRepository.createNonFileEntry({
            userId,
            parent: destinationParent,
            name,
            kind: 'directory',
            metadata: source.metadata,
            thumbnail: source.thumbnail,
            associatedAppId: source.associatedAppId,
            isPublic: source.isPublic,
        });

        const descendants = await this.#fsEntryRepository.listDescendantsByPath(source.userId, source.path);
        // Sort shallow-first so parents exist before children.
        descendants.sort((a, b) => a.path.length - b.path.length);

        // Maintain a map from old-path → new parent entry so child inserts
        // can reference the correct parent uuid/id.
        const newByOldPath = new Map<string, FSEntry>();
        newByOldPath.set(source.path, newRoot);

        for ( const descendant of descendants ) {
            const oldParentPath = pathPosix.dirname(descendant.path);
            const newParent = newByOldPath.get(oldParentPath);
            if ( ! newParent ) {
                // Parent wasn't copied — skip (shouldn't happen with sort).
                continue;
            }
            const copied = descendant.isDir
                ? await this.#fsEntryRepository.createNonFileEntry({
                    userId,
                    parent: newParent,
                    name: descendant.name,
                    kind: 'directory',
                    metadata: descendant.metadata,
                    thumbnail: descendant.thumbnail,
                    associatedAppId: descendant.associatedAppId,
                    isPublic: descendant.isPublic,
                })
                : await this.#copyLeafEntry(
                    userId,
                    descendant,
                    newParent,
                    descendant.name,
                    newParent.path === '/' ? `/${descendant.name}` : `${newParent.path}/${descendant.name}`,
                );
            newByOldPath.set(descendant.path, copied);
        }

        return newRoot;
    }

    // Internal helper: copies a single non-directory entry. Handles files,
    // shortcuts, and symlinks. Files trigger S3 CopyObject; shortcuts/symlinks
    // are pure metadata clones.
    async #copyLeafEntry (
        userId: number,
        source: FSEntry,
        destinationParent: FSEntry,
        newName: string,
        _newPath: string,
    ): Promise<FSEntry> {
        if ( source.isSymlink ) {
            return this.#fsEntryRepository.createNonFileEntry({
                userId,
                parent: destinationParent,
                name: newName,
                kind: 'symlink',
                symlinkPath: source.symlinkPath,
                metadata: source.metadata,
                associatedAppId: source.associatedAppId,
            });
        }
        if ( source.isShortcut ) {
            return this.#fsEntryRepository.createNonFileEntry({
                userId,
                parent: destinationParent,
                name: newName,
                kind: 'shortcut',
                shortcutTo: source.shortcutTo,
                metadata: source.metadata,
                associatedAppId: source.associatedAppId,
            });
        }

        // Regular file: duplicate the S3 object under a new key (the new
        // entry's uuid), then insert the DB row pointing at it.
        if ( ! source.bucket || ! source.bucketRegion ) {
            throw new HttpError(500, 'Source file has no backing storage');
        }

        const newUuid = uuidv4();
        const sourceObjectKey = this.#deriveObjectKeyFromEntry(source);
        await this.#s3StorageProvider.copyObject(
            {
                sourceBucket: source.bucket,
                sourceKey: sourceObjectKey,
                destinationBucket: source.bucket,
                destinationKey: newUuid,
            },
            source.bucketRegion,
        );

        // Re-serialize metadata, swapping in the new objectKey.
        const nextMetadata = this.#metadataWithObjectKey(source.metadata, newUuid);

        // Insert as a file row. We reuse the files INSERT path (batchCreateEntries)
        // since it handles bucket/metadata correctly. A single-row call is fine.
        const [created] = await this.#fsEntryRepository.batchCreateEntries([{
            userId,
            uuid: newUuid,
            path: destinationParent.path === '/' ? `/${newName}` : `${destinationParent.path}/${newName}`,
            size: source.size ?? 0,
            contentType: undefined,
            metadata: nextMetadata,
            thumbnail: source.thumbnail,
            associatedAppId: source.associatedAppId,
            immutable: source.immutable,
            isPublic: source.isPublic,
            bucket: source.bucket,
            bucketRegion: source.bucketRegion,
        } as FSEntryCreateInput], false);
        if ( ! created ) {
            throw new HttpError(500, 'Failed to copy file entry');
        }

        try {
            this.clients.event.emit('fs.copy.node', {
                source,
                copy: created,
                sourceObjectKey,
                copyObjectKey: newUuid,
            }, {});
        } catch {
            // ignore — non-critical.
        }
        return created;
    }

    // Preserves existing metadata JSON fields, overriding only objectKey.
    #metadataWithObjectKey (metadata: string | null, objectKey: string): string {
        let parsed: Record<string, unknown> = {};
        if ( metadata ) {
            try {
                const tentative = JSON.parse(metadata);
                if ( tentative && typeof tentative === 'object' && !Array.isArray(tentative) ) {
                    parsed = tentative as Record<string, unknown>;
                }
            } catch {
                // Non-JSON legacy metadata — drop and replace.
            }
        }
        parsed.objectKey = objectKey;
        return JSON.stringify(parsed);
    }
}
