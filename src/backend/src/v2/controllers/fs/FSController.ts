import Busboy from 'busboy';
import type { Request, Response } from 'express';
import { posix as pathPosix } from 'node:path';
import type { Actor } from '../../core/actor.js';
import { Context } from '../../core/context.js';
import { HttpError } from '../../core/http/HttpError.js';
import { Controller, Get, Post } from '../../core/http/decorators.js';
import type {
    PreparedBatchWrite,
    UploadedBatchWriteItem,
    UploadProgressTrackerLike,
} from '../../services/fs/types.js';
import type { FSEntry, FSEntryWriteInput } from '../../stores/fs/FSEntry.js';
import {
    runWithConcurrencyLimit,
    runWithConcurrencyLimitSettled,
} from '../../utils/concurrency.js';
import { PuterController } from '../types.js';
import type {
    CompleteWriteRequest,
    CompleteWriteResponse,
    SignedWriteRequest,
    SignedWriteResponse,
    SignMultipartPartsRequest,
    SignMultipartPartsResponse,
    WriteGuiMetadata,
    WriteRequest,
    WriteResponse,
} from './requestTypes.js';
import type {
    AbortWriteRequest,
    BatchWriteManifest,
    BatchWriteManifestItem,
    ParsedMultipartBatchManifest,
    RouteParams,
    ThumbnailUploadPrepareItem,
    ThumbnailUploadPreparePayload,
} from './types.js';
class UploadProgressTracker implements UploadProgressTrackerLike {
    total = 0;
    progress = 0;
    #listeners: Array<(delta: number) => void> = [];

    setTotal (value: number) {
        this.total = value;
    }

    add (amount: number) {
        this.progress += amount;
        for ( const listener of this.#listeners ) {
            listener(amount);
        }
    }

    subscribe (callback: (delta: number) => void) {
        this.#listeners.push(callback);
        return {
            detach: () => {
                const idx = this.#listeners.indexOf(callback);
                if ( idx !== -1 ) this.#listeners.splice(idx, 1);
            },
        };
    }
}

const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;
const DEFAULT_BATCH_ACL_CHECK_CONCURRENCY = 32;
const DEFAULT_BATCH_WRITE_SIDE_EFFECT_CONCURRENCY = 8;

@Controller('/fs')
export class FSController extends PuterController {

    @Post('/startWrite', { subdomain: 'api', requireVerified: true })
    async startWrite (req: Request<RouteParams, null, SignedWriteRequest>, res: Response<SignedWriteResponse>) {
        const userId = this.#getActorUserId(req);
        const storageAllowanceMax = this.#getStorageAllowanceMaxOverride(req);
        const requestBody = this.#withGuiMetadata(req.body, req.body);
        requestBody.fileMetadata = this.#normalizeFileMetadataPath(req, requestBody.fileMetadata, requestBody);
        requestBody.fileMetadata = await this.#resolveAssociatedAppMetadata(requestBody.fileMetadata, requestBody);
        await this.#assertWriteAccess(req, requestBody.fileMetadata, {
            pathAlreadyNormalized: true,
        });

        const {
            response,
            createdDirectoryEntries,
        } = await this.services.fsEntry.startUrlWriteWithCreatedDirectories(userId, requestBody, storageAllowanceMax);
        await this.#attachSignedThumbnailUploadTargets([requestBody], [response]);
        if ( ! requestBody.directory ) {
            await this.#runNonCritical(async () => {
                await this.#emitGuiPendingWriteEvent(userId, requestBody, response);
            }, 'emitStartWritePendingEvent');
        }
        if ( createdDirectoryEntries.length > 0 ) {
            void this.#runNonCritical(async () => {
                for ( const createdDirectoryEntry of createdDirectoryEntries ) {
                    await this.#emitGuiWriteEvent(
                        'outer.gui.item.added',
                        createdDirectoryEntry,
                        requestBody.guiMetadata,
                    );
                }
            }, 'emitStartWriteDirectoryEvents');
        }
        res.json(response);
    }

    @Post('/startBatchWrite', { subdomain: 'api', requireVerified: true })
    async startBatchWrites (req: Request<RouteParams, null, SignedWriteRequest[]>, res: Response<SignedWriteResponse[]>) {
        const userId = this.#getActorUserId(req);
        const storageAllowanceMax = this.#getStorageAllowanceMaxOverride(req);
        const appUidLookupCache = new Map<string, Promise<number | null>>();
        const requests = Array.isArray(req.body)
            ? await Promise.all(req.body.map(async (requestBody) => {
                const normalizedRequestBody = this.#withGuiMetadata(requestBody, req.body);
                normalizedRequestBody.fileMetadata = this.#normalizeFileMetadataPath(
                    req,
                    normalizedRequestBody.fileMetadata,
                    normalizedRequestBody,
                );
                normalizedRequestBody.fileMetadata = await this.#resolveAssociatedAppMetadata(
                    normalizedRequestBody.fileMetadata,
                    normalizedRequestBody,
                    appUidLookupCache,
                );
                return normalizedRequestBody;
            }))
            : [];
        await this.#assertBatchWriteAccess(
            req,
            requests.map((requestBody) => requestBody.fileMetadata),
            { pathAlreadyNormalized: true },
        );

        const {
            responses,
            createdDirectoryEntries,
        } = await this.services.fsEntry.batchStartUrlWritesWithCreatedDirectories(userId, requests, storageAllowanceMax);
        const directoryGuiMetadataByPath = new Map<string, WriteGuiMetadata | undefined>(
            requests
                .filter((request) => request.directory)
                .map((request) => [request.fileMetadata.path, request.guiMetadata]),
        );
        const emittedDirectoryPaths = new Set<string>();

        await this.#attachSignedThumbnailUploadTargets(requests, responses);
        await this.#runNonCritical(async () => {
            await runWithConcurrencyLimit(
                responses,
                32,
                async (writeResponse, index) => {
                    const requestBody = requests[index];
                    if ( requestBody && writeResponse ) {
                        if ( ! requestBody.directory ) {
                            await this.#emitGuiPendingWriteEvent(userId, requestBody, writeResponse);
                        }
                    }
                },
            );
        }, 'emitStartBatchWritePendingEvents');
        if ( createdDirectoryEntries.length > 0 ) {
            void this.#runNonCritical(async () => {
                for ( const createdDirectoryEntry of createdDirectoryEntries ) {
                    if ( emittedDirectoryPaths.has(createdDirectoryEntry.path) ) {
                        continue;
                    }
                    emittedDirectoryPaths.add(createdDirectoryEntry.path);
                    await this.#emitGuiWriteEvent(
                        'outer.gui.item.added',
                        createdDirectoryEntry,
                        directoryGuiMetadataByPath.get(createdDirectoryEntry.path),
                    );
                }
            }, 'emitStartBatchWriteDirectoryEvents');
        }
        res.json(responses);
    }

    @Post('/completeWrite', { subdomain: 'api', requireVerified: true })
    async completeWrite (req: Request<RouteParams, null, CompleteWriteRequest>, res: Response<CompleteWriteResponse>) {
        const userId = this.#getActorUserId(req);
        const requestBody = this.#withGuiMetadata(req.body, req.body);
        this.#assertNoInlineSignedThumbnailData(requestBody.thumbnailData);

        const response = await this.services.fsEntry.completeUrlWrite(userId, requestBody);
        const writeResponse = await this.#applyWriteResponseSideEffects(
            userId,
            {
                fsEntry: response.fsEntry,
                wasOverwrite: response.wasOverwrite,
                requestedThumbnail: response.requestedThumbnail,
                contentHashSha256: null,
            },
            requestBody.guiMetadata,
        );
        res.json({ ...response, fsEntry: writeResponse.fsEntry });
    }

    @Post('/completeBatchWrite', { subdomain: 'api', requireVerified: true })
    async completeBatchWrites (
        req: Request<RouteParams, null, CompleteWriteRequest[]>,
        res: Response<CompleteWriteResponse[]>,
    ) {
        const userId = this.#getActorUserId(req);
        const requests = Array.isArray(req.body)
            ? req.body.map((requestBody) => {
                return this.#withGuiMetadata(requestBody, req.body);
            })
            : [];
        for ( const requestBody of requests ) {
            this.#assertNoInlineSignedThumbnailData(requestBody.thumbnailData);
        }
        const response = await this.services.fsEntry.batchCompleteUrlWrite(userId, requests);
        const updatedResponse = await runWithConcurrencyLimit(
            response,
            DEFAULT_BATCH_WRITE_SIDE_EFFECT_CONCURRENCY,
            async (writeResponse, index) => {
                const requestBody = requests[index];
                const withSideEffects = await this.#applyWriteResponseSideEffects(
                    userId,
                    {
                        fsEntry: writeResponse.fsEntry,
                        wasOverwrite: writeResponse.wasOverwrite,
                        requestedThumbnail: writeResponse.requestedThumbnail,
                        contentHashSha256: null,
                    },
                    requestBody?.guiMetadata,
                );
                return { ...writeResponse, fsEntry: withSideEffects.fsEntry };
            },
        );
        res.json(updatedResponse);
    }

    @Post('/abortWrite', { subdomain: 'api', requireVerified: true })
    async abortWrite (req: Request<RouteParams, null, AbortWriteRequest>, res: Response<{ ok: true }>) {
        const userId = this.#getActorUserId(req);
        if ( ! req.body?.uploadId ) {
            throw new HttpError(400, 'Missing uploadId');
        }

        await this.services.fsEntry.abortUrlWrite(userId, req.body.uploadId);
        res.json({ ok: true });
    }

    @Post('/signMultipartParts', { subdomain: 'api', requireVerified: true })
    async signMultipartParts (
        req: Request<RouteParams, null, SignMultipartPartsRequest>,
        res: Response<SignMultipartPartsResponse>,
    ) {
        const userId = this.#getActorUserId(req);
        const response = await this.services.fsEntry.signMultipartParts(userId, req.body);
        res.json(response);
    }

    @Post('/write', { subdomain: 'api', requireVerified: true })
    async write (req: Request<RouteParams, null, WriteRequest>, res: Response<WriteResponse>) {
        const userId = this.#getActorUserId(req);
        const storageAllowanceMax = this.#getStorageAllowanceMaxOverride(req);
        const requestBody = this.#withGuiMetadata(req.body, req.body);
        requestBody.fileMetadata = this.#normalizeFileMetadataPath(req, requestBody.fileMetadata, requestBody);
        requestBody.fileMetadata = await this.#resolveAssociatedAppMetadata(requestBody.fileMetadata, requestBody);
        await this.#assertWriteAccess(req, requestBody.fileMetadata, {
            pathAlreadyNormalized: true,
        });
        const normalizedPath = this.#normalizePath(requestBody.fileMetadata.path);
        const uploadTracker = await this.#createUploadTracker(
            userId,
            normalizedPath,
            normalizedPath,
            Number(requestBody.fileMetadata.size ?? 0),
            requestBody.guiMetadata,
        );
        const response = await this.services.fsEntry.write(userId, requestBody, uploadTracker, storageAllowanceMax);
        const updatedResponse = await this.#applyWriteResponseSideEffects(
            userId,
            response,
            requestBody.guiMetadata,
        );
        res.json(updatedResponse);
    }

    @Post('/batchWrite', { subdomain: 'api', requireVerified: true })
    async batchWrites (req: Request<RouteParams, null, WriteRequest[]>, res: Response<WriteResponse[]>) {
        const userId = this.#getActorUserId(req);
        const storageAllowanceMax = this.#getStorageAllowanceMaxOverride(req);
        const requestMode = this.#resolveBatchWriteRequestMode(req);
        const appUidLookupCache = new Map<string, Promise<number | null>>();
        if ( requestMode === 'multipart' ) {
            let parsedManifest: ParsedMultipartBatchManifest | null = null;
            let preparedBatch: PreparedBatchWrite | null = null;
            let manifestPreparationPromise: Promise<void> | null = null;
            let parseFailure: Error | null = null;
            const uploadPromises: Promise<UploadedBatchWriteItem | null>[] = [];
            const uploadedIndexes = new Set<number>();
            let fileOrderIndex = 0;

            const failParse = (error: unknown) => {
                if ( parseFailure ) {
                    return;
                }
                if ( error instanceof Error ) {
                    parseFailure = error;
                    return;
                }
                parseFailure = new Error(String(error));
            };

            const busboy = Busboy({ headers: req.headers });

            busboy.on('field', (fieldName, value, info) => {
                if ( info.fieldnameTruncated || info.valueTruncated ) {
                    failParse(new HttpError(400, 'Batch write manifest field is truncated'));
                    return;
                }
                if ( fieldName !== 'manifest' ) {
                    return;
                }
                if ( manifestPreparationPromise ) {
                    failParse(new HttpError(409, 'Batch write manifest was provided more than once'));
                    return;
                }

                try {
                    parsedManifest = this.#parseBatchWriteManifest(value, undefined);
                    const ignoredItemIndexes = new Set<number>();
                    parsedManifest = {
                        ...parsedManifest,
                        items: parsedManifest.items.map((item) => ({
                            ...item,
                            fileMetadata: this.#normalizeFileMetadataPath(req, item.fileMetadata, item),
                        })),
                        ignoredItemIndexes,
                    };
                    for ( const item of parsedManifest.items ) {
                        if ( this.#shouldIgnoreUploadPath(item.fileMetadata.path) ) {
                            ignoredItemIndexes.add(item.index);
                        }
                    }
                    manifestPreparationPromise = (async () => {
                        try {
                            if ( ! parsedManifest ) {
                                throw new HttpError(400, 'Batch write manifest is missing');
                            }
                            parsedManifest = {
                                ...parsedManifest,
                                items: await Promise.all(parsedManifest.items.map(async (item) => ({
                                    ...item,
                                    fileMetadata: await this.#resolveAssociatedAppMetadata(
                                        item.fileMetadata,
                                        item,
                                        appUidLookupCache,
                                    ),
                                }))),
                            };
                            const activeManifestItems = parsedManifest.items
                                .filter((item) => !parsedManifest?.ignoredItemIndexes?.has(item.index));

                            await this.#assertBatchWriteAccess(
                                req,
                                activeManifestItems.map((item) => item.fileMetadata),
                                { pathAlreadyNormalized: true },
                            );

                            preparedBatch = await this.services.fsEntry.prepareBatchWrites(
                                userId,
                                activeManifestItems.map((item) => ({
                                    fileMetadata: item.fileMetadata,
                                    thumbnailData: item.thumbnailData,
                                    guiMetadata: item.guiMetadata,
                                })),
                                storageAllowanceMax,
                            );
                            await this.services.fsEntry.assertStorageAllowanceForPreparedBatch(
                                preparedBatch,
                                undefined,
                                storageAllowanceMax,
                            );
                        } catch ( error ) {
                            failParse(error);
                        }
                    })();
                } catch ( error ) {
                    failParse(error);
                }
            });

            busboy.on('file', (fieldName, stream) => {
                const currentFileOrder = fileOrderIndex;
                fileOrderIndex++;
                const uploadPromise = (async () => {
                    try {
                        if ( parseFailure ) {
                            throw parseFailure;
                        }
                        if ( ! manifestPreparationPromise ) {
                            throw new HttpError(400, 'Batch write manifest must come before file content');
                        }

                        await manifestPreparationPromise;
                        if ( parseFailure ) {
                            throw parseFailure;
                        }
                        if ( !parsedManifest || !preparedBatch ) {
                            throw new HttpError(400, 'Batch write manifest is missing');
                        }

                        const itemIndex = this.#resolveMultipartFileIndex(
                            fieldName,
                            currentFileOrder,
                            parsedManifest,
                        );
                        if ( parsedManifest.ignoredItemIndexes.has(itemIndex) ) {
                            if ( !stream.readableEnded && !stream.destroyed ) {
                                stream.resume();
                            }
                            return null;
                        }
                        if ( uploadedIndexes.has(itemIndex) ) {
                            throw new HttpError(409, `Duplicate file content for batch index ${itemIndex}`);
                        }
                        uploadedIndexes.add(itemIndex);

                        const preparedItem = preparedBatch.itemsByIndex.get(itemIndex);
                        if ( ! preparedItem ) {
                            throw new HttpError(400, `Batch write metadata was not found for index ${itemIndex}`);
                        }

                        const uploadTracker = await this.#createUploadTracker(
                            userId,
                            preparedItem.objectKey,
                            preparedItem.normalizedInput.path,
                            preparedItem.normalizedInput.size,
                            preparedItem.guiMetadata,
                        );

                        return await this.services.fsEntry.uploadPreparedBatchItem({
                            preparedBatch,
                            itemIndex,
                            fileContent: stream,
                            uploadTracker,
                        });
                    } catch ( error ) {
                        if ( !stream.readableEnded && !stream.destroyed ) {
                            stream.resume();
                        }
                        throw error;
                    }
                })();
                uploadPromises.push(uploadPromise);
            });

            const parsingComplete = new Promise<void>((resolve, reject) => {
                busboy.once('error', reject);
                busboy.once('close', resolve);
            });

            req.pipe(busboy);
            await parsingComplete;
            if ( ! manifestPreparationPromise ) {
                await Promise.allSettled(uploadPromises);
                throw new HttpError(400, 'Batch write manifest is required');
            }
            await manifestPreparationPromise;
            const uploadResults = await Promise.allSettled(uploadPromises);
            const uploadedItems = uploadResults
                .filter((result): result is PromiseFulfilledResult<UploadedBatchWriteItem | null> => result.status === 'fulfilled')
                .map((result) => result.value)
                .filter((uploadedItem): uploadedItem is UploadedBatchWriteItem => uploadedItem !== null);
            if ( parseFailure ) {
                if ( preparedBatch ) {
                    await this.services.fsEntry.cleanupPreparedBatchUploads(preparedBatch, uploadedItems);
                }
                throw parseFailure;
            }
            if ( ! preparedBatch ) {
                throw new HttpError(500, 'Failed to prepare batch write operation');
            }
            const failedUpload = uploadResults.find((result) => result.status === 'rejected');
            if ( failedUpload?.status === 'rejected' ) {
                await this.services.fsEntry.cleanupPreparedBatchUploads(preparedBatch, uploadedItems);
                throw (failedUpload.reason instanceof Error
                    ? failedUpload.reason
                    : new Error('Failed to upload multipart batch item'));
            }

            const writeResponses = await this.services.fsEntry.finalizePreparedBatchWrites(preparedBatch, uploadedItems);
            const updatedResponses = await runWithConcurrencyLimit(
                writeResponses,
                32,
                async (writeResponse, index) => {
                    const preparedItem = preparedBatch?.items[index];
                    return this.#applyWriteResponseSideEffects(
                        userId,
                        writeResponse,
                        preparedItem?.guiMetadata,
                    );
                },
            );
            res.json(updatedResponses);
            return;
        }

        const requests = Array.isArray(req.body)
            ? await Promise.all(req.body.map(async (requestBody) => {
                const normalizedRequestBody = this.#withGuiMetadata(requestBody, req.body);
                normalizedRequestBody.fileMetadata = this.#normalizeFileMetadataPath(
                    req,
                    normalizedRequestBody.fileMetadata,
                    normalizedRequestBody,
                );
                normalizedRequestBody.fileMetadata = await this.#resolveAssociatedAppMetadata(
                    normalizedRequestBody.fileMetadata,
                    normalizedRequestBody,
                    appUidLookupCache,
                );
                return normalizedRequestBody;
            }))
            : [];
        const filteredRequests = requests.filter((requestBody) => {
            return !this.#shouldIgnoreUploadPath(requestBody.fileMetadata.path);
        });
        if ( filteredRequests.length === 0 ) {
            res.json([]);
            return;
        }
        await this.#assertBatchWriteAccess(
            req,
            filteredRequests.map((requestBody) => requestBody.fileMetadata),
            { pathAlreadyNormalized: true },
        );

        const preparedBatch = await this.services.fsEntry.prepareBatchWrites(
            userId,
            filteredRequests.map((requestBody) => ({
                fileMetadata: requestBody.fileMetadata,
                thumbnailData: requestBody.thumbnailData,
                guiMetadata: requestBody.guiMetadata,
            })),
            storageAllowanceMax,
        );
        await this.services.fsEntry.assertStorageAllowanceForPreparedBatch(
            preparedBatch,
            undefined,
            storageAllowanceMax,
        );

        const uploadResults = await runWithConcurrencyLimitSettled(
            filteredRequests,
            8,
            async (requestBody, index) => {
                const preparedItem = preparedBatch.items[index];
                if ( ! preparedItem ) {
                    throw new Error(`Failed to resolve prepared batch item for index ${index}`);
                }
                const uploadTracker = await this.#createUploadTracker(
                    userId,
                    preparedItem.objectKey,
                    preparedItem.normalizedInput.path,
                    preparedItem.normalizedInput.size,
                    requestBody.guiMetadata,
                );
                return this.services.fsEntry.uploadPreparedBatchItem({
                    preparedBatch,
                    itemIndex: preparedItem.index,
                    fileContent: requestBody.fileContent,
                    encoding: requestBody.encoding,
                    uploadTracker,
                });
            },
        );
        const uploadedItems = uploadResults
            .filter((result): result is PromiseFulfilledResult<UploadedBatchWriteItem> => result.status === 'fulfilled')
            .map((result) => result.value);
        const failedUpload = uploadResults.find((result) => result.status === 'rejected');
        if ( failedUpload?.status === 'rejected' ) {
            await this.services.fsEntry.cleanupPreparedBatchUploads(preparedBatch, uploadedItems);
            throw (failedUpload.reason instanceof Error
                ? failedUpload.reason
                : new Error('Failed to upload batch write item'));
        }

        const writeResponses = await this.services.fsEntry.finalizePreparedBatchWrites(preparedBatch, uploadedItems);
        const updatedResponses = await runWithConcurrencyLimit(
            writeResponses,
            32,
            async (writeResponse, index) => {
                const requestBody = filteredRequests[index];
                return this.#applyWriteResponseSideEffects(
                    userId,
                    writeResponse,
                    requestBody?.guiMetadata,
                );
            },
        );
        res.json(updatedResponses);
    }

    // ── Read-side routes ────────────────────────────────────────────────

    @Post('/stat', { subdomain: 'api', requireVerified: true })
    async statEntry (req: Request, res: Response) {
        const actor = this.#requireActor(req);
        const userId = this.#getActorUserId(req);
        const body = this.#toObjectRecord(req.body);
        const entry = await this.#resolveEntryForRequest(body, userId);
        await this.#assertAccess(actor, entry.path, 'see');

        const wantsSize = this.#toBoolean(body.return_size);
        const wantsSubdomains = this.#toBoolean(body.return_subdomains);

        const subdomains = wantsSubdomains
            ? await this.#fetchSubdomainsForEntry(entry)
            : undefined;
        const subtreeSize = entry.isDir && wantsSize
            ? await this.services.fsEntry.getSubtreeSize(userId, entry.path)
            : undefined;

        res.json({
            ...entry,
            ...(subtreeSize !== undefined ? { size: subtreeSize } : {}),
            ...(subdomains !== undefined ? { subdomains } : {}),
        });
    }

    @Post('/readdir', { subdomain: 'api', requireVerified: true })
    async readdirEntries (req: Request, res: Response) {
        const actor = this.#requireActor(req);
        const userId = this.#getActorUserId(req);
        const body = this.#toObjectRecord(req.body);
        const parent = await this.#resolveEntryForRequest(body, userId);
        if ( ! parent.isDir ) {
            throw new HttpError(400, 'Target is not a directory');
        }
        await this.#assertAccess(actor, parent.path, 'list');

        const limit = this.#toNumberOrUndefined(body.limit);
        const offset = this.#toNumberOrUndefined(body.offset);
        const sortByRaw = typeof body.sort_by === 'string' ? body.sort_by.toLowerCase() : undefined;
        const sortBy = (['name', 'modified', 'type', 'size'] as const).find((v) => v === sortByRaw) ?? null;
        const sortOrderRaw = typeof body.sort_order === 'string' ? body.sort_order.toLowerCase() : undefined;
        const sortOrder = (['asc', 'desc'] as const).find((v) => v === sortOrderRaw) ?? null;

        const children = await this.services.fsEntry.listDirectory(parent.uuid, {
            limit,
            offset,
            sortBy,
            sortOrder,
        });
        res.json(children);
    }

    @Post('/search', { subdomain: 'api', requireVerified: true })
    async searchEntries (req: Request, res: Response) {
        this.#requireActor(req);
        const userId = this.#getActorUserId(req);
        const body = this.#toObjectRecord(req.body);
        const query = typeof body.query === 'string' ? body.query : typeof body.text === 'string' ? body.text : '';
        if ( query.trim().length === 0 ) {
            throw new HttpError(400, 'Missing `query`');
        }
        const limit = this.#toNumberOrUndefined(body.limit);
        const results = await this.services.fsEntry.searchByName(userId, query, limit ?? 200);
        res.json(results);
    }

    @Get('/read', { subdomain: 'api', requireVerified: true })
    async readEntry (req: Request, res: Response) {
        const actor = this.#requireActor(req);
        const userId = this.#getActorUserId(req);
        const query = this.#toObjectRecord(req.query);
        const entry = await this.#resolveEntryForRequest(query, userId);
        await this.#assertAccess(actor, entry.path, 'read');

        if ( entry.isDir ) {
            throw new HttpError(400, 'Cannot read a directory; use /fs/readdir');
        }

        const range = typeof req.headers.range === 'string' ? req.headers.range : undefined;
        const download = await this.services.fsEntry.readContent(entry, { range });

        if ( download.contentType ) res.setHeader('Content-Type', download.contentType);
        if ( download.contentLength !== null ) res.setHeader('Content-Length', String(download.contentLength));
        if ( download.contentRange ) res.setHeader('Content-Range', download.contentRange);
        if ( download.etag ) res.setHeader('ETag', download.etag);
        if ( download.lastModified ) res.setHeader('Last-Modified', download.lastModified.toUTCString());

        res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(entry.name)}"`);
        res.status(range ? 206 : 200);

        // Meter egress on stream end (best effort — don't fail the read).
        const metering = this.services.metering as {
            batchIncrementUsages?: (actor: unknown, entries: unknown[]) => void;
        } | undefined;
        if ( metering?.batchIncrementUsages && download.contentLength ) {
            download.body.once('end', () => {
                try {
                    metering.batchIncrementUsages!(actor, [{
                        usageType: 'filesystem:egress:bytes',
                        usageAmount: download.contentLength!,
                    }]);
                } catch {
                    // ignore — metering is non-critical.
                }
            });
        }

        download.body.on('error', (err) => {
            res.destroy(err);
        });
        download.body.pipe(res);
    }

    // ── Mutation routes ────────────────────────────────────────────────

    @Post('/mkdir', { subdomain: 'api', requireVerified: true })
    async mkdirEntry (req: Request, res: Response) {
        const actor = this.#requireActor(req);
        const userId = this.#getActorUserId(req);
        const body = this.#toObjectRecord(req.body);
        const path = typeof body.path === 'string' ? body.path : '';
        if ( ! path.trim() ) throw new HttpError(400, 'Missing `path`');

        // ACL: write on parent (or on target path if overwriting existing).
        const parentPath = pathPosix.dirname(path.trim().startsWith('/') ? path.trim() : `/${path.trim()}`);
        await this.#assertAccess(actor, parentPath === '/' ? path : parentPath, 'write');

        const entry = await this.services.fsEntry.mkdir(userId, {
            path,
            overwrite: this.#toBoolean(body.overwrite) ?? false,
            dedupeName: this.#toBoolean(body.dedupe_name ?? body.dedupeName) ?? false,
            createMissingParents: this.#toBoolean(body.create_missing_parents ?? body.create_missing_ancestors) ?? false,
        });
        this.#emitGuiItemAdded(entry);
        res.json(entry);
    }

    @Post('/touch', { subdomain: 'api', requireVerified: true })
    async touchEntry (req: Request, res: Response) {
        const actor = this.#requireActor(req);
        const userId = this.#getActorUserId(req);
        const body = this.#toObjectRecord(req.body);
        const path = typeof body.path === 'string' ? body.path : '';
        if ( ! path.trim() ) throw new HttpError(400, 'Missing `path`');

        const parentPath = pathPosix.dirname(path.trim().startsWith('/') ? path.trim() : `/${path.trim()}`);
        await this.#assertAccess(actor, parentPath === '/' ? path : parentPath, 'write');

        const entry = await this.services.fsEntry.touch(userId, {
            path,
            setAccessed: this.#toBoolean(body.set_accessed_to_now) ?? false,
            setModified: this.#toBoolean(body.set_modified_to_now) ?? false,
            setCreated: this.#toBoolean(body.set_created_to_now) ?? false,
            createMissingParents: this.#toBoolean(body.create_missing_parents) ?? false,
        });
        res.json(entry);
    }

    @Post('/rename', { subdomain: 'api', requireVerified: true })
    async renameEntry (req: Request, res: Response) {
        const actor = this.#requireActor(req);
        const userId = this.#getActorUserId(req);
        const body = this.#toObjectRecord(req.body);
        const newName = typeof body.new_name === 'string' ? body.new_name : '';
        if ( ! newName.trim() ) throw new HttpError(400, 'Missing `new_name`');

        const entry = await this.#resolveEntryForRequest(body, userId);
        await this.#assertAccess(actor, entry.path, 'write');

        const renamed = await this.services.fsEntry.rename(entry, newName);
        this.#emitGuiItemUpdated(renamed);
        res.json(renamed);
    }

    @Post('/delete', { subdomain: 'api', requireVerified: true })
    async deleteEntry (req: Request, res: Response) {
        const actor = this.#requireActor(req);
        const userId = this.#getActorUserId(req);
        const body = this.#toObjectRecord(req.body);
        const entry = await this.#resolveEntryForRequest(body, userId);
        await this.#assertAccess(actor, entry.path, 'write');

        await this.services.fsEntry.remove(userId, {
            entry,
            recursive: this.#toBoolean(body.recursive) ?? false,
            descendantsOnly: this.#toBoolean(body.descendants_only) ?? false,
        });
        this.#emitGuiItemRemoved(entry);
        res.json({ ok: true });
    }

    @Post('/move', { subdomain: 'api', requireVerified: true })
    async moveEntry (req: Request, res: Response) {
        const actor = this.#requireActor(req);
        const userId = this.#getActorUserId(req);
        const body = this.#toObjectRecord(req.body);
        const sourceRef = this.#extractNodeRef(body.source ?? body);
        const destinationRef = this.#extractNodeRef(body.destination);

        const source = await this.#resolveEntryForRequest(sourceRef, userId);
        const destinationParent = await this.#resolveEntryForRequest(destinationRef, userId);

        await this.#assertAccess(actor, source.path, 'write');
        await this.#assertAccess(actor, destinationParent.path, 'write');

        const moved = await this.services.fsEntry.move(userId, {
            source,
            destinationParent,
            newName: typeof body.new_name === 'string' ? body.new_name : undefined,
            overwrite: this.#toBoolean(body.overwrite) ?? false,
            dedupeName: this.#toBoolean(body.dedupe_name ?? body.change_name) ?? false,
        });
        this.#emitGuiItemMoved(source, moved);
        res.json(moved);
    }

    @Post('/copy', { subdomain: 'api', requireVerified: true })
    async copyEntry (req: Request, res: Response) {
        const actor = this.#requireActor(req);
        const userId = this.#getActorUserId(req);
        const body = this.#toObjectRecord(req.body);
        const sourceRef = this.#extractNodeRef(body.source ?? body);
        const destinationRef = this.#extractNodeRef(body.destination);

        const source = await this.#resolveEntryForRequest(sourceRef, userId);
        const destinationParent = await this.#resolveEntryForRequest(destinationRef, userId);

        await this.#assertAccess(actor, source.path, 'read');
        await this.#assertAccess(actor, destinationParent.path, 'write');

        const copy = await this.services.fsEntry.copy(userId, {
            source,
            destinationParent,
            newName: typeof body.new_name === 'string' ? body.new_name : undefined,
            overwrite: this.#toBoolean(body.overwrite) ?? false,
            dedupeName: this.#toBoolean(body.dedupe_name ?? body.change_name) ?? true,
        });
        this.#emitGuiItemAdded(copy);
        res.json(copy);
    }

    @Post('/mkshortcut', { subdomain: 'api', requireVerified: true })
    async mkshortcutEntry (req: Request, res: Response) {
        const actor = this.#requireActor(req);
        const userId = this.#getActorUserId(req);
        const body = this.#toObjectRecord(req.body);
        const parentRef = this.#extractNodeRef(body.parent ?? body);
        const targetRef = this.#extractNodeRef(body.target);
        const name = typeof body.name === 'string' ? body.name : '';
        if ( ! name.trim() ) throw new HttpError(400, 'Missing `name`');

        const parent = await this.#resolveEntryForRequest(parentRef, userId);
        const target = await this.#resolveEntryForRequest(targetRef, userId);

        await this.#assertAccess(actor, target.path, 'read');
        await this.#assertAccess(actor, parent.path, 'write');

        const shortcut = await this.services.fsEntry.mkshortcut(userId, {
            parent,
            name,
            target,
            dedupeName: this.#toBoolean(body.dedupe_name) ?? true,
        });
        this.#emitGuiItemAdded(shortcut);
        res.json(shortcut);
    }

    @Post('/mklink', { subdomain: 'api', requireVerified: true })
    async mklinkEntry (req: Request, res: Response) {
        const actor = this.#requireActor(req);
        const userId = this.#getActorUserId(req);
        const body = this.#toObjectRecord(req.body);
        const parentRef = this.#extractNodeRef(body.parent ?? body);
        const parent = await this.#resolveEntryForRequest(parentRef, userId);
        const name = typeof body.name === 'string' ? body.name : '';
        const target = typeof body.target === 'string' ? body.target : '';
        if ( ! name.trim() ) throw new HttpError(400, 'Missing `name`');
        if ( ! target.trim() ) throw new HttpError(400, 'Missing `target`');

        await this.#assertAccess(actor, parent.path, 'write');

        const link = await this.services.fsEntry.mklink(userId, {
            parent,
            name,
            targetPath: target,
            dedupeName: this.#toBoolean(body.dedupe_name) ?? true,
        });
        this.#emitGuiItemAdded(link);
        res.json(link);
    }

    // ── Read-side helpers ───────────────────────────────────────────────

    #requireActor (req: Request): Actor {
        const actor = req.actor;
        if ( ! actor ) {
            throw new HttpError(401, 'Unauthorized');
        }
        return actor;
    }

    async #resolveEntryForRequest (source: Record<string, unknown>, userId: number) {
        const ref = {
            path: typeof source.path === 'string' ? source.path : undefined,
            uid: typeof source.uid === 'string'
                ? source.uid
                : typeof source.uuid === 'string' ? source.uuid : undefined,
            id: (typeof source.id === 'number' || typeof source.id === 'string') ? source.id : undefined,
        };
        const mod = await import('../../services/fs/resolveNode.js');
        const entry = await mod.resolveNode(this.stores.fsEntry, ref, { userId, required: true });
        if ( ! entry ) {
            throw new HttpError(404, 'Entry not found');
        }
        return entry;
    }

    async #assertAccess (actor: Actor, path: string, mode: 'see' | 'list' | 'read' | 'write') {
        const fsEntryService = this.services.fsEntry;
        let ancestorsCache: Promise<Array<{ uid: string; path: string }>> | null = null;
        const descriptor = {
            path,
            resolveAncestors () {
                if ( ! ancestorsCache ) {
                    ancestorsCache = fsEntryService.getAncestorChain(path);
                }
                return ancestorsCache;
            },
        };
        const allowed = await this.services.acl.check(actor, descriptor, mode);
        if ( allowed ) return;
        const safe = await this.services.acl.getSafeAclError(actor, descriptor, mode) as {
            status?: unknown; message?: unknown; fields?: { code?: unknown };
        };
        const status = Number(safe?.status);
        const message = typeof safe?.message === 'string' && safe.message.length > 0 ? safe.message : 'Access denied';
        const code = typeof safe?.fields?.code === 'string' ? safe.fields.code : undefined;
        const legacyCode = code === 'forbidden' ? 'access_denied' : code;
        if ( status === 404 ) {
            throw new HttpError(404, message, { ...(legacyCode ? { legacyCode } : {}) });
        }
        throw new HttpError(403, message, { legacyCode: legacyCode ?? 'access_denied' });
    }

    async #fetchSubdomainsForEntry (entry: FSEntry): Promise<unknown[]> {
        const subdomainStore = this.stores.subdomain as unknown as {
            listByRootDirUid?: (uid: string) => Promise<unknown[]>;
            listByUserId?: (id: number) => Promise<unknown[]>;
        };
        if ( typeof subdomainStore?.listByRootDirUid === 'function' ) {
            try {
                return await subdomainStore.listByRootDirUid(entry.uuid) ?? [];
            } catch {
                return [];
            }
        }
        return [];
    }

    #toNumberOrUndefined (value: unknown): number | undefined {
        if ( typeof value === 'number' && Number.isFinite(value) ) return value;
        if ( typeof value === 'string' && value.trim().length > 0 ) {
            const parsed = Number(value);
            if ( Number.isFinite(parsed) ) return parsed;
        }
        return undefined;
    }

    // Accepts loose inputs from route bodies. `source`/`destination` fields may
    // arrive as a plain string (= path) or an object of { path | uid | id }.
    #extractNodeRef (value: unknown): Record<string, unknown> {
        if ( typeof value === 'string' ) return { path: value };
        if ( value && typeof value === 'object' && !Array.isArray(value) ) {
            return value as Record<string, unknown>;
        }
        return {};
    }

    // Fire-and-forget GUI events for single-entry mutations. These feed the
    // desktop cache invalidator and extension listeners (e.g. thumbnails).
    #emitGuiItemAdded (entry: FSEntry): void {
        void this.#emitGuiWriteEvent('outer.gui.item.added', entry, undefined)
            .catch(() => undefined);
    }

    #emitGuiItemUpdated (entry: FSEntry): void {
        void this.#emitGuiWriteEvent('outer.gui.item.updated', entry, undefined)
            .catch(() => undefined);
    }

    #emitGuiItemRemoved (entry: FSEntry): void {
        // GUI listens for `outer.gui.item.removed`; same envelope shape.
        void (async () => {
            try {
                await this.clients.event.emit('outer.gui.item.removed', {
                    user_id_list: [entry.userId],
                    response: { ...entry, from_new_service: true },
                }, {});
            } catch {
                // ignore — non-critical.
            }
        })();
    }

    #emitGuiItemMoved (source: FSEntry, moved: FSEntry): void {
        void (async () => {
            try {
                await this.clients.event.emit('outer.gui.item.moved', {
                    user_id_list: [moved.userId],
                    response: {
                        ...moved,
                        from_path: source.path,
                        from_new_service: true,
                    },
                }, {});
            } catch {
                // ignore — non-critical.
            }
        })();
    }

    #getActorUserId (
        req: Request,
    ): number {
        const requestUser = (req as Request & {
            user?: {
                id?: unknown;
            };
        }).user;
        const actorUser = req.actor?.user;
        const candidateUserId = requestUser?.id ?? actorUser?.id;
        if ( candidateUserId === undefined || candidateUserId === null ) {
            throw new HttpError(401, 'Unauthorized');
        }

        const userId = Number(candidateUserId);
        if ( Number.isNaN(userId) ) {
            throw new HttpError(401, 'Unauthorized');
        }

        return userId;
    }

    #getActorUsername (
        req: Request,
    ): string {
        const requestUser = (req as Request & {
            user?: {
                username?: unknown;
            };
        }).user;
        const actorUser = req.actor?.user;
        const actorUsername = requestUser?.username ?? actorUser?.username;
        if ( typeof actorUsername !== 'string' || actorUsername.trim().length === 0 ) {
            throw new HttpError(401, 'Unauthorized');
        }
        return actorUsername.trim();
    }

    #toObjectRecord (value: unknown): Record<string, unknown> {
        if ( !value || typeof value !== 'object' || Array.isArray(value) ) {
            return {};
        }
        return value as Record<string, unknown>;
    }

    #firstDefined (...values: unknown[]): unknown {
        for ( const value of values ) {
            if ( value !== undefined && value !== null ) {
                return value;
            }
        }
        return undefined;
    }

    #toBoolean (value: unknown): boolean | undefined {
        if ( typeof value === 'boolean' ) {
            return value;
        }
        if ( typeof value === 'number' ) {
            if ( value === 1 ) return true;
            if ( value === 0 ) return false;
            return undefined;
        }
        if ( typeof value === 'string' ) {
            const normalizedValue = value.trim().toLowerCase();
            if ( ['1', 'true', 'yes', 'on'].includes(normalizedValue) ) {
                return true;
            }
            if ( ['0', 'false', 'no', 'off'].includes(normalizedValue) ) {
                return false;
            }
        }
        return undefined;
    }

    #toNumber (value: unknown): number | undefined {
        if ( value === undefined || value === null || value === '' ) {
            return undefined;
        }
        const candidate = Number(value);
        if ( ! Number.isFinite(candidate) ) {
            return undefined;
        }
        return candidate;
    }

    #isDedupeEnabled (fileMetadata: FSEntryWriteInput | undefined): boolean {
        if ( ! fileMetadata ) {
            return false;
        }
        const metadataRecord = fileMetadata as unknown as Record<string, unknown>;
        const dedupeCandidate = this.#firstDefined(
            fileMetadata.dedupeName,
            metadataRecord.dedupe_name,
        );
        return this.#toBoolean(dedupeCandidate) ?? false;
    }

    #resolveWriteFileMetadata (
        fileMetadata: FSEntryWriteInput | undefined,
        fallbackSource?: unknown,
    ): FSEntryWriteInput {
        const metadataRecord = this.#toObjectRecord(fileMetadata);
        const fallbackRecord = this.#toObjectRecord(fallbackSource);

        const normalizedFileMetadata: Record<string, unknown> = {
            ...metadataRecord,
        };

        const path = this.#firstDefined(metadataRecord.path, fallbackRecord.path);
        if ( typeof path === 'string' ) {
            normalizedFileMetadata.path = path;
        }

        const size = this.#toNumber(this.#firstDefined(metadataRecord.size, fallbackRecord.size));
        if ( size !== undefined ) {
            normalizedFileMetadata.size = size;
        }

        const contentType = this.#firstDefined(
            metadataRecord.contentType,
            metadataRecord.content_type,
            fallbackRecord.contentType,
            fallbackRecord.content_type,
        );
        if ( typeof contentType === 'string' && contentType.length > 0 ) {
            normalizedFileMetadata.contentType = contentType;
        }

        const checksumSha256 = this.#firstDefined(
            metadataRecord.checksumSha256,
            metadataRecord.checksum_sha256,
            fallbackRecord.checksumSha256,
            fallbackRecord.checksum_sha256,
        );
        if ( typeof checksumSha256 === 'string' && checksumSha256.length > 0 ) {
            normalizedFileMetadata.checksumSha256 = checksumSha256;
        }

        const overwrite = this.#toBoolean(this.#firstDefined(
            metadataRecord.overwrite,
            fallbackRecord.overwrite,
        ));
        if ( overwrite !== undefined ) {
            normalizedFileMetadata.overwrite = overwrite;
        }

        const dedupeName = this.#toBoolean(this.#firstDefined(
            metadataRecord.dedupeName,
            metadataRecord.dedupe_name,
            fallbackRecord.dedupeName,
            fallbackRecord.dedupe_name,
            fallbackRecord.rename,
            fallbackRecord.change_name,
        ));
        if ( dedupeName !== undefined ) {
            normalizedFileMetadata.dedupeName = dedupeName;
        }

        const createMissingParents = this.#toBoolean(this.#firstDefined(
            metadataRecord.createMissingParents,
            metadataRecord.create_missing_parents,
            metadataRecord.create_missing_ancestors,
            fallbackRecord.createMissingParents,
            fallbackRecord.create_missing_parents,
            fallbackRecord.createMissingAncestors,
            fallbackRecord.create_missing_ancestors,
            fallbackRecord.createFileParent,
            fallbackRecord.create_file_parent,
        ));
        if ( createMissingParents !== undefined ) {
            normalizedFileMetadata.createMissingParents = createMissingParents;
        }

        const immutable = this.#toBoolean(this.#firstDefined(
            metadataRecord.immutable,
            fallbackRecord.immutable,
        ));
        if ( immutable !== undefined ) {
            normalizedFileMetadata.immutable = immutable;
        }

        const isPublic = this.#toBoolean(this.#firstDefined(
            metadataRecord.isPublic,
            metadataRecord.is_public,
            fallbackRecord.isPublic,
            fallbackRecord.is_public,
        ));
        if ( isPublic !== undefined ) {
            normalizedFileMetadata.isPublic = isPublic;
        }

        const multipartPartSize = this.#toNumber(this.#firstDefined(
            metadataRecord.multipartPartSize,
            metadataRecord.multipart_part_size,
            fallbackRecord.multipartPartSize,
            fallbackRecord.multipart_part_size,
        ));
        if ( multipartPartSize !== undefined && multipartPartSize > 0 ) {
            normalizedFileMetadata.multipartPartSize = multipartPartSize;
        }

        const bucket = this.#firstDefined(metadataRecord.bucket, fallbackRecord.bucket);
        if ( typeof bucket === 'string' && bucket.length > 0 ) {
            normalizedFileMetadata.bucket = bucket;
        }

        const bucketRegion = this.#firstDefined(
            metadataRecord.bucketRegion,
            metadataRecord.bucket_region,
            fallbackRecord.bucketRegion,
            fallbackRecord.bucket_region,
        );
        if ( typeof bucketRegion === 'string' && bucketRegion.length > 0 ) {
            normalizedFileMetadata.bucketRegion = bucketRegion;
        }

        const associatedAppId = this.#toNumber(this.#firstDefined(
            metadataRecord.associatedAppId,
            metadataRecord.associated_app_id,
            fallbackRecord.associatedAppId,
            fallbackRecord.associated_app_id,
        ));
        if ( associatedAppId !== undefined ) {
            normalizedFileMetadata.associatedAppId = associatedAppId;
        }

        return normalizedFileMetadata as unknown as FSEntryWriteInput;
    }

    async #resolveAssociatedAppMetadata (
        fileMetadata: FSEntryWriteInput,
        fallbackSource?: unknown,
        appUidLookupCache?: Map<string, Promise<number | null>>,
    ): Promise<FSEntryWriteInput> {
        const metadataRecord = this.#toObjectRecord(fileMetadata);
        const fallbackRecord = this.#toObjectRecord(fallbackSource);

        const associatedAppId = this.#toNumber(this.#firstDefined(
            metadataRecord.associatedAppId,
            metadataRecord.associated_app_id,
            fallbackRecord.associatedAppId,
            fallbackRecord.associated_app_id,
        ));
        if ( associatedAppId !== undefined ) {
            return {
                ...fileMetadata,
                associatedAppId,
            };
        }

        const appUid = this.#firstDefined(
            metadataRecord.appUID,
            metadataRecord.appUid,
            metadataRecord.app_uid,
            fallbackRecord.appUID,
            fallbackRecord.appUid,
            fallbackRecord.app_uid,
        );
        if ( typeof appUid !== 'string' || appUid.trim().length === 0 ) {
            return fileMetadata;
        }

        const normalizedAppUid = appUid.trim();
        const lookupPromise = (() => {
            const cachedLookup = appUidLookupCache?.get(normalizedAppUid);
            if ( cachedLookup ) {
                return cachedLookup;
            }

            const createdLookupPromise = (async () => {
                const app = await this.stores.app.getByUid(normalizedAppUid);
                return this.#toNumber(app?.id) ?? null;
            })();
            appUidLookupCache?.set(normalizedAppUid, createdLookupPromise);
            return createdLookupPromise;
        })();

        const resolvedAppId = await lookupPromise;
        if ( resolvedAppId === null ) {
            return fileMetadata;
        }
        return {
            ...fileMetadata,
            associatedAppId: resolvedAppId,
        };
    }

    #toStorageCapacityCandidate (value: unknown): number | undefined {
        const capacity = Number(value);
        if ( !Number.isFinite(capacity) || capacity < 0 ) {
            return undefined;
        }
        return capacity;
    }

    #getStorageAllowanceMaxOverride (req: Request): number | undefined {
        // free_storage / actual_free_storage are user-row fields not on
        // the ActorUser type. Access via the escape hatch until a proper
        // storage-quota mechanism is in place.
        const actorUser = req.actor?.user as Record<string, unknown> | undefined;

        const candidates = [
            this.#toStorageCapacityCandidate(actorUser?.free_storage),
            this.#toStorageCapacityCandidate(actorUser?.actual_free_storage),
        ].filter((candidate): candidate is number => candidate !== undefined);

        if ( candidates.length === 0 ) {
            return undefined;
        }
        return Math.max(...candidates);
    }

    #normalizePath (path: string, username?: string): string {
        const trimmedPath = path.trim();
        if ( trimmedPath.length === 0 ) {
            throw new HttpError(400, 'Path cannot be empty');
        }

        let pathToNormalize = trimmedPath;
        if ( pathToNormalize === '~' || pathToNormalize.startsWith('~/') ) {
            if ( ! username ) {
                throw new HttpError(400, 'Unable to resolve home path');
            }

            pathToNormalize = `/${username}${pathToNormalize.slice(1)}`;
        }

        let normalizedPath = pathPosix.normalize(pathToNormalize);
        if ( ! normalizedPath.startsWith('/') ) {
            normalizedPath = `/${normalizedPath}`;
        }
        if ( normalizedPath.length > 1 && normalizedPath.endsWith('/') ) {
            normalizedPath = normalizedPath.slice(0, -1);
        }
        return normalizedPath;
    }

    #normalizeFileMetadataPath (
        req: Request,
        fileMetadata: FSEntryWriteInput | undefined,
        fallbackSource?: unknown,
    ): FSEntryWriteInput {
        const resolvedFileMetadata = this.#resolveWriteFileMetadata(fileMetadata, fallbackSource);
        if ( typeof resolvedFileMetadata.path !== 'string' ) {
            throw new HttpError(400, 'Missing path');
        }

        const username = this.#getActorUsername(req);
        return {
            ...resolvedFileMetadata,
            path: this.#normalizePath(resolvedFileMetadata.path, username),
        };
    }

    #extractGuiMetadata (input: unknown, fallback: WriteGuiMetadata | undefined): WriteGuiMetadata | undefined {
        const source = input && typeof input === 'object'
            ? input as Record<string, unknown>
            : {};
        const guiMetadata: WriteGuiMetadata = {
            originalClientSocketId: typeof source.originalClientSocketId === 'string'
                ? source.originalClientSocketId
                : typeof source.original_client_socket_id === 'string'
                    ? source.original_client_socket_id
                    : fallback?.originalClientSocketId,
            socketId: typeof source.socketId === 'string'
                ? source.socketId
                : typeof source.socket_id === 'string'
                    ? source.socket_id
                    : fallback?.socketId,
            operationId: typeof source.operationId === 'string'
                ? source.operationId
                : typeof source.operation_id === 'string'
                    ? source.operation_id
                    : fallback?.operationId,
            itemUploadId: typeof source.itemUploadId === 'string'
                ? source.itemUploadId
                : typeof source.item_upload_id === 'string'
                    ? source.item_upload_id
                    : fallback?.itemUploadId,
        };

        if (
            !guiMetadata.originalClientSocketId
            && !guiMetadata.socketId
            && !guiMetadata.operationId
            && !guiMetadata.itemUploadId
        ) {
            return undefined;
        }
        return guiMetadata;
    }

    #withGuiMetadata<T extends { guiMetadata?: WriteGuiMetadata }> (value: T, fallbackSource: unknown): T {
        const guiMetadata = this.#extractGuiMetadata(value, this.#extractGuiMetadata(fallbackSource, undefined));
        if ( ! guiMetadata ) {
            return value;
        }
        return {
            ...value,
            guiMetadata,
        };
    }

    async #assertWriteAccess (
        req: Request,
        fileMetadata: FSEntryWriteInput | undefined,
        options?: {
            pathAlreadyNormalized?: boolean;
        },
    ): Promise<void> {
        const actor = req.actor;
        if ( ! actor ) {
            throw new HttpError(401, 'Unauthorized');
        }
        const normalizedFileMetadata = options?.pathAlreadyNormalized
            ? fileMetadata
            : this.#normalizeFileMetadataPath(req, fileMetadata);
        if ( ! normalizedFileMetadata ) {
            throw new HttpError(400, 'Missing path');
        }

        const targetPath = normalizedFileMetadata.path;
        if ( targetPath === '/' ) {
            throw new HttpError(400, 'Cannot write to root path');
        }
        const parentPath = pathPosix.dirname(targetPath);
        if ( parentPath === '/' ) {
            throw new HttpError(400, 'Cannot write to root path');
        }

        const dedupeEnabled = this.#isDedupeEnabled(normalizedFileMetadata);
        let pathToCheck = parentPath;
        if ( Boolean(normalizedFileMetadata.overwrite) && !dedupeEnabled ) {
            const destinationExists = await this.services.fsEntry.entryExistsByPath(targetPath);
            if ( destinationExists ) {
                pathToCheck = targetPath;
            }
        }

        const fsEntryService = this.services.fsEntry;
        let ancestorsCache: Promise<Array<{ uid: string; path: string }>> | null = null;
        const resourceDescriptor = {
            path: pathToCheck,
            resolveAncestors () {
                if ( ! ancestorsCache ) {
                    ancestorsCache = fsEntryService.getAncestorChain(pathToCheck);
                }
                return ancestorsCache;
            },
        };

        const canWrite = await this.services.acl.check(actor, resourceDescriptor, 'write');
        if ( canWrite ) {
            return;
        }

        const safeAclError = await this.services.acl.getSafeAclError(actor, resourceDescriptor, 'write') as {
            status?: unknown;
            message?: unknown;
            fields?: {
                code?: unknown;
            };
        };
        const safeAclStatus = Number(safeAclError?.status);
        const safeAclMessage = typeof safeAclError?.message === 'string' && safeAclError.message.length > 0
            ? safeAclError.message
            : 'Write access denied for destination';
        const safeAclCode = typeof safeAclError?.fields?.code === 'string'
            ? safeAclError.fields.code
            : undefined;
        const legacyCode = safeAclCode === 'forbidden'
            ? 'access_denied'
            : safeAclCode;

        if ( safeAclStatus === 404 ) {
            throw new HttpError(404, safeAclMessage, {
                ...(legacyCode ? { legacyCode } : {}),
            });
        }

        throw new HttpError(403, safeAclMessage, {
            legacyCode: legacyCode ?? 'access_denied',
        });
    }

    async #assertBatchWriteAccess (
        req: Request,
        fileMetadataItems: Array<FSEntryWriteInput | undefined>,
        options?: {
            pathAlreadyNormalized?: boolean;
            concurrency?: number;
        },
    ): Promise<void> {
        await runWithConcurrencyLimit(
            fileMetadataItems,
            options?.concurrency ?? DEFAULT_BATCH_ACL_CHECK_CONCURRENCY,
            async (fileMetadata) => {
                await this.#assertWriteAccess(req, fileMetadata, {
                    pathAlreadyNormalized: options?.pathAlreadyNormalized,
                });
            },
        );
    }

    #toEventGuiMetadata (
        guiMetadata: WriteGuiMetadata | undefined,
        includeOriginalClientSocketId = true,
    ): Record<string, unknown> {
        if ( ! guiMetadata ) {
            return {};
        }

        return {
            ...(includeOriginalClientSocketId && guiMetadata.originalClientSocketId
                ? { original_client_socket_id: guiMetadata.originalClientSocketId }
                : {}),
            ...(guiMetadata.socketId ? { socket_id: guiMetadata.socketId } : {}),
            ...(guiMetadata.operationId ? { operation_id: guiMetadata.operationId } : {}),
            ...(guiMetadata.itemUploadId ? { item_upload_id: guiMetadata.itemUploadId } : {}),
        };
    }

    async #toGuiFsEntry (entry: FSEntry): Promise<Record<string, unknown>> {
        const dirpath = pathPosix.dirname(entry.path);
        const extension = pathPosix.extname(entry.name).slice(1).toLowerCase();
        const response = {
            id: entry.uuid,
            uid: entry.uuid,
            uuid: entry.uuid,
            user_id: entry.userId,
            parent_id: entry.parentUid,
            parent_uid: entry.parentUid,
            path: entry.path,
            dirname: dirpath,
            dirpath,
            name: entry.name,
            is_dir: entry.isDir,
            is_shortcut: entry.isShortcut ? 1 : 0,
            shortcut_to: entry.shortcutTo,
            type: entry.isDir ? 'folder' : extension,
            writable: true,
            is_public: entry.isPublic,
            thumbnail: entry.thumbnail,
            immutable: entry.immutable,
            metadata: entry.metadata,
            modified: entry.modified,
            created: entry.created,
            accessed: entry.accessed,
            size: entry.size,
            associated_app_id: entry.associatedAppId,
        };

        if ( typeof response.thumbnail === 'string' && response.thumbnail.length > 0 ) {
            const thumbnailEntry = {
                uuid: entry.uuid,
                thumbnail: response.thumbnail,
            };
            await this.clients.event.emit('thumbnail.read', thumbnailEntry, {});
            response.thumbnail = typeof thumbnailEntry.thumbnail === 'string' && thumbnailEntry.thumbnail.length > 0
                ? thumbnailEntry.thumbnail
                : null;
        }

        return response;
    }

    async #emitGuiWriteEvent (
        eventName: 'outer.gui.item.added' | 'outer.gui.item.updated',
        fsEntry: FSEntry,
        guiMetadata: WriteGuiMetadata | undefined,
    ): Promise<void> {
        const response = {
            ...await this.#toGuiFsEntry(fsEntry),
            ...this.#toEventGuiMetadata(guiMetadata, false),
            from_new_service: true,
        };
        await this.clients.event.emit(eventName, {
            user_id_list: [fsEntry.userId],
            response,
        }, {});
    }

    async #emitGuiPendingWriteEvent (
        userId: number,
        requestBody: SignedWriteRequest,
        response: SignedWriteResponse,
    ): Promise<void> {
        const normalizedPath = this.#normalizePath(requestBody.fileMetadata.path);
        const pendingResponse = {
            id: response.objectKey,
            uid: response.objectKey,
            uuid: response.objectKey,
            user_id: userId,
            path: normalizedPath,
            name: pathPosix.basename(normalizedPath),
            is_dir: false,
            content_type: response.contentType,
            size: Number(requestBody.fileMetadata.size),
            upload_id: response.sessionId,
            pending_upload: true,
            status: 'pending',
            ...this.#toEventGuiMetadata(requestBody.guiMetadata),
            from_new_service: true,
        };
        await this.clients.event.emit('outer.gui.item.pending', {
            user_id_list: [userId],
            response: pendingResponse,
        }, {});
    }

    #isAppDataPath (targetPath: string): boolean {
        const pathParts = targetPath.split('/').filter(Boolean);
        return pathParts.length >= 2 && pathParts[1] === 'AppData';
    }

    #estimateDataUrlSize (dataUrl: string): number {
        const commaIndex = dataUrl.indexOf(',');
        const base64 = commaIndex === -1 ? dataUrl : dataUrl.slice(commaIndex + 1);
        return Math.ceil(base64.length * 3 / 4);
    }

    #isOversizedThumbnailDataUrl (thumbnail: string): boolean {
        if ( ! thumbnail.startsWith('data:') ) {
            return false;
        }
        return this.#estimateDataUrlSize(thumbnail) > MAX_THUMBNAIL_BYTES;
    }

    async #applyThumbnailAfterWrite (
        userId: number,
        fsEntry: FSEntry,
        requestedThumbnail: string | null | undefined,
    ): Promise<FSEntry> {
        if ( !requestedThumbnail || this.#isAppDataPath(fsEntry.path) ) {
            return fsEntry;
        }
        if ( this.#isOversizedThumbnailDataUrl(requestedThumbnail) ) {
            return fsEntry;
        }

        const thumbnailPayload = { url: requestedThumbnail };
        await this.clients.event.emit('thumbnail.created', thumbnailPayload, {});
        const finalThumbnail = typeof thumbnailPayload.url === 'string' && thumbnailPayload.url.length > 0
            ? thumbnailPayload.url
            : null;

        if ( finalThumbnail === fsEntry.thumbnail || finalThumbnail === null ) {
            return fsEntry;
        }

        return this.services.fsEntry.updateEntryThumbnail(userId, fsEntry.uuid, finalThumbnail);
    }

    #toThumbnailPrepareItem (
        requestBody: SignedWriteRequest,
        index: number,
    ): ThumbnailUploadPrepareItem | null {
        if ( requestBody.directory ) {
            return null;
        }

        const thumbnailMetadata = requestBody.thumbnailMetadata;
        if ( ! thumbnailMetadata ) {
            return null;
        }

        const contentType = typeof thumbnailMetadata.contentType === 'string'
            ? thumbnailMetadata.contentType.trim()
            : '';
        if ( ! contentType ) {
            throw new HttpError(400, 'thumbnailMetadata.contentType is required for signed thumbnail upload');
        }

        if ( thumbnailMetadata.size === undefined ) {
            return null;
        }

        const size = Number(thumbnailMetadata.size);
        if ( !Number.isFinite(size) || size < 0 ) {
            throw new HttpError(400, 'thumbnailMetadata.size must be a non-negative number');
        }
        if ( size > MAX_THUMBNAIL_BYTES ) {
            return null;
        }

        return { index, contentType, size };
    }

    async #attachSignedThumbnailUploadTargets (
        requests: SignedWriteRequest[],
        responses: SignedWriteResponse[],
    ): Promise<void> {
        const prepareItems = requests
            .map((requestBody, index) => this.#toThumbnailPrepareItem(requestBody, index))
            .filter((item): item is ThumbnailUploadPrepareItem => Boolean(item));
        if ( prepareItems.length === 0 ) {
            return;
        }

        const payload: ThumbnailUploadPreparePayload = {
            items: prepareItems.map((item): ThumbnailUploadPrepareItem => ({
                index: item.index,
                contentType: item.contentType,
                ...(item.size !== undefined ? { size: item.size } : {}),
            })),
        };
        await this.clients.event.emit('thumbnail.upload.prepare', payload, {});

        for ( const item of payload.items ) {
            const response = responses[item.index];
            if ( ! response ) {
                throw new HttpError(500, 'Failed to resolve signed thumbnail response target');
            }
            if ( typeof item.uploadUrl !== 'string' || item.uploadUrl.length === 0 ) {
                continue;
            }
            if ( typeof item.thumbnailUrl !== 'string' || item.thumbnailUrl.length === 0 ) {
                continue;
            }

            response.thumbnailUploadUrl = item.uploadUrl;
            response.thumbnailUrl = item.thumbnailUrl;
        }
    }

    #assertNoInlineSignedThumbnailData (thumbnailData: string | undefined): void {
        if ( typeof thumbnailData !== 'string' ) {
            return;
        }
        if ( thumbnailData.startsWith('data:') ) {
            throw new HttpError(
                400,
                'Signed write completion does not accept inline thumbnail data. Upload thumbnail to signed URL and provide thumbnail URL.',
            );
        }
    }

    #isMultipartRequest (req: Request): boolean {
        const contentType = req.headers['content-type'];
        if ( typeof contentType !== 'string' ) {
            return false;
        }
        return contentType.includes('multipart/form-data');
    }

    #resolveBatchWriteRequestMode (req: Request): 'multipart' | 'json' {
        if ( this.#isMultipartRequest(req) ) {
            return 'multipart';
        }

        const contentTypeHeader = req.headers['content-type'];
        const contentType = typeof contentTypeHeader === 'string'
            ? contentTypeHeader.toLowerCase()
            : '';

        if (
            contentType.includes('application/json')
            || contentType.startsWith('text/plain;actually=json')
        ) {
            return 'json';
        }

        throw new HttpError(
            415,
            'Unsupported content type for batchWrite. Use multipart/form-data or application/json.',
        );
    }

    async #runNonCritical (work: () => Promise<void>, operationName: string): Promise<void> {
        try {
            await work();
        } catch ( error ) {
            console.error(`prodfsv2 non-critical operation failed: ${operationName}`, error);
        }
    }

    async #createUploadTracker (
        userId: number,
        itemUid: string,
        itemPath: string,
        expectedSize: number,
        guiMetadata: WriteGuiMetadata | undefined,
    ): Promise<UploadProgressTrackerLike> {
        const uploadTracker = new UploadProgressTracker();
        uploadTracker.setTotal(Math.max(0, expectedSize));

        const context = Context.get();
        if ( ! context ) {
            return uploadTracker;
        }

        await this.clients.event.emit('fs.storage.upload-progress', {
            upload_tracker: uploadTracker,
            context,
            meta: {
                user_id: userId,
                userId: userId,
                item_uid: itemUid,
                item_path: itemPath,
                ...this.#toEventGuiMetadata(guiMetadata),
            },
        }, {});
        return uploadTracker;
    }

    async #emitWriteHashEvent (contentHashSha256: string | null | undefined, entryUuid: string): Promise<void> {
        if ( ! contentHashSha256 ) {
            return;
        }
        await this.clients.event.emit('outer.fs.write-hash', {
            hash: contentHashSha256,
            uuid: entryUuid,
        }, {});
    }

    async #applyWriteResponseSideEffects (
        userId: number,
        response: WriteResponse,
        guiMetadata: WriteGuiMetadata | undefined,
    ): Promise<WriteResponse> {
        let fsEntry = response.fsEntry;

        const hashEventPromise = this.#runNonCritical(async () => {
            await this.#emitWriteHashEvent(response.contentHashSha256, fsEntry.uuid);
        }, 'emitWriteHashEvent');

        await this.#runNonCritical(async () => {
            fsEntry = await this.#applyThumbnailAfterWrite(
                userId,
                response.fsEntry,
                response.requestedThumbnail,
            );
        }, 'applyThumbnailAfterWrite');

        await this.#runNonCritical(async () => {
            await this.#emitGuiWriteEvent(
                response.wasOverwrite ? 'outer.gui.item.updated' : 'outer.gui.item.added',
                fsEntry,
                guiMetadata,
            );
        }, 'emitGuiWriteEvent');

        await hashEventPromise;

        return { ...response, fsEntry };
    }

    #shouldIgnoreUploadPath (targetPath: string): boolean {
        return pathPosix.basename(targetPath).toLowerCase() === '.ds_store';
    }

    #parseBatchWriteManifest (
        manifestRaw: string,
        fallbackGuiMetadata: WriteGuiMetadata | undefined,
    ): ParsedMultipartBatchManifest {
        let parsedManifest: unknown;
        try {
            parsedManifest = JSON.parse(manifestRaw);
        } catch {
            throw new HttpError(400, 'Batch write manifest is not valid JSON');
        }

        const manifest: BatchWriteManifest = Array.isArray(parsedManifest)
            ? { items: parsedManifest as BatchWriteManifestItem[] }
            : parsedManifest as BatchWriteManifest;

        if ( !manifest || !Array.isArray(manifest.items) || manifest.items.length === 0 ) {
            throw new HttpError(400, 'Batch write manifest must include a non-empty items array');
        }

        const manifestGuiMetadata = this.#extractGuiMetadata(manifest, fallbackGuiMetadata);
        const normalizedItems = manifest.items.map((item, orderIndex) => {
            if ( !item || typeof item !== 'object' ) {
                throw new HttpError(400, `Batch write manifest item at position ${orderIndex} is invalid`);
            }

            const candidateIndex = (item as { index?: number | string }).index ?? orderIndex;
            const index = Number(candidateIndex);
            if ( !Number.isInteger(index) || index < 0 ) {
                throw new HttpError(400, `Batch write manifest item index is invalid at position ${orderIndex}`);
            }

            if ( !item.fileMetadata || typeof item.fileMetadata !== 'object' ) {
                throw new HttpError(400, `Batch write manifest item ${index} is missing fileMetadata`);
            }

            return {
                index,
                fileMetadata: item.fileMetadata,
                thumbnailData: typeof item.thumbnailData === 'string' ? item.thumbnailData : undefined,
                guiMetadata: this.#extractGuiMetadata(item, manifestGuiMetadata),
            };
        });

        const seenIndexes = new Set<number>();
        const fieldIndexMap = new Map<string, number>();
        for ( const item of normalizedItems ) {
            if ( seenIndexes.has(item.index) ) {
                throw new HttpError(409, `Batch write manifest has duplicate index ${item.index}`);
            }
            seenIndexes.add(item.index);
            fieldIndexMap.set(String(item.index), item.index);
            fieldIndexMap.set(`file-${item.index}`, item.index);
            fieldIndexMap.set(`files[${item.index}]`, item.index);
        }

        return {
            items: normalizedItems,
            guiMetadata: manifestGuiMetadata,
            fieldIndexMap,
            ignoredItemIndexes: new Set<number>(),
        };
    }

    #resolveMultipartFileIndex (
        fieldName: string,
        fileOrderIndex: number,
        manifest: ParsedMultipartBatchManifest,
    ): number {
        const directMatch = manifest.fieldIndexMap.get(fieldName);
        if ( directMatch !== undefined ) {
            return directMatch;
        }

        if ( /^\d+$/.test(fieldName) ) {
            const parsedIndex = Number(fieldName);
            if ( manifest.fieldIndexMap.get(String(parsedIndex)) !== undefined ) {
                return parsedIndex;
            }
        }

        if ( fieldName === 'file' || fieldName === 'files' ) {
            const itemAtPosition = manifest.items[fileOrderIndex];
            if ( itemAtPosition ) {
                return itemAtPosition.index;
            }
        }

        const fallbackItem = manifest.items[fileOrderIndex];
        if ( fallbackItem ) {
            return fallbackItem.index;
        }

        throw new HttpError(400, `Batch write file part "${fieldName}" does not map to manifest metadata`);
    }

}
