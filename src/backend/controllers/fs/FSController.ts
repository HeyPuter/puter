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

import Busboy from 'busboy';
import type { Request, Response } from 'express';
import { posix as pathPosix } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Actor } from '../../core/actor.js';
import { Context } from '../../core/context.js';
import { HttpError } from '../../core/http/HttpError.js';
import { Controller, Get, Post } from '../../core/http/decorators.js';
import { assertNormalized } from '../../services/fs/resolveNode.js';
import type {
    PreparedBatchWrite,
    UploadedBatchWriteItem,
    UploadProgressTrackerLike,
} from '../../services/fs/types.js';
import type { FSEntry, FSEntryWriteInput } from '../../stores/fs/FSEntry.js';
import {
    runWithConcurrencyLimit,
    runWithConcurrencyLimitSettled,
} from '../../util/concurrency.js';
import { applyInlineContentSecurity } from '../../util/inlineContentSecurity.js';
import { PuterController } from '../types.js';
import { STORAGE_OP_COSTS } from '../../services/metering/costs.js';
import {
    FS_MULTIPART_LIMIT,
    FS_MUTATE_LIMIT,
    FS_READ_CONCURRENT,
    FS_READ_LIMIT,
    FS_READDIR_LIMIT,
    FS_SEARCH_CONCURRENT,
    FS_SEARCH_LIMIT,
    FS_STAT_LIMIT,
    FS_WRITE_CONCURRENT,
    FS_WRITE_LIMIT,
} from './limits.js';
import {
    assertAccess as assertLegacyAccess,
    fsEntryMimeType,
    loadLegacyAssociatedApps,
    signEntryThumbnail,
    toLegacyEntry,
} from './legacyFsHelpers.js';
import type {
    ClientCompleteWriteResponse,
    ClientFSEntry,
    ClientReaddirEntry,
    ClientSignedWriteResponse,
    ClientSignMultipartPartsResponse,
    ClientWriteResponse,
    CompleteWriteRequest,
    SignedWriteRequest,
    SignedWriteResponse,
    SignMultipartPartsRequest,
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

    setTotal(value: number) {
        this.total = value;
    }

    add(amount: number) {
        this.progress += amount;
        for (const listener of this.#listeners) {
            listener(amount);
        }
    }

    subscribe(callback: (delta: number) => void) {
        this.#listeners.push(callback);
        return {
            detach: () => {
                const idx = this.#listeners.indexOf(callback);
                if (idx !== -1) this.#listeners.splice(idx, 1);
            },
        };
    }
}

const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;
// Hard cap on how many levels below the target a recursive readdir descends.
const MAX_READDIR_DEPTH = 10;
const DEFAULT_BATCH_ACL_CHECK_CONCURRENCY = 32;
const DEFAULT_BATCH_WRITE_SIDE_EFFECT_CONCURRENCY = 8;

@Controller('/fs')
export class FSController extends PuterController {
    // Object-store requests are reported here because the filesystem is what
    // makes them. Bytes leaving the server are not: they are metered for every
    // response, so `MeteringService` prices them.
    override getReportedCosts() {
        return Object.entries(STORAGE_OP_COSTS).map(
            ([usageType, ucentsPerUnit]) => ({
                usageType,
                ucentsPerUnit,
                unit: 'operation',
                source: 'controller:fs',
            }),
        );
    }

    @Post('/startWrite', {
        subdomain: 'api',
        requireVerified: true,
        requireCredits: true,
        rateLimit: FS_MULTIPART_LIMIT,
    })
    async startWrite(
        req: Request<RouteParams, null, SignedWriteRequest>,
        res: Response<ClientSignedWriteResponse>,
    ) {
        const userId = this.#getActorUserId(req);
        const storageAllowanceMax = this.#getStorageAllowanceMaxOverride(req);
        const requestBody = this.#withGuiMetadata(req.body, req.body);
        requestBody.fileMetadata = this.#normalizeFileMetadataPath(
            req,
            requestBody.fileMetadata,
            requestBody,
        );
        requestBody.fileMetadata = await this.#resolveAssociatedAppMetadata(
            requestBody.fileMetadata,
            requestBody,
            undefined,
            userId,
        );
        await this.#assertWriteAccess(req, requestBody.fileMetadata, {
            pathAlreadyNormalized: true,
        });

        const { response, createdDirectoryEntries } =
            await this.services.fs.startUrlWriteWithCreatedDirectories(
                userId,
                requestBody,
                storageAllowanceMax,
            );
        await this.#attachSignedThumbnailUploadTargets(
            [requestBody],
            [response],
        );
        if (!requestBody.directory) {
            await this.#runNonCritical(async () => {
                await this.#emitGuiPendingWriteEvent(
                    userId,
                    requestBody,
                    response,
                );
            }, 'emitStartWritePendingEvent');
        }
        if (createdDirectoryEntries.length > 0) {
            void this.#runNonCritical(async () => {
                for (const createdDirectoryEntry of createdDirectoryEntries) {
                    await this.#emitGuiWriteEvent(
                        'outer.gui.item.added',
                        createdDirectoryEntry,
                        requestBody.guiMetadata,
                    );
                }
            }, 'emitStartWriteDirectoryEvents');
        }
        res.json(
            this.#withoutStorageInternals(this.#withClientFsEntry(response)),
        );
    }

    @Post('/startBatchWrite', {
        subdomain: 'api',
        requireVerified: true,
        requireCredits: true,
        rateLimit: FS_MULTIPART_LIMIT,
    })
    async startBatchWrites(
        req: Request<RouteParams, null, SignedWriteRequest[]>,
        res: Response<ClientSignedWriteResponse[]>,
    ) {
        const userId = this.#getActorUserId(req);
        const storageAllowanceMax = this.#getStorageAllowanceMaxOverride(req);
        const appUidLookupCache = new Map<string, Promise<number | null>>();
        const requests = Array.isArray(req.body)
            ? await Promise.all(
                  req.body.map(async (requestBody) => {
                      const normalizedRequestBody = this.#withGuiMetadata(
                          requestBody,
                          req.body,
                      );
                      normalizedRequestBody.fileMetadata =
                          this.#normalizeFileMetadataPath(
                              req,
                              normalizedRequestBody.fileMetadata,
                              normalizedRequestBody,
                          );
                      normalizedRequestBody.fileMetadata =
                          await this.#resolveAssociatedAppMetadata(
                              normalizedRequestBody.fileMetadata,
                              normalizedRequestBody,
                              appUidLookupCache,
                              userId,
                          );
                      return normalizedRequestBody;
                  }),
              )
            : [];
        await this.#assertBatchWriteAccess(
            req,
            requests.map((requestBody) => requestBody.fileMetadata),
            { pathAlreadyNormalized: true },
        );

        const { responses, createdDirectoryEntries } =
            await this.services.fs.batchStartUrlWritesWithCreatedDirectories(
                userId,
                requests,
                storageAllowanceMax,
            );
        const directoryGuiMetadataByPath = new Map<
            string,
            WriteGuiMetadata | undefined
        >(
            requests
                .filter((request) => request.directory)
                .map((request) => [
                    request.fileMetadata.path,
                    request.guiMetadata,
                ]),
        );
        const emittedDirectoryPaths = new Set<string>();

        await this.#attachSignedThumbnailUploadTargets(requests, responses);
        await this.#runNonCritical(async () => {
            await runWithConcurrencyLimit(
                responses,
                32,
                async (writeResponse, index) => {
                    const requestBody = requests[index];
                    if (requestBody && writeResponse) {
                        if (!requestBody.directory) {
                            await this.#emitGuiPendingWriteEvent(
                                userId,
                                requestBody,
                                writeResponse,
                            );
                        }
                    }
                },
            );
        }, 'emitStartBatchWritePendingEvents');
        if (createdDirectoryEntries.length > 0) {
            void this.#runNonCritical(async () => {
                for (const createdDirectoryEntry of createdDirectoryEntries) {
                    if (emittedDirectoryPaths.has(createdDirectoryEntry.path)) {
                        continue;
                    }
                    emittedDirectoryPaths.add(createdDirectoryEntry.path);
                    await this.#emitGuiWriteEvent(
                        'outer.gui.item.added',
                        createdDirectoryEntry,
                        directoryGuiMetadataByPath.get(
                            createdDirectoryEntry.path,
                        ),
                    );
                }
            }, 'emitStartBatchWriteDirectoryEvents');
        }
        res.json(
            responses.map((r) =>
                this.#withoutStorageInternals(this.#withClientFsEntry(r)),
            ),
        );
    }

    @Post('/completeWrite', {
        subdomain: 'api',
        requireVerified: true,
        requireCredits: true,
        rateLimit: FS_MULTIPART_LIMIT,
    })
    async completeWrite(
        req: Request<RouteParams, null, CompleteWriteRequest>,
        res: Response<ClientCompleteWriteResponse>,
    ) {
        const userId = this.#getActorUserId(req);
        const requestBody = this.#withGuiMetadata(req.body, req.body);
        this.#assertNoInlineSignedThumbnailData(requestBody.thumbnailData);

        const response = await this.services.fs.completeUrlWrite(
            userId,
            requestBody,
        );
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
        res.json(
            this.#withRequiredClientFsEntry({
                ...response,
                fsEntry: writeResponse.fsEntry,
            }),
        );
    }

    @Post('/completeBatchWrite', {
        subdomain: 'api',
        requireVerified: true,
        requireCredits: true,
        rateLimit: FS_MULTIPART_LIMIT,
    })
    async completeBatchWrites(
        req: Request<RouteParams, null, CompleteWriteRequest[]>,
        res: Response<ClientCompleteWriteResponse[]>,
    ) {
        const userId = this.#getActorUserId(req);
        const requests = Array.isArray(req.body)
            ? req.body.map((requestBody) => {
                  return this.#withGuiMetadata(requestBody, req.body);
              })
            : [];
        for (const requestBody of requests) {
            this.#assertNoInlineSignedThumbnailData(requestBody.thumbnailData);
        }
        const response = await this.services.fs.batchCompleteUrlWrite(
            userId,
            requests,
        );
        const updatedResponse = await runWithConcurrencyLimit(
            response,
            DEFAULT_BATCH_WRITE_SIDE_EFFECT_CONCURRENCY,
            async (writeResponse, index) => {
                const requestBody = requests[index];
                const withSideEffects =
                    await this.#applyWriteResponseSideEffects(
                        userId,
                        {
                            fsEntry: writeResponse.fsEntry,
                            wasOverwrite: writeResponse.wasOverwrite,
                            requestedThumbnail:
                                writeResponse.requestedThumbnail,
                            contentHashSha256: null,
                        },
                        requestBody?.guiMetadata,
                    );
                return { ...writeResponse, fsEntry: withSideEffects.fsEntry };
            },
        );
        res.json(
            updatedResponse.map((r) => this.#withRequiredClientFsEntry(r)),
        );
    }

    @Post('/abortWrite', {
        subdomain: 'api',
        requireVerified: true,
        rateLimit: FS_MULTIPART_LIMIT,
    })
    async abortWrite(
        req: Request<RouteParams, null, AbortWriteRequest>,
        res: Response<{ ok: true }>,
    ) {
        const userId = this.#getActorUserId(req);
        if (!req.body?.uploadId) {
            throw new HttpError(400, 'Missing uploadId', {
                legacyCode: 'bad_request',
            });
        }

        await this.services.fs.abortUrlWrite(userId, req.body.uploadId);
        res.json({ ok: true });
    }

    @Post('/signMultipartParts', {
        subdomain: 'api',
        requireVerified: true,
        requireCredits: true,
        rateLimit: FS_MULTIPART_LIMIT,
    })
    async signMultipartParts(
        req: Request<RouteParams, null, SignMultipartPartsRequest>,
        res: Response<ClientSignMultipartPartsResponse>,
    ) {
        const userId = this.#getActorUserId(req);
        const response = await this.services.fs.signMultipartParts(
            userId,
            req.body,
        );
        res.json(this.#withoutStorageInternals(response));
    }

    @Post('/write', {
        subdomain: 'api',
        requireVerified: true,
        requireCredits: true,
        rateLimit: FS_WRITE_LIMIT,
        concurrent: FS_WRITE_CONCURRENT,
    })
    async write(
        req: Request<RouteParams, null, WriteRequest>,
        res: Response<ClientWriteResponse>,
    ) {
        const userId = this.#getActorUserId(req);
        const storageAllowanceMax = this.#getStorageAllowanceMaxOverride(req);
        const requestBody = this.#withGuiMetadata(req.body, req.body);
        requestBody.fileMetadata = this.#normalizeFileMetadataPath(
            req,
            requestBody.fileMetadata,
            requestBody,
        );
        requestBody.fileMetadata = await this.#resolveAssociatedAppMetadata(
            requestBody.fileMetadata,
            requestBody,
            undefined,
            userId,
        );
        await this.#assertWriteAccess(req, requestBody.fileMetadata, {
            pathAlreadyNormalized: true,
        });
        const normalizedPath = this.#normalizePath(
            requestBody.fileMetadata.path,
        );
        const uploadTracker = await this.#createUploadTracker(
            userId,
            normalizedPath,
            normalizedPath,
            Number(requestBody.fileMetadata.size ?? 0),
            requestBody.guiMetadata,
        );
        const response = await this.services.fs.write(
            userId,
            requestBody,
            uploadTracker,
            storageAllowanceMax,
        );
        const updatedResponse = await this.#applyWriteResponseSideEffects(
            userId,
            response,
            requestBody.guiMetadata,
        );
        res.json(this.#withRequiredClientFsEntry(updatedResponse));
    }

    @Post('/batchWrite', {
        subdomain: 'api',
        requireVerified: true,
        requireCredits: true,
        rateLimit: FS_WRITE_LIMIT,
        concurrent: FS_WRITE_CONCURRENT,
    })
    async batchWrites(
        req: Request<RouteParams, null, WriteRequest[]>,
        res: Response<ClientWriteResponse[]>,
    ) {
        const userId = this.#getActorUserId(req);
        const storageAllowanceMax = this.#getStorageAllowanceMaxOverride(req);
        const requestMode = this.#resolveBatchWriteRequestMode(req);
        const appUidLookupCache = new Map<string, Promise<number | null>>();
        if (requestMode === 'multipart') {
            let parsedManifest: ParsedMultipartBatchManifest | null = null;
            let preparedBatch: PreparedBatchWrite | null = null;
            let manifestPreparationPromise: Promise<void> | null = null;
            let parseFailure: Error | null = null;
            const uploadPromises: Promise<UploadedBatchWriteItem | null>[] = [];
            const uploadedIndexes = new Set<number>();
            // Manifest indexes are client-chosen and may skip values (an
            // ignored `.DS_Store`, or a sparse numbering). `prepareBatchWrites`
            // re-indexes by array position, so the two spaces have to be
            // bridged explicitly or file parts get paired with the wrong item.
            const preparedIndexByManifestIndex = new Map<number, number>();
            let fileOrderIndex = 0;

            const failParse = (error: unknown) => {
                if (parseFailure) {
                    return;
                }
                if (error instanceof Error) {
                    parseFailure = error;
                    return;
                }
                parseFailure = new Error(String(error));
            };

            const busboy = Busboy({ headers: req.headers });

            busboy.on('field', (fieldName, value, info) => {
                if (
                    (info as unknown as { filenameTruncated: string })
                        .filenameTruncated ||
                    info.nameTruncated ||
                    info.valueTruncated
                ) {
                    failParse(
                        new HttpError(
                            400,
                            'Batch write manifest field is truncated',
                            { legacyCode: 'bad_request' },
                        ),
                    );
                    return;
                }
                if (fieldName !== 'manifest') {
                    return;
                }
                if (manifestPreparationPromise) {
                    failParse(
                        new HttpError(
                            409,
                            'Batch write manifest was provided more than once',
                            { legacyCode: 'conflict' },
                        ),
                    );
                    return;
                }

                try {
                    parsedManifest = this.#parseBatchWriteManifest(
                        value,
                        undefined,
                    );
                    const ignoredItemIndexes = new Set<number>();
                    parsedManifest = {
                        ...parsedManifest,
                        items: parsedManifest.items.map((item) => ({
                            ...item,
                            fileMetadata: this.#normalizeFileMetadataPath(
                                req,
                                item.fileMetadata,
                                item,
                            ),
                        })),
                        ignoredItemIndexes,
                    };
                    for (const item of parsedManifest.items) {
                        if (
                            this.#shouldIgnoreUploadPath(item.fileMetadata.path)
                        ) {
                            ignoredItemIndexes.add(item.index);
                        }
                    }
                    manifestPreparationPromise = (async () => {
                        try {
                            if (!parsedManifest) {
                                throw new HttpError(
                                    400,
                                    'Batch write manifest is missing',
                                    { legacyCode: 'bad_request' },
                                );
                            }
                            parsedManifest = {
                                ...parsedManifest,
                                items: await Promise.all(
                                    parsedManifest.items.map(async (item) => ({
                                        ...item,
                                        fileMetadata:
                                            await this.#resolveAssociatedAppMetadata(
                                                item.fileMetadata,
                                                item,
                                                appUidLookupCache,
                                                userId,
                                            ),
                                    })),
                                ),
                            };
                            const activeManifestItems =
                                parsedManifest.items.filter(
                                    (item) =>
                                        !parsedManifest?.ignoredItemIndexes?.has(
                                            item.index,
                                        ),
                                );

                            await this.#assertBatchWriteAccess(
                                req,
                                activeManifestItems.map(
                                    (item) => item.fileMetadata,
                                ),
                                { pathAlreadyNormalized: true },
                            );

                            activeManifestItems.forEach((item, position) => {
                                preparedIndexByManifestIndex.set(
                                    item.index,
                                    position,
                                );
                            });
                            preparedBatch =
                                await this.services.fs.prepareBatchWrites(
                                    userId,
                                    activeManifestItems.map((item) => ({
                                        fileMetadata: item.fileMetadata,
                                        thumbnailData: item.thumbnailData,
                                        guiMetadata: item.guiMetadata,
                                    })),
                                    storageAllowanceMax,
                                );
                            await this.services.fs.assertStorageAllowanceForPreparedBatch(
                                preparedBatch,
                                undefined,
                                storageAllowanceMax,
                            );
                        } catch (error) {
                            failParse(error);
                        }
                    })();
                } catch (error) {
                    failParse(error);
                }
            });

            busboy.on('file', (fieldName, stream) => {
                const currentFileOrder = fileOrderIndex;
                fileOrderIndex++;
                const uploadPromise = (async () => {
                    try {
                        if (parseFailure) {
                            throw parseFailure;
                        }
                        if (!manifestPreparationPromise) {
                            throw new HttpError(
                                400,
                                'Batch write manifest must come before file content',
                                { legacyCode: 'bad_request' },
                            );
                        }

                        await manifestPreparationPromise;
                        if (parseFailure) {
                            throw parseFailure;
                        }
                        if (!parsedManifest || !preparedBatch) {
                            throw new HttpError(
                                400,
                                'Batch write manifest is missing',
                                { legacyCode: 'bad_request' },
                            );
                        }

                        const itemIndex = this.#resolveMultipartFileIndex(
                            fieldName,
                            currentFileOrder,
                            parsedManifest,
                        );
                        if (parsedManifest.ignoredItemIndexes.has(itemIndex)) {
                            if (!stream.readableEnded && !stream.destroyed) {
                                stream.resume();
                            }
                            return null;
                        }
                        if (uploadedIndexes.has(itemIndex)) {
                            throw new HttpError(
                                409,
                                `Duplicate file content for batch index ${itemIndex}`,
                                { legacyCode: 'conflict' },
                            );
                        }
                        uploadedIndexes.add(itemIndex);

                        const preparedIndex =
                            preparedIndexByManifestIndex.get(itemIndex);
                        const preparedItem =
                            preparedIndex === undefined
                                ? undefined
                                : preparedBatch.itemsByIndex.get(preparedIndex);
                        if (preparedIndex === undefined || !preparedItem) {
                            throw new HttpError(
                                400,
                                `Batch write metadata was not found for index ${itemIndex}`,
                                { legacyCode: 'bad_request' },
                            );
                        }

                        const uploadTracker = await this.#createUploadTracker(
                            userId,
                            preparedItem.objectKey,
                            preparedItem.normalizedInput.path,
                            preparedItem.normalizedInput.size,
                            preparedItem.guiMetadata,
                        );

                        return await this.services.fs.uploadPreparedBatchItem({
                            preparedBatch,
                            itemIndex: preparedIndex,
                            fileContent: stream,
                            uploadTracker,
                        });
                    } catch (error) {
                        if (!stream.readableEnded && !stream.destroyed) {
                            stream.resume();
                        }
                        throw error;
                    }
                })();
                uploadPromises.push(uploadPromise);
                // Failures are collected with `Promise.allSettled` once
                // parsing finishes, which is many ticks away — attach an
                // inert handler now so an immediate rejection (e.g. a file
                // part arriving before the manifest) isn't reported as an
                // unhandled rejection in the meantime.
                void uploadPromise.catch(() => undefined);
            });

            const parsingComplete = new Promise<void>((resolve, reject) => {
                busboy.once('error', reject);
                busboy.once('close', resolve);
            });

            req.pipe(busboy);
            await parsingComplete;
            // A manifest that failed to parse never sets
            // `manifestPreparationPromise`, so surface the real reason
            // (invalid JSON, bad item index, duplicate index → 409) before
            // falling back to "no manifest was sent at all". Scoped to that
            // case on purpose: with no prepared batch nothing can have been
            // uploaded, so there is nothing to clean up. A parse failure that
            // arrives *after* a manifest was accepted has to fall through to
            // the cleanup path below, which sweeps objects already in storage.
            if (parseFailure && !manifestPreparationPromise) {
                await Promise.allSettled(uploadPromises);
                throw parseFailure;
            }
            if (!manifestPreparationPromise) {
                await Promise.allSettled(uploadPromises);
                throw new HttpError(400, 'Batch write manifest is required', {
                    legacyCode: 'bad_request',
                });
            }
            await manifestPreparationPromise;
            const uploadResults = await Promise.allSettled(uploadPromises);
            const uploadedItems = uploadResults
                .filter(
                    (
                        result,
                    ): result is PromiseFulfilledResult<UploadedBatchWriteItem | null> =>
                        result.status === 'fulfilled',
                )
                .map((result) => result.value)
                .filter(
                    (uploadedItem): uploadedItem is UploadedBatchWriteItem =>
                        uploadedItem !== null,
                );
            if (parseFailure) {
                if (preparedBatch) {
                    await this.services.fs.cleanupPreparedBatchUploads(
                        preparedBatch,
                        uploadedItems,
                    );
                }
                throw parseFailure;
            }
            if (!preparedBatch) {
                throw new HttpError(
                    500,
                    'Failed to prepare batch write operation',
                    { legacyCode: 'internal_error' },
                );
            }
            const failedUpload = uploadResults.find(
                (result) => result.status === 'rejected',
            );
            if (failedUpload?.status === 'rejected') {
                await this.services.fs.cleanupPreparedBatchUploads(
                    preparedBatch,
                    uploadedItems,
                );
                throw failedUpload.reason instanceof Error
                    ? failedUpload.reason
                    : new Error('Failed to upload multipart batch item');
            }

            const writeResponses =
                await this.services.fs.finalizePreparedBatchWrites(
                    preparedBatch,
                    uploadedItems,
                );
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
            res.json(
                updatedResponses.map((r) => this.#withRequiredClientFsEntry(r)),
            );
            return;
        }

        const requests = Array.isArray(req.body)
            ? await Promise.all(
                  req.body.map(async (requestBody) => {
                      const normalizedRequestBody = this.#withGuiMetadata(
                          requestBody,
                          req.body,
                      );
                      normalizedRequestBody.fileMetadata =
                          this.#normalizeFileMetadataPath(
                              req,
                              normalizedRequestBody.fileMetadata,
                              normalizedRequestBody,
                          );
                      normalizedRequestBody.fileMetadata =
                          await this.#resolveAssociatedAppMetadata(
                              normalizedRequestBody.fileMetadata,
                              normalizedRequestBody,
                              appUidLookupCache,
                              userId,
                          );
                      return normalizedRequestBody;
                  }),
              )
            : [];
        const filteredRequests = requests.filter((requestBody) => {
            return !this.#shouldIgnoreUploadPath(requestBody.fileMetadata.path);
        });
        if (filteredRequests.length === 0) {
            res.json([]);
            return;
        }
        await this.#assertBatchWriteAccess(
            req,
            filteredRequests.map((requestBody) => requestBody.fileMetadata),
            { pathAlreadyNormalized: true },
        );

        const preparedBatch = await this.services.fs.prepareBatchWrites(
            userId,
            filteredRequests.map((requestBody) => ({
                fileMetadata: requestBody.fileMetadata,
                thumbnailData: requestBody.thumbnailData,
                guiMetadata: requestBody.guiMetadata,
            })),
            storageAllowanceMax,
        );
        await this.services.fs.assertStorageAllowanceForPreparedBatch(
            preparedBatch,
            undefined,
            storageAllowanceMax,
        );

        const uploadResults = await runWithConcurrencyLimitSettled(
            filteredRequests,
            8,
            async (requestBody, index) => {
                const preparedItem = preparedBatch.items[index];
                if (!preparedItem) {
                    throw new Error(
                        `Failed to resolve prepared batch item for index ${index}`,
                    );
                }
                const uploadTracker = await this.#createUploadTracker(
                    userId,
                    preparedItem.objectKey,
                    preparedItem.normalizedInput.path,
                    preparedItem.normalizedInput.size,
                    requestBody.guiMetadata,
                );
                return this.services.fs.uploadPreparedBatchItem({
                    preparedBatch,
                    itemIndex: preparedItem.index,
                    fileContent: requestBody.fileContent,
                    encoding: requestBody.encoding,
                    uploadTracker,
                });
            },
        );
        const uploadedItems = uploadResults
            .filter(
                (
                    result,
                ): result is PromiseFulfilledResult<UploadedBatchWriteItem> =>
                    result.status === 'fulfilled',
            )
            .map((result) => result.value);
        const failedUpload = uploadResults.find(
            (result) => result.status === 'rejected',
        );
        if (failedUpload?.status === 'rejected') {
            await this.services.fs.cleanupPreparedBatchUploads(
                preparedBatch,
                uploadedItems,
            );
            throw failedUpload.reason instanceof Error
                ? failedUpload.reason
                : new Error('Failed to upload batch write item');
        }

        const writeResponses =
            await this.services.fs.finalizePreparedBatchWrites(
                preparedBatch,
                uploadedItems,
            );
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
        res.json(
            updatedResponses.map((r) => this.#withRequiredClientFsEntry(r)),
        );
    }

    // -- Read-side routes ------------------------------------------------

    @Post('/stat', {
        subdomain: 'api',
        requireVerified: true,
        rateLimit: FS_STAT_LIMIT,
    })
    async statEntry(req: Request, res: Response) {
        const actor = this.#requireActor(req);
        const userId = this.#getActorUserId(req);
        const body = this.#toObjectRecord(req.body);
        const entry = await this.#resolveEntryForRequest(body);
        await this.#assertAccess(actor, entry.path, 'see');

        const wantsSize = this.#toBoolean(body.return_size);
        const subtreeSize =
            entry.isDir && wantsSize
                ? await this.services.fs.getSubtreeSize(userId, entry.path)
                : undefined;

        entry.suggestedApps =
            await this.services.suggestedApps.getSuggestedApps(entry);

        res.json({
            ...this.#toClientEntry(entry),
            ...(subtreeSize !== undefined ? { size: subtreeSize } : {}),
        });
    }

    /**
     * Strip backend-internal fields before returning an entry to a client.
     * Storage location (bucket/region), the owner's numeric id, and the
     * capability-token columns are never used by clients and must not leak to
     * callers who only hold `see`/`list` on the entry — a share recipient, or
     * (with public folders enabled) any authenticated user. The legacy read
     * path already curates its output; this does the same for the v2 routes.
     */
    #toClientEntry(entry: FSEntry): ClientFSEntry {
        // Allowlist, not a denylist: a denylist silently ships every column
        // added to `fsentries` later. Omits the numeric primary keys (`id`,
        // `parentId`, `associatedAppId`), the storage columns, the owning
        // `userId`, and the `publicToken`/`fileRequestToken` capability tokens.
        //
        // Tolerant of partially-hydrated entries: write/mkdir paths return a
        // freshly-built entry that hasn't been through a subdomain join.
        const subdomains = entry.subdomains ?? [];
        return {
            uuid: entry.uuid,
            uid: entry.uid ?? entry.uuid,
            parentUid: entry.parentUid ?? null,
            path: entry.path,
            name: entry.name,
            isDir: entry.isDir,
            isShortcut: entry.isShortcut,
            shortcutTo: entry.shortcutTo ?? null,
            isSymlink: entry.isSymlink,
            symlinkPath: entry.symlinkPath ?? null,
            isPublic: entry.isPublic ?? null,
            immutable: entry.immutable,
            metadata: entry.metadata ?? null,
            modified: entry.modified,
            created: entry.created ?? null,
            accessed: entry.accessed ?? null,
            size: entry.size ?? null,
            layout: entry.layout ?? null,
            subdomains,
            workers: entry.workers ?? [],
            hasWebsite: entry.hasWebsite ?? subdomains.length > 0,
            suggestedApps: entry.suggestedApps ?? [],
        };
    }

    /**
     * Sanitize the `fsEntry` a write response carries, leaving the rest of the
     * envelope (session id, presigned upload targets) untouched — those fields
     * are the point of the response. Applied at every `res.json` on the write
     * paths, which previously serialized the raw database row.
     *
     * The return type is the sanitized counterpart, so a caller cannot keep
     * treating the result as though it still held a full `FSEntry`.
     */
    #withClientFsEntry<T extends { fsEntry?: FSEntry }>(
        response: T,
    ): Omit<T, 'fsEntry'> & { fsEntry?: ClientFSEntry } {
        const { fsEntry, ...rest } = response;
        return {
            ...rest,
            ...(fsEntry ? { fsEntry: this.#toClientEntry(fsEntry) } : {}),
        };
    }

    /**
     * Drop the storage internals from a presigned-upload envelope. The client
     * uploads to the presigned URLs, which already encode bucket and key, so
     * naming the physical location of a user's bytes buys the caller nothing.
     */
    #withoutStorageInternals<
        T extends { bucket: string; bucketRegion: string; objectKey: string },
    >(response: T): Omit<T, 'bucket' | 'bucketRegion' | 'objectKey'> {
        const { bucket, bucketRegion, objectKey, ...rest } = response;
        return rest;
    }

    /** Same, for the responses whose `fsEntry` is always present. */
    #withRequiredClientFsEntry<T extends { fsEntry: FSEntry }>(
        response: T,
    ): Omit<T, 'fsEntry'> & { fsEntry: ClientFSEntry } {
        return {
            ...response,
            fsEntry: this.#toClientEntry(response.fsEntry),
        };
    }

    /**
     * `GET /fs/readdir` — same contract as the POST form, with parameters in
     * the query string instead of the body. A read as a GET is cacheable and
     * can authenticate via `?auth_token=`, which lets callers fetch a listing
     * without a JSON body. Every value arrives as a string, so parameter
     * parsing goes through the same coercion helpers the POST path uses.
     */
    @Get('/readdir', {
        subdomain: 'api',
        requireVerified: true,
        rateLimit: FS_READDIR_LIMIT,
    })
    async readdirEntriesViaGet(req: Request, res: Response) {
        return this.readdirEntries(req, res);
    }

    @Post('/readdir', {
        subdomain: 'api',
        requireVerified: true,
        rateLimit: FS_READDIR_LIMIT,
    })
    async readdirEntries(req: Request, res: Response) {
        const actor = this.#requireActor(req);
        // GET carries its parameters in the query string; POST in the body.
        const body = this.#toObjectRecord(
            req.method === 'GET' ? req.query : req.body,
        );

        // Presence of `cursor` (null/empty means "first page") or
        // `includeTotal` opts into the paginated `{items, cursor?, total?}`
        // envelope. Legacy limit/offset requests keep the bare-array response.
        const includeTotal = this.#toBoolean(body.includeTotal) === true;
        const paginated =
            Object.prototype.hasOwnProperty.call(body, 'cursor') ||
            includeTotal;

        // Undocumented: `recursive` lists descendants (prefix scan) up to
        // `depth` levels below the target. Always paginated; sorts by path.
        const recursive = this.#toBoolean(body.recursive) === true;

        if (this.#isRootPathRef(body)) {
            if (recursive) {
                throw new HttpError(
                    400,
                    'recursive listing is not supported at the root',
                    { legacyCode: 'bad_request' },
                );
            }
            const { listRootEntries } =
                await import('../../services/fs/rootListing.js');
            const rootChildren = await listRootEntries(
                actor,
                this.stores.fsEntry,
                this.services.permission,
            );
            const rootSuggestions =
                await this.services.suggestedApps.getSuggestedAppsForEntries(
                    rootChildren,
                );
            for (let index = 0; index < rootChildren.length; index++) {
                const child = rootChildren[index];
                if (child) {
                    child.suggestedApps = rootSuggestions[index] ?? [];
                }
            }
            const rootItems = await this.#toReaddirEntries(rootChildren);
            if (paginated) {
                res.json({
                    items: rootItems,
                    ...(includeTotal ? { total: rootItems.length } : {}),
                });
                return;
            }
            res.json(rootItems);
            return;
        }

        const parent = await this.#resolveEntryForRequest(body);
        if (!parent.isDir) {
            throw new HttpError(400, 'Target is not a directory', {
                legacyCode: 'dest_is_not_a_directory',
            });
        }
        // Use the legacy access assertion so this endpoint stays behaviorally
        // identical to the `/readdir` route the SDK moved off of — same error
        // codes and the same app-actor 404 masking on denial.
        await assertLegacyAccess(
            this.services.acl,
            this.services.fs,
            actor,
            parent.path,
            'list',
        );

        const limit = this.#toNumberOrUndefined(body.limit);
        const offset = this.#toNumberOrUndefined(body.offset);
        const sortByRaw =
            typeof (body.sortBy ?? body.sort_by) === 'string'
                ? String(body.sortBy ?? body.sort_by).toLowerCase()
                : undefined;
        const sortBy =
            (['name', 'modified', 'type', 'size'] as const).find(
                (v) => v === sortByRaw,
            ) ?? null;
        const sortOrderRaw =
            typeof (body.sortOrder ?? body.sort_order) === 'string'
                ? String(body.sortOrder ?? body.sort_order).toLowerCase()
                : undefined;
        const sortOrder =
            (['asc', 'desc'] as const).find((v) => v === sortOrderRaw) ?? null;

        if (recursive) {
            const requestedDepth = this.#toNumberOrUndefined(body.depth);
            const maxDepth = Math.min(
                MAX_READDIR_DEPTH,
                Math.max(1, Math.floor(requestedDepth ?? MAX_READDIR_DEPTH)),
            );
            const page = await this.services.fs.listDirectoryTreePage(
                parent.userId,
                parent.path,
                {
                    limit,
                    cursor:
                        typeof body.cursor === 'string'
                            ? body.cursor
                            : undefined,
                    maxDepth,
                },
            );
            await this.#attachSuggestedApps(page.entries);
            const total = includeTotal
                ? await this.services.fs.countDirectoryTree(
                      parent.userId,
                      parent.path,
                      maxDepth,
                  )
                : undefined;
            res.json({
                items: await this.#toReaddirEntries(page.entries),
                ...(page.cursor ? { cursor: page.cursor } : {}),
                ...(total !== undefined ? { total } : {}),
            });
            return;
        }

        if (paginated) {
            const page = await this.services.fs.listDirectoryPage(parent.uuid, {
                limit,
                cursor:
                    typeof body.cursor === 'string' ? body.cursor : undefined,
                sortBy,
                sortOrder,
            });
            await this.#attachSuggestedApps(page.entries);
            const total = includeTotal
                ? await this.services.fs.countDirectory(parent.uuid)
                : undefined;
            res.json({
                items: await this.#toReaddirEntries(page.entries),
                ...(page.cursor ? { cursor: page.cursor } : {}),
                ...(total !== undefined ? { total } : {}),
            });
            return;
        }

        const children = await this.services.fs.listDirectory(parent.uuid, {
            limit,
            offset,
            sortBy,
            sortOrder,
        });
        await this.#attachSuggestedApps(children);
        res.json(await this.#toReaddirEntries(children));
    }

    /**
     * Shape readdir entries in the v2 (camelCase) response shape, enriched with
     * the three fields the SDK cannot reconstruct on its own so it can rebuild
     * the v1 shape: `type` (MIME), a signed `thumbnail`, and `associatedApp`.
     */
    async #toReaddirEntries(entries: FSEntry[]): Promise<ClientReaddirEntry[]> {
        const appsById = await loadLegacyAssociatedApps(
            this.stores.app,
            entries,
        );
        return Promise.all(
            entries.map(async (entry) => ({
                ...this.#toClientEntry(entry),
                // Fields the client cannot derive on its own.
                type: fsEntryMimeType(entry),
                thumbnail: await signEntryThumbnail(
                    this.clients.event,
                    entry.uuid,
                    entry.thumbnail,
                ),
                associatedApp:
                    entry.associatedAppId !== null
                        ? (appsById.get(entry.associatedAppId) ?? null)
                        : null,
            })),
        );
    }

    async #attachSuggestedApps(entries: FSEntry[]): Promise<void> {
        const suggestions =
            await this.services.suggestedApps.getSuggestedAppsForEntries(
                entries,
            );
        for (let index = 0; index < entries.length; index++) {
            const child = entries[index];
            if (child) {
                child.suggestedApps = suggestions[index] ?? [];
            }
        }
    }

    @Post('/search', {
        subdomain: 'api',
        requireVerified: true,
        rateLimit: FS_SEARCH_LIMIT,
        concurrent: FS_SEARCH_CONCURRENT,
    })
    async searchEntries(req: Request, res: Response) {
        const actor = this.#requireActor(req);
        const userId = this.#getActorUserId(req);
        const body = this.#toObjectRecord(req.body);
        const query =
            typeof body.query === 'string'
                ? body.query
                : typeof body.text === 'string'
                  ? body.text
                  : '';
        if (query.trim().length === 0) {
            throw new HttpError(400, 'Missing `query`', {
                legacyCode: 'bad_request',
            });
        }
        const limit = this.#toNumberOrUndefined(body.limit);
        const results = await this.services.fs.searchByName(
            userId,
            query,
            limit ?? 200,
            this.#appDataScopeForActor(actor),
        );
        res.json(results);
    }

    @Get('/read', {
        subdomain: 'api',
        requireVerified: true,
        requireCredits: true,
        rateLimit: FS_READ_LIMIT,
        concurrent: FS_READ_CONCURRENT,
    })
    async readEntry(req: Request, res: Response) {
        const actor = this.#requireActor(req);
        const query = this.#toObjectRecord(req.query);
        const entry = await this.#resolveEntryForRequest(query);
        await this.#assertAccess(actor, entry.path, 'read');

        if (entry.isDir) {
            throw new HttpError(
                400,
                'Cannot read a directory; use /fs/readdir',
                { legacyCode: 'cannot_read_a_directory' },
            );
        }

        const range =
            typeof req.headers.range === 'string'
                ? req.headers.range
                : undefined;
        const download = await this.services.fs.readContent(entry, {
            range,
        });

        if (download.contentType) {
            res.setHeader('Content-Type', download.contentType);
            // Stored type is uploader-controlled and served inline on the
            // api origin — sandbox active-document types (HTML/SVG/XML) so
            // embedded scripts can't run here. Inert types are untouched.
            applyInlineContentSecurity(res, download.contentType);
        }
        if (download.contentLength !== null)
            res.setHeader('Content-Length', String(download.contentLength));
        if (download.contentRange)
            res.setHeader('Content-Range', download.contentRange);
        if (download.etag) res.setHeader('ETag', download.etag);
        if (download.lastModified)
            res.setHeader('Last-Modified', download.lastModified.toUTCString());

        res.setHeader(
            'Content-Disposition',
            `inline; filename="${encodeURIComponent(entry.name)}"`,
        );
        res.status(range ? 206 : 200);

        try {
            await pipeline(download.body, res);
        } catch {
            // Client disconnect or upstream stream error — pipeline already
            // tore down both ends. Response is partially sent; nothing to do.
            return;
        }
    }

    // -- Mutation routes ------------------------------------------------

    @Post('/mkdir', {
        subdomain: 'api',
        requireVerified: true,
        rateLimit: FS_MUTATE_LIMIT,
    })
    async mkdirEntry(req: Request, res: Response) {
        const actor = this.#requireActor(req);
        const userId = this.#getActorUserId(req);
        const body = this.#toObjectRecord(req.body);
        const rawPath = typeof body.path === 'string' ? body.path : '';
        if (!rawPath.trim())
            throw new HttpError(400, 'Missing `path`', {
                legacyCode: 'bad_request',
            });

        // Normalize first: expands `~`, collapses `..`, ensures leading `/`
        // and no trailing `/`. Without this, parent-path derivation below
        // would compute a wrong parent for `~/...` inputs (e.g. dirname of
        // `/~/Documents/foo` is `/~/Documents`, not `/<username>/Documents`).
        const username = this.#getActorUsername(req);
        const path = this.#normalizePath(rawPath, username);
        if (path === '/')
            throw new HttpError(400, 'Cannot mkdir at root', {
                legacyCode: 'bad_request',
            });

        const dedupeName =
            this.#toBoolean(body.dedupe_name ?? body.dedupeName) ?? false;
        await this.#assertCanCreate(actor, path);
        if (dedupeName) await this.#assertCanDedupeCreate(actor, path);

        const entry = await this.services.fs.mkdir(userId, {
            path,
            overwrite: this.#toBoolean(body.overwrite) ?? false,
            dedupeName,
            createMissingParents:
                this.#toBoolean(
                    body.create_missing_parents ??
                        body.create_missing_ancestors,
                ) ?? false,
        });
        this.#emitGuiItemAdded(entry);
        res.json(this.#toClientEntry(entry));
    }

    @Post('/touch', {
        subdomain: 'api',
        requireVerified: true,
        rateLimit: FS_MUTATE_LIMIT,
    })
    async touchEntry(req: Request, res: Response) {
        const actor = this.#requireActor(req);
        const userId = this.#getActorUserId(req);
        const body = this.#toObjectRecord(req.body);
        const rawPath = typeof body.path === 'string' ? body.path : '';
        if (!rawPath.trim())
            throw new HttpError(400, 'Missing `path`', {
                legacyCode: 'bad_request',
            });

        const username = this.#getActorUsername(req);
        const path = this.#normalizePath(rawPath, username);
        if (path === '/')
            throw new HttpError(400, 'Cannot touch root', {
                legacyCode: 'bad_request',
            });

        const parentPath = pathPosix.dirname(path);
        await this.#assertAccess(
            actor,
            parentPath === '/' ? path : parentPath,
            'write',
        );

        const entry = await this.services.fs.touch(userId, {
            path,
            setAccessed: this.#toBoolean(body.set_accessed_to_now) ?? false,
            setModified: this.#toBoolean(body.set_modified_to_now) ?? false,
            setCreated: this.#toBoolean(body.set_created_to_now) ?? false,
            createMissingParents:
                this.#toBoolean(body.create_missing_parents) ?? false,
        });
        res.json(this.#toClientEntry(entry));
    }

    @Post('/rename', {
        subdomain: 'api',
        requireVerified: true,
        rateLimit: FS_MUTATE_LIMIT,
    })
    async renameEntry(req: Request, res: Response) {
        const actor = this.#requireActor(req);
        const body = this.#toObjectRecord(req.body);
        const newName = typeof body.new_name === 'string' ? body.new_name : '';
        if (!newName.trim())
            throw new HttpError(400, 'Missing `new_name`', {
                legacyCode: 'bad_request',
            });

        const entry = await this.#resolveEntryForRequest(body);
        await this.#assertAccess(actor, entry.path, 'write');

        const renamed = await this.services.fs.rename(entry, newName);
        this.#emitGuiItemUpdated(renamed);
        res.json(this.#toClientEntry(renamed));
    }

    @Post('/delete', {
        subdomain: 'api',
        requireVerified: true,
        rateLimit: FS_MUTATE_LIMIT,
    })
    async deleteEntry(req: Request, res: Response) {
        const actor = this.#requireActor(req);
        const userId = this.#getActorUserId(req);
        const body = this.#toObjectRecord(req.body);
        const entry = await this.#resolveEntryForRequest(body);
        await this.#assertAccess(actor, entry.path, 'write');

        const descendantsOnly = this.#toBoolean(body.descendants_only) ?? false;
        await this.services.fs.remove(userId, {
            entry,
            recursive: this.#toBoolean(body.recursive) ?? false,
            descendantsOnly,
        });
        this.#emitGuiItemRemoved(entry, descendantsOnly);
        res.json({ ok: true });
    }

    @Post('/move', {
        subdomain: 'api',
        requireVerified: true,
        rateLimit: FS_MUTATE_LIMIT,
    })
    async moveEntry(req: Request, res: Response) {
        const actor = this.#requireActor(req);
        const userId = this.#getActorUserId(req);
        const body = this.#toObjectRecord(req.body);
        const sourceRef = this.#extractNodeRef(body.source ?? body);
        const destinationRef = this.#extractNodeRef(body.destination);

        const source = await this.#resolveEntryForRequest(sourceRef);
        const destinationParent =
            await this.#resolveEntryForRequest(destinationRef);

        await this.#assertAccess(actor, source.path, 'write');
        await this.#assertAccess(actor, destinationParent.path, 'write');

        const moved = await this.services.fs.move(userId, {
            source,
            destinationParent,
            newName:
                typeof body.new_name === 'string' ? body.new_name : undefined,
            overwrite: this.#toBoolean(body.overwrite) ?? false,
            dedupeName:
                this.#toBoolean(body.dedupe_name ?? body.change_name) ?? false,
        });
        this.#emitGuiItemMoved(source, moved);
        res.json(this.#toClientEntry(moved));
    }

    @Post('/copy', {
        subdomain: 'api',
        requireVerified: true,
        requireCredits: true,
        rateLimit: FS_MUTATE_LIMIT,
    })
    async copyEntry(req: Request, res: Response) {
        const actor = this.#requireActor(req);
        const userId = this.#getActorUserId(req);
        const body = this.#toObjectRecord(req.body);
        const sourceRef = this.#extractNodeRef(body.source ?? body);
        const destinationRef = this.#extractNodeRef(body.destination);

        const source = await this.#resolveEntryForRequest(sourceRef);
        const destinationParent =
            await this.#resolveEntryForRequest(destinationRef);

        await this.#assertAccess(actor, source.path, 'read');
        await this.#assertAccess(actor, destinationParent.path, 'write');

        const storageAllowanceMax = this.#getStorageAllowanceMaxOverride(req);
        const copy = await this.services.fs.copy(userId, {
            source,
            destinationParent,
            newName:
                typeof body.new_name === 'string' ? body.new_name : undefined,
            overwrite: this.#toBoolean(body.overwrite) ?? false,
            dedupeName:
                this.#toBoolean(body.dedupe_name ?? body.change_name) ?? true,
            ...(storageAllowanceMax !== undefined
                ? { storageAllowanceMax }
                : {}),
        });
        this.#emitGuiItemAdded(copy);
        res.json(this.#toClientEntry(copy));
    }

    @Post('/mkshortcut', {
        subdomain: 'api',
        requireVerified: true,
        rateLimit: FS_MUTATE_LIMIT,
    })
    async mkshortcutEntry(req: Request, res: Response) {
        const actor = this.#requireActor(req);
        const userId = this.#getActorUserId(req);
        const body = this.#toObjectRecord(req.body);
        const parentRef = this.#extractNodeRef(body.parent ?? body);
        const targetRef = this.#extractNodeRef(body.target);
        const name = typeof body.name === 'string' ? body.name : '';
        if (!name.trim())
            throw new HttpError(400, 'Missing `name`', {
                legacyCode: 'bad_request',
            });

        const parent = await this.#resolveEntryForRequest(parentRef);
        const target = await this.#resolveEntryForRequest(targetRef);

        await this.#assertAccess(actor, target.path, 'read');
        await this.#assertAccess(actor, parent.path, 'write');

        const shortcut = await this.services.fs.mkshortcut(userId, {
            parent,
            name,
            target,
            dedupeName: this.#toBoolean(body.dedupe_name) ?? true,
        });
        this.#emitGuiItemAdded(shortcut);
        res.json(this.#toClientEntry(shortcut));
    }

    // -- Read-side helpers -----------------------------------------------

    #requireActor(req: Request): Actor {
        const actor = req.actor;
        if (!actor) {
            throw new HttpError(401, 'Unauthorized', {
                legacyCode: 'unauthorized',
            });
        }
        return actor;
    }

    #isRootPathRef(source: Record<string, unknown>): boolean {
        if (typeof source.path !== 'string') return false;
        if (source.uid !== undefined || source.uuid !== undefined) return false;
        if (source.id !== undefined) return false;
        return source.path.trim() === '/';
    }

    async #resolveEntryForRequest(source: Record<string, unknown>) {
        const mod = await import('../../services/fs/resolveNode.js');
        const username = Context.get('actor')?.user?.username;
        const rawPath =
            typeof source.path === 'string' ? source.path : undefined;
        const ref = {
            path:
                rawPath !== undefined
                    ? mod.expandTildePath(rawPath, username)
                    : undefined,
            uid:
                typeof source.uid === 'string'
                    ? source.uid
                    : typeof source.uuid === 'string'
                      ? source.uuid
                      : undefined,
            id:
                typeof source.id === 'number' || typeof source.id === 'string'
                    ? source.id
                    : undefined,
        };
        const entry = await mod.resolveNode(this.stores.fsEntry, ref, {
            required: true,
        });
        if (!entry) {
            throw new HttpError(404, 'Entry not found', {
                legacyCode: 'not_found',
            });
        }
        return entry;
    }

    /**
     * Authorize creation of a new entry at `targetPath`. The standard rule is
     * write on the parent, but we also accept write on the target itself — this
     * lets an app create its own `/<user>/AppData/<app_uid>` folder (parent
     * `AppData` is off-limits, but the target is the app's own subtree per
     * ACLService's short-circuit) and lets recipients of a direct share on a
     * not-yet-existent path materialize it.
     */
    async #assertCanCreate(actor: Actor, targetPath: string) {
        const parent = pathPosix.dirname(targetPath);
        const parentForCheck = parent === '/' ? targetPath : parent;
        const fsService = this.services.fs;

        const makeDescriptor = (path: string) => {
            let cache: Promise<Array<{ uid: string; path: string }>> | null =
                null;
            return {
                path,
                resolveAncestors() {
                    if (!cache) cache = fsService.getAncestorChain(path);
                    return cache;
                },
            };
        };

        if (
            await this.services.acl.check(
                actor,
                makeDescriptor(parentForCheck),
                'write',
            )
        ) {
            return;
        }
        if (
            await this.services.acl.check(
                actor,
                makeDescriptor(targetPath),
                'write',
            )
        ) {
            return;
        }
        await this.#assertAccess(actor, parentForCheck, 'write');
    }

    async #assertCanDedupeCreate(actor: Actor, targetPath: string) {
        const existing = await this.stores.fsEntry.getEntryByPath(targetPath);
        if (!existing) return;
        const parent = pathPosix.dirname(targetPath);
        await this.#assertAccess(
            actor,
            parent === '/' ? targetPath : parent,
            'write',
        );
    }

    async #assertAccess(
        actor: Actor,
        path: string,
        mode: 'see' | 'list' | 'read' | 'write',
    ) {
        const fsService = this.services.fs;
        let ancestorsCache: Promise<
            Array<{ uid: string; path: string }>
        > | null = null;
        const descriptor = {
            path,
            resolveAncestors() {
                if (!ancestorsCache) {
                    ancestorsCache = fsService.getAncestorChain(path);
                }
                return ancestorsCache;
            },
        };
        const allowed = await this.services.acl.check(actor, descriptor, mode);
        if (allowed) return;
        const safe = (await this.services.acl.getSafeAclError(
            actor,
            descriptor,
            mode,
        )) as {
            status?: unknown;
            message?: unknown;
            fields?: { code?: unknown };
        };
        const status = Number(safe?.status);
        const message =
            typeof safe?.message === 'string' && safe.message.length > 0
                ? safe.message
                : 'Access denied';
        const code =
            typeof safe?.fields?.code === 'string'
                ? safe.fields.code
                : undefined;
        const legacyCode = code === 'forbidden' ? 'access_denied' : code;
        if (status === 404) {
            throw new HttpError(404, message, {
                ...(legacyCode ? { legacyCode } : {}),
            });
        }
        throw new HttpError(403, message, {
            legacyCode: legacyCode ?? 'access_denied',
        });
    }

    #toNumberOrUndefined(value: unknown): number | undefined {
        if (typeof value === 'number' && Number.isFinite(value)) return value;
        if (typeof value === 'string' && value.trim().length > 0) {
            const parsed = Number(value);
            if (Number.isFinite(parsed)) return parsed;
        }
        return undefined;
    }

    // Accepts loose inputs from route bodies. `source`/`destination` fields may
    // arrive as a plain string (= path) or an object of { path | uid | id }.
    #extractNodeRef(value: unknown): Record<string, unknown> {
        if (typeof value === 'string') return { path: value };
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            return value as Record<string, unknown>;
        }
        return {};
    }

    // Fire-and-forget GUI events for single-entry mutations. These feed the
    // desktop cache invalidator and extension listeners (e.g. thumbnails).
    #emitGuiItemAdded(entry: FSEntry): void {
        void this.#emitGuiWriteEvent(
            'outer.gui.item.added',
            entry,
            undefined,
        ).catch(() => undefined);
    }

    #emitGuiItemUpdated(entry: FSEntry): void {
        void this.#emitGuiWriteEvent(
            'outer.gui.item.updated',
            entry,
            undefined,
        ).catch(() => undefined);
    }

    #emitGuiItemRemoved(entry: FSEntry, descendantsOnly = false): void {
        // GUI listens for `outer.gui.item.removed`; same envelope shape.
        // `descendants_only` lets the GUI keep the parent (e.g. Trash) and
        // only drop its children — without it the GUI removes the parent too.
        void (async () => {
            try {
                await this.clients.event.emit(
                    'outer.gui.item.removed',
                    {
                        user_id_list: [entry.userId],
                        response: {
                            ...entry,
                            from_new_service: true,
                            descendants_only: descendantsOnly,
                        },
                    },
                    {},
                );
            } catch {
                // ignore — non-critical.
            }
        })();
    }

    #emitGuiItemMoved(source: FSEntry, moved: FSEntry): void {
        void (async () => {
            try {
                await this.clients.event.emit(
                    'outer.gui.item.moved',
                    {
                        user_id_list: [moved.userId],
                        response: {
                            ...moved,
                            from_path: source.path,
                            from_new_service: true,
                        },
                    },
                    {},
                );
            } catch {
                // ignore — non-critical.
            }
        })();
    }

    #getActorUserId(req: Request): number {
        const requestUser = (
            req as Request & {
                user?: {
                    id?: unknown;
                };
            }
        ).user;
        const actorUser = req.actor?.user;
        const candidateUserId = requestUser?.id ?? actorUser?.id;
        if (candidateUserId === undefined || candidateUserId === null) {
            throw new HttpError(401, 'Unauthorized', {
                legacyCode: 'unauthorized',
            });
        }

        const userId = Number(candidateUserId);
        if (Number.isNaN(userId)) {
            throw new HttpError(401, 'Unauthorized', {
                legacyCode: 'unauthorized',
            });
        }

        return userId;
    }

    #getActorUsername(req: Request): string {
        const requestUser = (
            req as Request & {
                user?: {
                    username?: unknown;
                };
            }
        ).user;
        const actorUser = req.actor?.user;
        const actorUsername = requestUser?.username ?? actorUser?.username;
        if (
            typeof actorUsername !== 'string' ||
            actorUsername.trim().length === 0
        ) {
            throw new HttpError(401, 'Unauthorized', {
                legacyCode: 'unauthorized',
            });
        }
        return actorUsername.trim();
    }

    #toObjectRecord(value: unknown): Record<string, unknown> {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return {};
        }
        return value as Record<string, unknown>;
    }

    #firstDefined(...values: unknown[]): unknown {
        for (const value of values) {
            if (value !== undefined && value !== null) {
                return value;
            }
        }
        return undefined;
    }

    #toBoolean(value: unknown): boolean | undefined {
        if (typeof value === 'boolean') {
            return value;
        }
        if (typeof value === 'number') {
            if (value === 1) return true;
            if (value === 0) return false;
            return undefined;
        }
        if (typeof value === 'string') {
            const normalizedValue = value.trim().toLowerCase();
            if (['1', 'true', 'yes', 'on'].includes(normalizedValue)) {
                return true;
            }
            if (['0', 'false', 'no', 'off'].includes(normalizedValue)) {
                return false;
            }
        }
        return undefined;
    }

    #toNumber(value: unknown): number | undefined {
        if (value === undefined || value === null || value === '') {
            return undefined;
        }
        const candidate = Number(value);
        if (!Number.isFinite(candidate)) {
            return undefined;
        }
        return candidate;
    }

    #resolveWriteFileMetadata(
        fileMetadata: FSEntryWriteInput | undefined,
        fallbackSource?: unknown,
    ): FSEntryWriteInput {
        const metadataRecord = this.#toObjectRecord(fileMetadata);
        const fallbackRecord = this.#toObjectRecord(fallbackSource);

        const normalizedFileMetadata: Record<string, unknown> = {
            ...metadataRecord,
        };

        const path = this.#firstDefined(
            metadataRecord.path,
            fallbackRecord.path,
        );
        if (typeof path === 'string') {
            normalizedFileMetadata.path = path;
        }

        const size = this.#toNumber(
            this.#firstDefined(metadataRecord.size, fallbackRecord.size),
        );
        if (size !== undefined) {
            normalizedFileMetadata.size = size;
        }

        const contentType = this.#firstDefined(
            metadataRecord.contentType,
            metadataRecord.content_type,
            fallbackRecord.contentType,
            fallbackRecord.content_type,
        );
        if (typeof contentType === 'string' && contentType.length > 0) {
            normalizedFileMetadata.contentType = contentType;
        }

        const checksumSha256 = this.#firstDefined(
            metadataRecord.checksumSha256,
            metadataRecord.checksum_sha256,
            fallbackRecord.checksumSha256,
            fallbackRecord.checksum_sha256,
        );
        if (typeof checksumSha256 === 'string' && checksumSha256.length > 0) {
            normalizedFileMetadata.checksumSha256 = checksumSha256;
        }

        const overwrite = this.#toBoolean(
            this.#firstDefined(
                metadataRecord.overwrite,
                fallbackRecord.overwrite,
            ),
        );
        if (overwrite !== undefined) {
            normalizedFileMetadata.overwrite = overwrite;
        }

        const dedupeName = this.#toBoolean(
            this.#firstDefined(
                metadataRecord.dedupeName,
                metadataRecord.dedupe_name,
                fallbackRecord.dedupeName,
                fallbackRecord.dedupe_name,
                fallbackRecord.rename,
                fallbackRecord.change_name,
            ),
        );
        if (dedupeName !== undefined) {
            normalizedFileMetadata.dedupeName = dedupeName;
        }

        const createMissingParents = this.#toBoolean(
            this.#firstDefined(
                metadataRecord.createMissingParents,
                metadataRecord.create_missing_parents,
                metadataRecord.create_missing_ancestors,
                fallbackRecord.createMissingParents,
                fallbackRecord.create_missing_parents,
                fallbackRecord.createMissingAncestors,
                fallbackRecord.create_missing_ancestors,
                fallbackRecord.createFileParent,
                fallbackRecord.create_file_parent,
            ),
        );
        if (createMissingParents !== undefined) {
            normalizedFileMetadata.createMissingParents = createMissingParents;
        }

        const immutable = this.#toBoolean(
            this.#firstDefined(
                metadataRecord.immutable,
                fallbackRecord.immutable,
            ),
        );
        if (immutable !== undefined) {
            normalizedFileMetadata.immutable = immutable;
        }

        const isPublic = this.#toBoolean(
            this.#firstDefined(
                metadataRecord.isPublic,
                metadataRecord.is_public,
                fallbackRecord.isPublic,
                fallbackRecord.is_public,
            ),
        );
        if (isPublic !== undefined) {
            normalizedFileMetadata.isPublic = isPublic;
        }

        const multipartPartSize = this.#toNumber(
            this.#firstDefined(
                metadataRecord.multipartPartSize,
                metadataRecord.multipart_part_size,
                fallbackRecord.multipartPartSize,
                fallbackRecord.multipart_part_size,
            ),
        );
        if (multipartPartSize !== undefined && multipartPartSize > 0) {
            normalizedFileMetadata.multipartPartSize = multipartPartSize;
        }

        const associatedAppId = this.#toNumber(
            this.#firstDefined(
                metadataRecord.associatedAppId,
                metadataRecord.associated_app_id,
                fallbackRecord.associatedAppId,
                fallbackRecord.associated_app_id,
            ),
        );
        if (associatedAppId !== undefined) {
            normalizedFileMetadata.associatedAppId = associatedAppId;
        }

        return normalizedFileMetadata as unknown as FSEntryWriteInput;
    }

    async #resolveAssociatedAppMetadata(
        fileMetadata: FSEntryWriteInput,
        fallbackSource?: unknown,
        appUidLookupCache?: Map<string, Promise<number | null>>,
        actorUserId?: number,
    ): Promise<FSEntryWriteInput> {
        const metadataRecord = this.#toObjectRecord(fileMetadata);
        const fallbackRecord = this.#toObjectRecord(fallbackSource);

        const associatedAppId = this.#toNumber(
            this.#firstDefined(
                metadataRecord.associatedAppId,
                metadataRecord.associated_app_id,
                fallbackRecord.associatedAppId,
                fallbackRecord.associated_app_id,
            ),
        );
        if (associatedAppId !== undefined) {
            return this.#withAssociatedAppId(
                fileMetadata,
                associatedAppId,
                actorUserId,
            );
        }

        const appUid = this.#firstDefined(
            metadataRecord.appUID,
            metadataRecord.appUid,
            metadataRecord.app_uid,
            fallbackRecord.appUID,
            fallbackRecord.appUid,
            fallbackRecord.app_uid,
        );
        if (typeof appUid !== 'string' || appUid.trim().length === 0) {
            return fileMetadata;
        }

        const normalizedAppUid = appUid.trim();
        const lookupPromise = (() => {
            const cachedLookup = appUidLookupCache?.get(normalizedAppUid);
            if (cachedLookup) {
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
        if (resolvedAppId === null) {
            return fileMetadata;
        }
        return this.#withAssociatedAppId(
            fileMetadata,
            resolvedAppId,
            actorUserId,
        );
    }

    /**
     * Bind `associatedAppId` onto the write input only when the actor is
     * entitled to reference that app. `associatedAppId` is client-supplied and
     * never trusted for authz, but it's echoed back in legacy FS responses — so
     * an attacker could plant another tenant's private app id to confirm the
     * row exists (an enumeration oracle) and harvest its metadata. Allow
     * binding to public apps (their existence isn't secret) or to apps the
     * actor owns; drop the association otherwise so the file simply carries no
     * associated app.
     *
     * `#resolveWriteFileMetadata` has already copied the raw client value onto
     * `fileMetadata`, so a dropped association must be actively stripped — not
     * merely left unset.
     */
    async #withAssociatedAppId(
        fileMetadata: FSEntryWriteInput,
        appId: number,
        actorUserId?: number,
    ): Promise<FSEntryWriteInput> {
        const app = await this.stores.app.getById(appId);
        const isPrivate =
            !!app && (Boolean(app.is_private) || Boolean(app.protected));
        const isOwner =
            actorUserId !== undefined &&
            this.#toNumber(app?.owner_user_id) === actorUserId;
        if (!app || (isPrivate && !isOwner)) {
            const { associatedAppId: _dropped, ...rest } =
                fileMetadata as unknown as Record<string, unknown>;
            return rest as unknown as FSEntryWriteInput;
        }
        return {
            ...fileMetadata,
            associatedAppId: appId,
        };
    }

    #toStorageCapacityCandidate(value: unknown): number | undefined {
        const capacity = Number(value);
        if (!Number.isFinite(capacity) || capacity < 0) {
            return undefined;
        }
        return capacity;
    }

    #getStorageAllowanceMaxOverride(req: Request): number | undefined {
        // free_storage / actual_free_storage are user-row fields not on
        // the ActorUser type. Access via the escape hatch until a proper
        // storage-quota mechanism is in place.
        const actorUser = req.actor?.user as
            Record<string, unknown> | undefined;

        const candidates = [
            this.#toStorageCapacityCandidate(actorUser?.free_storage),
            this.#toStorageCapacityCandidate(actorUser?.actual_free_storage),
        ].filter((candidate): candidate is number => candidate !== undefined);

        if (candidates.length === 0) {
            return undefined;
        }
        return Math.max(...candidates);
    }

    #normalizePath(path: string, username?: string): string {
        const trimmedPath = path.trim();
        if (trimmedPath.length === 0) {
            throw new HttpError(400, 'Path cannot be empty', {
                legacyCode: 'bad_request',
            });
        }

        let pathToNormalize = trimmedPath;
        if (pathToNormalize === '~' || pathToNormalize.startsWith('~/')) {
            if (!username) {
                throw new HttpError(400, 'Unable to resolve home path', {
                    legacyCode: 'bad_request',
                });
            }

            pathToNormalize = `/${username}${pathToNormalize.slice(1)}`;
        }

        assertNormalized(pathToNormalize);
        let normalizedPath = pathToNormalize;
        if (!normalizedPath.startsWith('/')) {
            normalizedPath = `/${normalizedPath}`;
        }
        if (normalizedPath.length > 1 && normalizedPath.endsWith('/')) {
            normalizedPath = normalizedPath.slice(0, -1);
        }
        return normalizedPath;
    }

    #normalizeFileMetadataPath(
        req: Request,
        fileMetadata: FSEntryWriteInput | undefined,
        fallbackSource?: unknown,
    ): FSEntryWriteInput {
        const resolvedFileMetadata = this.#resolveWriteFileMetadata(
            fileMetadata,
            fallbackSource,
        );
        if (typeof resolvedFileMetadata.path !== 'string') {
            throw new HttpError(400, 'Missing path', {
                legacyCode: 'bad_request',
            });
        }

        const username = this.#getActorUsername(req);
        return {
            ...resolvedFileMetadata,
            path: this.#normalizePath(resolvedFileMetadata.path, username),
        };
    }

    #extractGuiMetadata(
        input: unknown,
        fallback: WriteGuiMetadata | undefined,
    ): WriteGuiMetadata | undefined {
        const source =
            input && typeof input === 'object'
                ? (input as Record<string, unknown>)
                : {};
        const guiMetadata: WriteGuiMetadata = {
            originalClientSocketId:
                typeof source.originalClientSocketId === 'string'
                    ? source.originalClientSocketId
                    : typeof source.original_client_socket_id === 'string'
                      ? source.original_client_socket_id
                      : fallback?.originalClientSocketId,
            socketId:
                typeof source.socketId === 'string'
                    ? source.socketId
                    : typeof source.socket_id === 'string'
                      ? source.socket_id
                      : fallback?.socketId,
            operationId:
                typeof source.operationId === 'string'
                    ? source.operationId
                    : typeof source.operation_id === 'string'
                      ? source.operation_id
                      : fallback?.operationId,
            itemUploadId:
                typeof source.itemUploadId === 'string'
                    ? source.itemUploadId
                    : typeof source.item_upload_id === 'string'
                      ? source.item_upload_id
                      : fallback?.itemUploadId,
        };

        if (
            !guiMetadata.originalClientSocketId &&
            !guiMetadata.socketId &&
            !guiMetadata.operationId &&
            !guiMetadata.itemUploadId
        ) {
            return undefined;
        }
        return guiMetadata;
    }

    #withGuiMetadata<T extends { guiMetadata?: WriteGuiMetadata }>(
        value: T,
        fallbackSource: unknown,
    ): T {
        const guiMetadata = this.#extractGuiMetadata(
            value,
            this.#extractGuiMetadata(fallbackSource, undefined),
        );
        if (!guiMetadata) {
            return value;
        }
        return {
            ...value,
            guiMetadata,
        };
    }

    async #assertWriteAccess(
        req: Request,
        fileMetadata: FSEntryWriteInput | undefined,
        options?: {
            pathAlreadyNormalized?: boolean;
        },
    ): Promise<void> {
        const actor = req.actor;
        if (!actor) {
            throw new HttpError(401, 'Unauthorized', {
                legacyCode: 'unauthorized',
            });
        }
        const normalizedFileMetadata = options?.pathAlreadyNormalized
            ? fileMetadata
            : this.#normalizeFileMetadataPath(req, fileMetadata);
        if (!normalizedFileMetadata) {
            throw new HttpError(400, 'Missing path', {
                legacyCode: 'bad_request',
            });
        }

        const targetPath = normalizedFileMetadata.path;
        if (targetPath === '/') {
            throw new HttpError(400, 'Cannot write to root path', {
                legacyCode: 'cannot_write_to_root',
            });
        }
        const parentPath = pathPosix.dirname(targetPath);
        if (parentPath === '/') {
            throw new HttpError(400, 'Cannot write to root path', {
                legacyCode: 'cannot_write_to_root',
            });
        }

        let pathToCheck = parentPath;
        if (Boolean(normalizedFileMetadata.overwrite)) {
            const destinationExists =
                await this.services.fs.entryExistsByPath(targetPath);
            if (destinationExists) {
                pathToCheck = targetPath;
            }
        }

        const fsService = this.services.fs;
        let ancestorsCache: Promise<
            Array<{ uid: string; path: string }>
        > | null = null;
        const resourceDescriptor = {
            path: pathToCheck,
            resolveAncestors() {
                if (!ancestorsCache) {
                    ancestorsCache = fsService.getAncestorChain(pathToCheck);
                }
                return ancestorsCache;
            },
        };

        const canWrite = await this.services.acl.check(
            actor,
            resourceDescriptor,
            'write',
        );
        if (canWrite) {
            return;
        }

        const safeAclError = (await this.services.acl.getSafeAclError(
            actor,
            resourceDescriptor,
            'write',
        )) as {
            status?: unknown;
            message?: unknown;
            fields?: {
                code?: unknown;
            };
        };
        const safeAclStatus = Number(safeAclError?.status);
        const safeAclMessage =
            typeof safeAclError?.message === 'string' &&
            safeAclError.message.length > 0
                ? safeAclError.message
                : 'Write access denied for destination';
        const safeAclCode =
            typeof safeAclError?.fields?.code === 'string'
                ? safeAclError.fields.code
                : undefined;
        const legacyCode =
            safeAclCode === 'forbidden' ? 'access_denied' : safeAclCode;

        if (safeAclStatus === 404) {
            throw new HttpError(404, safeAclMessage, {
                ...(legacyCode ? { legacyCode } : {}),
            });
        }

        throw new HttpError(403, safeAclMessage, {
            legacyCode: legacyCode ?? 'access_denied',
        });
    }

    async #assertBatchWriteAccess(
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

    #toEventGuiMetadata(
        guiMetadata: WriteGuiMetadata | undefined,
        includeOriginalClientSocketId = true,
    ): Record<string, unknown> {
        if (!guiMetadata) {
            return {};
        }

        return {
            ...(includeOriginalClientSocketId &&
            guiMetadata.originalClientSocketId
                ? {
                      original_client_socket_id:
                          guiMetadata.originalClientSocketId,
                  }
                : {}),
            ...(guiMetadata.socketId
                ? { socket_id: guiMetadata.socketId }
                : {}),
            ...(guiMetadata.operationId
                ? { operation_id: guiMetadata.operationId }
                : {}),
            ...(guiMetadata.itemUploadId
                ? { item_upload_id: guiMetadata.itemUploadId }
                : {}),
        };
    }

    async #toGuiFsEntry(entry: FSEntry): Promise<Record<string, unknown>> {
        return toLegacyEntry(this.clients.event, entry);
    }

    async #emitGuiWriteEvent(
        eventName: 'outer.gui.item.added' | 'outer.gui.item.updated',
        fsEntry: FSEntry,
        guiMetadata: WriteGuiMetadata | undefined,
    ): Promise<void> {
        const response = {
            ...(await this.#toGuiFsEntry(fsEntry)),
            ...this.#toEventGuiMetadata(guiMetadata),
            from_new_service: true,
        };
        await this.clients.event.emit(
            eventName,
            {
                user_id_list: [fsEntry.userId],
                response,
            },
            {},
        );
    }

    async #emitGuiPendingWriteEvent(
        userId: number,
        requestBody: SignedWriteRequest,
        response: SignedWriteResponse,
    ): Promise<void> {
        const normalizedPath = this.#normalizePath(
            requestBody.fileMetadata.path,
        );
        const pendingResponse = {
            id: response.objectKey,
            uid: response.objectKey,
            uuid: response.objectKey,
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
        await this.clients.event.emit(
            'outer.gui.item.pending',
            {
                user_id_list: [userId],
                response: pendingResponse,
            },
            {},
        );
    }

    #isAppDataPath(targetPath: string): boolean {
        const pathParts = targetPath.split('/').filter(Boolean);
        return pathParts.length >= 2 && pathParts[1] === 'AppData';
    }

    // If `actor` is effectively scoped to an app (directly or through an
    // access-token issuer chain), return that app's AppData root under the
    // actor's user. Returns undefined for pure user actors. The store anchors
    // search results to this path so app actors can't see entries outside
    // their AppData via `/fs/search`.
    #appDataScopeForActor(actor: Actor): string | undefined {
        const app = actor.effectiveApp;
        if (!app) return undefined;
        const username = actor.user?.username;
        if (typeof username !== 'string' || username.length === 0)
            return undefined;
        return `/${username}/AppData/${app.uid}`;
    }

    #estimateDataUrlSize(dataUrl: string): number {
        const commaIndex = dataUrl.indexOf(',');
        const base64 =
            commaIndex === -1 ? dataUrl : dataUrl.slice(commaIndex + 1);
        return Math.ceil((base64.length * 3) / 4);
    }

    #isOversizedThumbnailDataUrl(thumbnail: string): boolean {
        if (!thumbnail.startsWith('data:')) {
            return false;
        }
        return this.#estimateDataUrlSize(thumbnail) > MAX_THUMBNAIL_BYTES;
    }

    async #applyThumbnailAfterWrite(
        userId: number,
        fsEntry: FSEntry,
        requestedThumbnail: string | null | undefined,
    ): Promise<FSEntry> {
        if (!requestedThumbnail || this.#isAppDataPath(fsEntry.path)) {
            return fsEntry;
        }
        if (this.#isOversizedThumbnailDataUrl(requestedThumbnail)) {
            return fsEntry;
        }

        const thumbnailPayload = { url: requestedThumbnail };
        // emitAndWait — the thumbnails extension may rewrite `url` from a
        // data URL to an `s3://` pointer; plain `emit` races with the DB
        // update below.
        await this.clients.event.emitAndWait(
            'thumbnail.created',
            thumbnailPayload,
            {},
        );
        const finalThumbnail =
            typeof thumbnailPayload.url === 'string' &&
            thumbnailPayload.url.length > 0
                ? thumbnailPayload.url
                : null;

        if (finalThumbnail === fsEntry.thumbnail || finalThumbnail === null) {
            return fsEntry;
        }

        return this.services.fs.updateEntryThumbnail(
            userId,
            fsEntry.uuid,
            finalThumbnail,
        );
    }

    #toThumbnailPrepareItem(
        requestBody: SignedWriteRequest,
        index: number,
    ): ThumbnailUploadPrepareItem | null {
        if (requestBody.directory) {
            return null;
        }

        const thumbnailMetadata = requestBody.thumbnailMetadata;
        if (!thumbnailMetadata) {
            return null;
        }

        const contentType =
            typeof thumbnailMetadata.contentType === 'string'
                ? thumbnailMetadata.contentType.trim()
                : '';
        if (!contentType) {
            throw new HttpError(
                400,
                'thumbnailMetadata.contentType is required for signed thumbnail upload',
                { legacyCode: 'bad_request' },
            );
        }

        if (thumbnailMetadata.size === undefined) {
            return null;
        }

        const size = Number(thumbnailMetadata.size);
        if (!Number.isFinite(size) || size < 0) {
            throw new HttpError(
                400,
                'thumbnailMetadata.size must be a non-negative number',
                { legacyCode: 'bad_request' },
            );
        }
        if (size > MAX_THUMBNAIL_BYTES) {
            return null;
        }

        return { index, contentType, size } as ThumbnailUploadPrepareItem;
    }

    async #attachSignedThumbnailUploadTargets(
        requests: SignedWriteRequest[],
        responses: SignedWriteResponse[],
    ): Promise<void> {
        const prepareItems = requests
            .map((requestBody, index) =>
                this.#toThumbnailPrepareItem(requestBody, index),
            )
            .filter((item): item is ThumbnailUploadPrepareItem =>
                Boolean(item),
            );
        if (prepareItems.length === 0) {
            return;
        }

        const payload: ThumbnailUploadPreparePayload = {
            items: prepareItems.map(
                (item): ThumbnailUploadPrepareItem =>
                    ({
                        index: item.index,
                        contentType: item.contentType,
                        ...(item.size !== undefined ? { size: item.size } : {}),
                    }) as ThumbnailUploadPrepareItem,
            ),
        };
        // emitAndWait — listeners populate `uploadUrl` / `thumbnailUrl` on
        // each item; plain `emit` returns before the extension runs and we'd
        // read the payload back empty.
        await this.clients.event.emitAndWait(
            'thumbnail.upload.prepare',
            payload,
            {},
        );

        for (const item of payload.items) {
            const response = responses[item.index];
            if (!response) {
                throw new HttpError(
                    500,
                    'Failed to resolve signed thumbnail response target',
                    { legacyCode: 'internal_error' },
                );
            }
            if (
                typeof item.uploadUrl !== 'string' ||
                item.uploadUrl.length === 0
            ) {
                continue;
            }
            if (
                typeof item.thumbnailUrl !== 'string' ||
                item.thumbnailUrl.length === 0
            ) {
                continue;
            }

            response.thumbnailUploadUrl = item.uploadUrl;
            response.thumbnailUrl = item.thumbnailUrl;
        }
    }

    #assertNoInlineSignedThumbnailData(
        thumbnailData: string | undefined,
    ): void {
        if (typeof thumbnailData !== 'string') {
            return;
        }
        if (thumbnailData.startsWith('data:')) {
            throw new HttpError(
                400,
                'Signed write completion does not accept inline thumbnail data. Upload thumbnail to signed URL and provide thumbnail URL.',
                { legacyCode: 'bad_request' },
            );
        }
    }

    #isMultipartRequest(req: Request): boolean {
        const contentType = req.headers['content-type'];
        if (typeof contentType !== 'string') {
            return false;
        }
        return contentType.includes('multipart/form-data');
    }

    #resolveBatchWriteRequestMode(req: Request): 'multipart' | 'json' {
        if (this.#isMultipartRequest(req)) {
            return 'multipart';
        }

        const contentTypeHeader = req.headers['content-type'];
        const contentType =
            typeof contentTypeHeader === 'string'
                ? contentTypeHeader.toLowerCase()
                : '';

        if (
            contentType.includes('application/json') ||
            contentType.startsWith('text/plain;actually=json')
        ) {
            return 'json';
        }

        throw new HttpError(
            415,
            'Unsupported content type for batchWrite. Use multipart/form-data or application/json.',
            { legacyCode: 'bad_request' },
        );
    }

    async #runNonCritical(
        work: () => Promise<void>,
        operationName: string,
    ): Promise<void> {
        try {
            await work();
        } catch (error) {
            console.error(
                `prodfsv2 non-critical operation failed: ${operationName}`,
                error,
            );
        }
    }

    async #createUploadTracker(
        userId: number,
        itemUid: string,
        itemPath: string,
        expectedSize: number,
        guiMetadata: WriteGuiMetadata | undefined,
    ): Promise<UploadProgressTrackerLike> {
        const uploadTracker = new UploadProgressTracker();
        uploadTracker.setTotal(Math.max(0, expectedSize));

        const context = Context.get();
        if (!context) {
            return uploadTracker;
        }

        await this.clients.event.emit(
            'fs.storage.upload-progress',
            {
                upload_tracker: uploadTracker,
                context,
                meta: {
                    user_id: userId,
                    userId: userId,
                    item_uid: itemUid,
                    item_path: itemPath,
                    ...this.#toEventGuiMetadata(guiMetadata),
                },
            },
            {},
        );
        return uploadTracker;
    }

    async #emitWriteHashEvent(
        contentHashSha256: string | null | undefined,
        entryUuid: string,
    ): Promise<void> {
        if (!contentHashSha256) {
            return;
        }
        await this.clients.event.emit(
            'outer.fs.write-hash',
            {
                hash: contentHashSha256,
                uuid: entryUuid,
            },
            {},
        );
    }

    async #applyWriteResponseSideEffects(
        userId: number,
        response: WriteResponse,
        guiMetadata: WriteGuiMetadata | undefined,
    ): Promise<WriteResponse> {
        let fsEntry = response.fsEntry;

        const hashEventPromise = this.#runNonCritical(async () => {
            await this.#emitWriteHashEvent(
                response.contentHashSha256,
                fsEntry.uuid,
            );
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
                response.wasOverwrite
                    ? 'outer.gui.item.updated'
                    : 'outer.gui.item.added',
                fsEntry,
                guiMetadata,
            );
        }, 'emitGuiWriteEvent');

        await hashEventPromise;

        return { ...response, fsEntry };
    }

    #shouldIgnoreUploadPath(targetPath: string): boolean {
        return pathPosix.basename(targetPath).toLowerCase() === '.ds_store';
    }

    #parseBatchWriteManifest(
        manifestRaw: string,
        fallbackGuiMetadata: WriteGuiMetadata | undefined,
    ): ParsedMultipartBatchManifest {
        let parsedManifest: unknown;
        try {
            parsedManifest = JSON.parse(manifestRaw);
        } catch {
            throw new HttpError(400, 'Batch write manifest is not valid JSON', {
                legacyCode: 'bad_request',
            });
        }

        const manifest: BatchWriteManifest = Array.isArray(parsedManifest)
            ? { items: parsedManifest as BatchWriteManifestItem[] }
            : (parsedManifest as BatchWriteManifest);

        if (
            !manifest ||
            !Array.isArray(manifest.items) ||
            manifest.items.length === 0
        ) {
            throw new HttpError(
                400,
                'Batch write manifest must include a non-empty items array',
                { legacyCode: 'bad_request' },
            );
        }

        const manifestGuiMetadata = this.#extractGuiMetadata(
            manifest,
            fallbackGuiMetadata,
        );
        const normalizedItems = manifest.items.map((item, orderIndex) => {
            if (!item || typeof item !== 'object') {
                throw new HttpError(
                    400,
                    `Batch write manifest item at position ${orderIndex} is invalid`,
                    { legacyCode: 'bad_request' },
                );
            }

            const candidateIndex =
                (item as { index?: number | string }).index ?? orderIndex;
            const index = Number(candidateIndex);
            if (!Number.isInteger(index) || index < 0) {
                throw new HttpError(
                    400,
                    `Batch write manifest item index is invalid at position ${orderIndex}`,
                    { legacyCode: 'bad_request' },
                );
            }

            if (!item.fileMetadata || typeof item.fileMetadata !== 'object') {
                throw new HttpError(
                    400,
                    `Batch write manifest item ${index} is missing fileMetadata`,
                    { legacyCode: 'bad_request' },
                );
            }

            return {
                index,
                fileMetadata: item.fileMetadata,
                thumbnailData:
                    typeof item.thumbnailData === 'string'
                        ? item.thumbnailData
                        : undefined,
                guiMetadata: this.#extractGuiMetadata(
                    item,
                    manifestGuiMetadata,
                ),
            };
        });

        const seenIndexes = new Set<number>();
        const fieldIndexMap = new Map<string, number>();
        for (const item of normalizedItems) {
            if (seenIndexes.has(item.index)) {
                throw new HttpError(
                    409,
                    `Batch write manifest has duplicate index ${item.index}`,
                    { legacyCode: 'conflict' },
                );
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

    #resolveMultipartFileIndex(
        fieldName: string,
        fileOrderIndex: number,
        manifest: ParsedMultipartBatchManifest,
    ): number {
        const directMatch = manifest.fieldIndexMap.get(fieldName);
        if (directMatch !== undefined) {
            return directMatch;
        }

        if (/^\d+$/.test(fieldName)) {
            const parsedIndex = Number(fieldName);
            if (manifest.fieldIndexMap.get(String(parsedIndex)) !== undefined) {
                return parsedIndex;
            }
        }

        if (fieldName === 'file' || fieldName === 'files') {
            const itemAtPosition = manifest.items[fileOrderIndex];
            if (itemAtPosition) {
                return itemAtPosition.index;
            }
        }

        const fallbackItem = manifest.items[fileOrderIndex];
        if (fallbackItem) {
            return fallbackItem.index;
        }

        throw new HttpError(
            400,
            `Batch write file part "${fieldName}" does not map to manifest metadata`,
            { legacyCode: 'bad_request' },
        );
    }
}
