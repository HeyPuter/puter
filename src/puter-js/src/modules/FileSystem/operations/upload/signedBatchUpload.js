// Signed batch-write upload strategy. Files are registered with the backend in
// chunks (`/fs/startBatchWrite`), their bytes are PUT directly to signed storage
// URLs (single-shot or multipart), then finalized (`/fs/completeBatchWrite`).
// Invoked with the FileSystem module as `this`.

import path from '../../../../lib/path.js';
import {
    MAX_THUMBNAIL_BYTES,
    SIGNED_BATCH_WRITE_CAPABILITY_KEY,
    SIGNED_BATCH_REQUEST_CHUNK_SIZE,
    SIGNED_BATCH_CHUNK_PIPELINE_CONCURRENCY,
    SIGNED_BATCH_FILE_UPLOAD_CONCURRENCY,
    SIGNED_MULTIPART_PART_UPLOAD_CONCURRENCY,
    SIGNED_BATCH_WRITE_UNAVAILABLE_STATUSES,
} from './constants.js';
import { estimateDataUrlSize, isDataUrl, parseDataUrlContentType, dataUrlToBlob } from './dataUrl.js';
import { postJson, toErrorMessage, uploadBlobToSignedUrl } from './requests.js';
import { normalizeThumbnailData } from './thumbnails.js';
import { chunkArray } from './entries.js';

/**
 * Decide whether a failed batch-start means the backend simply doesn't support
 * signed batch writes (so the caller should fall back to the legacy path),
 * versus a genuine per-request error that should surface to the user.
 *
 * @param {unknown} error
 * @returns {boolean}
 */
export const isSignedBatchWriteUnavailableError = (error) => {
    if ( !error || typeof error !== 'object' ) return false;
    if ( error.signedBatchUnavailable === true ) return true;
    const errorBody = error.body && typeof error.body === 'object'
        ? error.body
        : null;
    const hasStructuredErrorCode = Boolean(
        typeof errorBody?.code === 'string' && errorBody.code.length > 0,
    ) || Boolean(
        typeof errorBody?.errorCode === 'string' && errorBody.errorCode.length > 0,
    );
    if ( hasStructuredErrorCode ) {
        return false;
    }
    return SIGNED_BATCH_WRITE_UNAVAILABLE_STATUSES.has(error.status);
};

/**
 * Resolve the destination path for a signed batch request item, used for
 * reporting which items failed.
 *
 * @param {string} baseDirPath
 * @param {{ type?: string, directoryPath?: string, file?: { puter_full_path?: string, filepath?: string, name?: string } }} requestItem
 * @returns {string | undefined}
 */
export const toSignedRequestPath = (baseDirPath, requestItem) => {
    if ( !requestItem || typeof requestItem !== 'object' ) {
        return undefined;
    }

    if ( requestItem.type === 'directory' ) {
        return requestItem.directoryPath;
    }

    if ( requestItem.type !== 'file' || !requestItem.file ) {
        return undefined;
    }

    const file = requestItem.file;
    return file.puter_full_path
        ?? path.join(baseDirPath, file.filepath || file.name || '');
};

/**
 * Run the signed batch-write upload for the current operation.
 *
 * Resolves/rejects the caller's promise (via `ctx.resolve` / `ctx.reject` /
 * `ctx.error`) and returns `true` when the upload was fully handled. Returns
 * `false` when the backend does not support signed batch writes, signalling the
 * caller to fall back to the legacy upload path.
 *
 * Must be called with the FileSystem module as `this`.
 *
 * @param {object} ctx
 * @returns {Promise<boolean>} `true` if settled, `false` to fall back to legacy
 */
export async function performSignedBatchUpload (ctx) {
    const {
        options,
        dirPath,
        operationId,
        xhr,
        files,
        dirs,
        signedDirectories,
        thumbnails,
        totalSize,
        resolve,
        reject,
        error,
        flags,
    } = ctx;

    const overwriteEnabled = options.overwrite ?? false;
    const shouldCreateMissingParents = Boolean(
        options.createMissingAncestors ||
        options.createMissingParents ||
        options.createFileParent ||
        dirs.length > 0
    );
    let signedTotalSizeForProgress = totalSize > 0 ? totalSize : 1;
    let signedBytesUploaded = 0;
    const activeSignedRequests = new Set();
    const pendingUploadIds = new Set();
    let signedUploadAborted = false;

    const emitSignedProgress = () => {
        let opProgress = ((signedBytesUploaded / signedTotalSizeForProgress) * 100).toFixed(2);
        opProgress = opProgress > 100 ? 100 : opProgress;
        if ( options.progress && typeof options.progress === 'function' ) {
            options.progress(operationId, opProgress);
        }
    };

    const addSignedProgress = (delta) => {
        if ( delta <= 0 ) return;
        signedBytesUploaded += delta;
        emitSignedProgress();
    };

    const abortStartedUploads = async () => {
        if ( pendingUploadIds.size === 0 ) return;
        const uploadIds = Array.from(pendingUploadIds);
        await Promise.all(uploadIds.map(async (uploadId) => {
            try {
                await postJson(this.APIOrigin, this.authToken, '/fs/abortWrite', { uploadId });
            } catch (e) {
                // Ignore abort failures during cleanup.
            }
        }));
        pendingUploadIds.clear();
    };

    const abortSignedUpload = async () => {
        if ( signedUploadAborted ) return;
        signedUploadAborted = true;
        for ( const request of activeSignedRequests ) {
            try {
                request.abort();
            } catch (e) {
                // Ignore individual abort errors.
            }
        }
        await abortStartedUploads();
        if ( options.abort && typeof options.abort === 'function' ) {
            options.abort(operationId);
        }
    };

    xhr.abort = () => {
        void abortSignedUpload();
    };

    try {
        const startRequestItems = [];
        for ( let index = 0; index < signedDirectories.length; index++ ) {
            startRequestItems.push({
                type: 'directory',
                directoryPath: signedDirectories[index],
                itemUploadId: `dir_${index}`,
            });
        }
        for ( let index = 0; index < files.length; index++ ) {
            startRequestItems.push({
                type: 'file',
                file: files[index],
                fileIndex: index,
                thumbnailData: normalizeThumbnailData(thumbnails[index] ?? options.thumbnail ?? undefined),
                itemUploadId: String(index),
            });
        }

        const signedThumbnailSizeTotal = startRequestItems.reduce((acc, requestItem) => {
            if ( requestItem.type !== 'file' ) {
                return acc;
            }
            if ( ! isDataUrl(requestItem.thumbnailData) ) {
                return acc;
            }
            return acc + estimateDataUrlSize(requestItem.thumbnailData);
        }, 0);
        const signedTotalBytes = totalSize + signedThumbnailSizeTotal;
        signedTotalSizeForProgress = signedTotalBytes > 0 ? signedTotalBytes : 1;

        const startBatchRequests = startRequestItems.map((requestItem) => {
            if ( requestItem.type === 'directory' ) {
                return {
                    fileMetadata: {
                        path: requestItem.directoryPath,
                        size: 0,
                        contentType: 'application/x-puter-directory',
                        overwrite: overwriteEnabled,
                        createMissingParents: shouldCreateMissingParents,
                    },
                    directory: true,
                    guiMetadata: {
                        operationId: operationId,
                        itemUploadId: requestItem.itemUploadId,
                        socketId: this.socket.id,
                        originalClientSocketId: this.socket.id,
                    },
                };
            }

            const file = requestItem.file;
            const targetPath = file.puter_full_path
                ?? path.join(dirPath, file.filepath || file.name);
            const fileMetadata = {
                path: targetPath,
                size: file.size,
                contentType: file.type || 'application/octet-stream',
                overwrite: overwriteEnabled,
                dedupeName: overwriteEnabled? false: options.dedupeName ?? true,
                createMissingParents: shouldCreateMissingParents,
                app_uid: options.appUID,
            };

            return {
                fileMetadata,
                ...(isDataUrl(requestItem.thumbnailData) ? {
                    thumbnailMetadata: {
                        contentType: parseDataUrlContentType(requestItem.thumbnailData),
                        size: estimateDataUrlSize(requestItem.thumbnailData),
                    },
                } : {}),
                guiMetadata: {
                    operationId: operationId,
                    itemUploadId: requestItem.itemUploadId,
                    socketId: this.socket.id,
                    originalClientSocketId: this.socket.id,
                },
            };
        });

        if ( options.start && typeof options.start === 'function' ) {
            options.start();
            flags.startCallbackFired = true;
        }

        const responseItemsByRequestIndex = new Map();
        const failedUploadItems = [];
        const failedCompletionItems = [];
        const startBatchRequestChunks = chunkArray(startBatchRequests, SIGNED_BATCH_REQUEST_CHUNK_SIZE);
        const startRequestItemChunks = chunkArray(startRequestItems, SIGNED_BATCH_REQUEST_CHUNK_SIZE);
        const startRequestIndexChunks = chunkArray(
            startRequestItems.map((_item, index) => index),
            SIGNED_BATCH_REQUEST_CHUNK_SIZE,
        );

        if (
            startBatchRequestChunks.length !== startRequestItemChunks.length
            || startBatchRequestChunks.length !== startRequestIndexChunks.length
        ) {
            throw new Error('Signed batch request chunk mapping is invalid');
        }

        const uploadSignedFileTask = async (uploadTask) => {
            const { requestIndex, requestItem, startResponse } = uploadTask;
            const file = requestItem.file;

            const thumbnailData = requestItem.thumbnailData;
            let completionThumbnailData;
            if ( isDataUrl(thumbnailData) ) {
                const thumbnailUploadUrl = startResponse.thumbnailUploadUrl;
                const thumbnailUrl = startResponse.thumbnailUrl;
                if ( thumbnailUploadUrl && thumbnailUrl ) {
                    const thumbnailBlob = await dataUrlToBlob(thumbnailData);
                    if ( thumbnailBlob.size <= MAX_THUMBNAIL_BYTES ) {
                        await uploadBlobToSignedUrl({
                            url: thumbnailUploadUrl,
                            blob: thumbnailBlob,
                            contentType: thumbnailBlob.type || parseDataUrlContentType(thumbnailData),
                            onProgress: addSignedProgress,
                            onRequestCreated: (request) => {
                                activeSignedRequests.add(request);
                            },
                            onRequestCompleted: (request) => {
                                activeSignedRequests.delete(request);
                            },
                        });
                        completionThumbnailData = thumbnailUrl;
                    }
                }
            } else if ( typeof thumbnailData === 'string' && thumbnailData.length > 0 ) {
                completionThumbnailData = thumbnailData;
            }

            if ( startResponse.uploadMode === 'multipart' ) {
                const partSize = Number(startResponse.multipartPartSize) || Math.max(file.size, 1);
                const declaredPartCount = Number(startResponse.multipartPartCount);
                const inferredPartCount = Math.max(1, Math.ceil(file.size / partSize));
                const partCount = Number.isInteger(declaredPartCount) && declaredPartCount > 0
                    ? declaredPartCount
                    : inferredPartCount;
                const partUrlMap = new Map();
                const providedPartUrls = Array.isArray(startResponse.multipartPartUrls)
                    ? startResponse.multipartPartUrls
                    : [];
                for ( const partUrl of providedPartUrls ) {
                    if ( partUrl?.partNumber && partUrl?.url ) {
                        partUrlMap.set(Number(partUrl.partNumber), partUrl.url);
                    }
                }

                const missingPartNumbers = [];
                for ( let partNumber = 1; partNumber <= partCount; partNumber++ ) {
                    if ( !partUrlMap.has(partNumber) ) {
                        missingPartNumbers.push(partNumber);
                    }
                }
                if ( missingPartNumbers.length > 0 ) {
                    const signPartsResponse = await postJson(
                        this.APIOrigin,
                        this.authToken,
                        '/fs/signMultipartParts',
                        {
                            uploadId: startResponse.sessionId,
                            partNumbers: missingPartNumbers,
                        },
                    );
                    const signedPartUrls = Array.isArray(signPartsResponse?.multipartPartUrls)
                        ? signPartsResponse.multipartPartUrls
                        : [];
                    for ( const partUrl of signedPartUrls ) {
                        if ( partUrl?.partNumber && partUrl?.url ) {
                            partUrlMap.set(Number(partUrl.partNumber), partUrl.url);
                        }
                    }
                }

                const completedParts = [];
                const allPartNumbers = [];
                for ( let partNumber = 1; partNumber <= partCount; partNumber++ ) {
                    allPartNumbers.push(partNumber);
                }
                const partNumberChunks = chunkArray(
                    allPartNumbers,
                    SIGNED_MULTIPART_PART_UPLOAD_CONCURRENCY,
                );

                for ( const partNumberChunk of partNumberChunks ) {
                    const partUploadSettledResults = await Promise.allSettled(partNumberChunk.map(async (partNumber) => {
                        const partUrl = partUrlMap.get(partNumber);
                        if ( !partUrl ) {
                            throw new Error(`Missing signed multipart URL for part ${partNumber}`);
                        }

                        const startByte = (partNumber - 1) * partSize;
                        const endByte = Math.min(startByte + partSize, file.size);
                        const partBlob = file.slice(startByte, endByte);
                        const uploadResult = await uploadBlobToSignedUrl({
                            url: partUrl,
                            blob: partBlob,
                            contentType: startResponse.contentType || file.type || 'application/octet-stream',
                            onProgress: addSignedProgress,
                            onRequestCreated: (request) => {
                                activeSignedRequests.add(request);
                            },
                            onRequestCompleted: (request) => {
                                activeSignedRequests.delete(request);
                            },
                        });
                        if ( !uploadResult.etag ) {
                            throw new Error(`Missing ETag for multipart part ${partNumber}`);
                        }

                        return {
                            partNumber,
                            etag: uploadResult.etag,
                        };
                    }));

                    for ( const partUploadSettledResult of partUploadSettledResults ) {
                        if ( partUploadSettledResult.status === 'rejected' ) {
                            throw partUploadSettledResult.reason;
                        }
                        completedParts.push(partUploadSettledResult.value);
                    }
                }
                completedParts.sort((partA, partB) => partA.partNumber - partB.partNumber);

                return {
                    requestIndex,
                    completionItem: {
                        uploadId: startResponse.sessionId,
                        parts: completedParts,
                        ...(completionThumbnailData !== undefined ? { thumbnailData: completionThumbnailData } : {}),
                        guiMetadata: {
                            operationId: operationId,
                            itemUploadId: requestItem.itemUploadId,
                            socketId: this.socket.id,
                            originalClientSocketId: this.socket.id,
                        },
                    },
                };
            }

            if ( !startResponse.url ) {
                throw new Error('Signed upload URL is missing');
            }

            await uploadBlobToSignedUrl({
                url: startResponse.url,
                blob: file,
                contentType: startResponse.contentType || file.type || 'application/octet-stream',
                onProgress: addSignedProgress,
                onRequestCreated: (request) => {
                    activeSignedRequests.add(request);
                },
                onRequestCompleted: (request) => {
                    activeSignedRequests.delete(request);
                },
            });

            return {
                requestIndex,
                completionItem: {
                    uploadId: startResponse.sessionId,
                    ...(completionThumbnailData !== undefined ? { thumbnailData: completionThumbnailData } : {}),
                    guiMetadata: {
                        operationId: operationId,
                        itemUploadId: requestItem.itemUploadId,
                        socketId: this.socket.id,
                        originalClientSocketId: this.socket.id,
                    },
                },
            };
        };

        const processSignedRequestChunk = async (chunkIndex) => {
            if ( signedUploadAborted ) {
                const abortError = new Error('Signed upload aborted');
                abortError.aborted = true;
                throw abortError;
            }

            const startBatchRequestChunk = startBatchRequestChunks[chunkIndex];
            const chunkRequestItems = startRequestItemChunks[chunkIndex];
            const chunkRequestIndexes = startRequestIndexChunks[chunkIndex];
            if ( !startBatchRequestChunk || !chunkRequestItems || !chunkRequestIndexes ) {
                throw new Error('Missing signed batch request chunk');
            }

            const chunkResponses = await postJson(
                this.APIOrigin,
                this.authToken,
                '/fs/startBatchWrite',
                startBatchRequestChunk,
            );

            if ( !Array.isArray(chunkResponses) ) {
                const unsupportedShapeError = new Error('Signed batch start response is invalid');
                unsupportedShapeError.signedBatchUnavailable = true;
                throw unsupportedShapeError;
            }
            if ( chunkResponses.length !== startBatchRequestChunk.length ) {
                throw new Error('Signed batch start response count mismatch');
            }

            const fileUploadTasks = [];
            for ( let index = 0; index < chunkResponses.length; index++ ) {
                const requestIndex = chunkRequestIndexes[index];
                const requestItem = chunkRequestItems[index];
                const startResponse = chunkResponses[index];
                if ( requestIndex === undefined || !requestItem || !startResponse ) {
                    throw new Error('Missing batch signed upload metadata');
                }

                if ( requestItem.type === 'directory' ) {
                    responseItemsByRequestIndex.set(requestIndex, startResponse.fsEntry ?? startResponse);
                    continue;
                }

                if ( !startResponse.sessionId ) {
                    throw new Error('Signed batch response missing sessionId');
                }

                pendingUploadIds.add(startResponse.sessionId);
                fileUploadTasks.push({
                    requestIndex,
                    requestItem,
                    startResponse,
                });
            }

            const completionItems = [];
            const localFailedUploadItems = [];
            const fileUploadTaskChunks = chunkArray(fileUploadTasks, SIGNED_BATCH_FILE_UPLOAD_CONCURRENCY);
            for ( const fileUploadTaskChunk of fileUploadTaskChunks ) {
                if ( signedUploadAborted ) {
                    const abortError = new Error('Signed upload aborted');
                    abortError.aborted = true;
                    throw abortError;
                }

                const uploadSettledResults = await Promise.allSettled(
                    fileUploadTaskChunk.map(async (uploadTask) => {
                        return await uploadSignedFileTask(uploadTask);
                    }),
                );

                for ( let resultIndex = 0; resultIndex < uploadSettledResults.length; resultIndex++ ) {
                    const uploadSettledResult = uploadSettledResults[resultIndex];
                    if ( uploadSettledResult?.status === 'rejected' ) {
                        const failedUploadTask = fileUploadTaskChunk[resultIndex];
                        if ( failedUploadTask ) {
                            localFailedUploadItems.push({
                                requestIndex: failedUploadTask.requestIndex,
                                uploadId: failedUploadTask.startResponse.sessionId,
                                error: uploadSettledResult.reason,
                            });
                        }
                        continue;
                    }

                    completionItems.push(uploadSettledResult.value);
                }
            }

            if ( localFailedUploadItems.length > 0 ) {
                const failedUploadIds = Array.from(new Set(localFailedUploadItems.map((item) => item.uploadId)));
                await Promise.allSettled(failedUploadIds.map(async (uploadId) => {
                    pendingUploadIds.delete(uploadId);
                    await postJson(this.APIOrigin, this.authToken, '/fs/abortWrite', { uploadId });
                }));
                failedUploadItems.push(...localFailedUploadItems);
            }

            if ( completionItems.length === 0 ) {
                return;
            }

            completionItems.sort((itemA, itemB) => itemA.requestIndex - itemB.requestIndex);
            const completionPayload = completionItems.map((item) => item.completionItem);
            const completionRequestIndexes = completionItems.map((item) => item.requestIndex);
            const completionPayloadChunks = chunkArray(completionPayload, SIGNED_BATCH_REQUEST_CHUNK_SIZE);
            const completionRequestIndexChunks = chunkArray(
                completionRequestIndexes,
                SIGNED_BATCH_REQUEST_CHUNK_SIZE,
            );
            if ( completionPayloadChunks.length !== completionRequestIndexChunks.length ) {
                throw new Error('Signed batch completion request mapping is invalid');
            }

            const localFailedCompletionItems = [];
            for ( let completionChunkIndex = 0; completionChunkIndex < completionPayloadChunks.length; completionChunkIndex++ ) {
                if ( signedUploadAborted ) {
                    const abortError = new Error('Signed upload aborted');
                    abortError.aborted = true;
                    throw abortError;
                }

                const completionPayloadChunk = completionPayloadChunks[completionChunkIndex];
                const completionRequestIndexChunk = completionRequestIndexChunks[completionChunkIndex];
                if ( !completionPayloadChunk || !completionRequestIndexChunk ) {
                    throw new Error('Missing signed batch completion request chunk');
                }

                try {
                    const completionResponses = await postJson(
                        this.APIOrigin,
                        this.authToken,
                        '/fs/completeBatchWrite',
                        completionPayloadChunk,
                    );

                    if ( !Array.isArray(completionResponses) ) {
                        throw new Error('Signed batch completion response is invalid');
                    }
                    if ( completionResponses.length !== completionPayloadChunk.length ) {
                        throw new Error('Signed batch completion response count mismatch');
                    }

                    for ( let index = 0; index < completionResponses.length; index++ ) {
                        const completionResponse = completionResponses[index];
                        const requestIndex = completionRequestIndexChunk[index];
                        const completionPayloadItem = completionPayloadChunk[index];
                        if ( requestIndex === undefined ) {
                            throw new Error('Missing request index for completed signed batch response');
                        }
                        if ( completionPayloadItem?.uploadId ) {
                            pendingUploadIds.delete(completionPayloadItem.uploadId);
                        }
                        responseItemsByRequestIndex.set(requestIndex, completionResponse?.fsEntry ?? completionResponse);
                    }
                } catch (completionChunkError) {
                    const completionItemSettledResults = await Promise.allSettled(completionPayloadChunk.map(async (completionItem) => {
                        return await postJson(
                            this.APIOrigin,
                            this.authToken,
                            '/fs/completeWrite',
                            completionItem,
                        );
                    }));

                    for ( let index = 0; index < completionItemSettledResults.length; index++ ) {
                        const completionItemSettledResult = completionItemSettledResults[index];
                        const requestIndex = completionRequestIndexChunk[index];
                        const completionPayloadItem = completionPayloadChunk[index];
                        if ( requestIndex === undefined || !completionPayloadItem ) {
                            continue;
                        }

                        if ( completionItemSettledResult?.status === 'fulfilled' ) {
                            pendingUploadIds.delete(completionPayloadItem.uploadId);
                            responseItemsByRequestIndex.set(
                                requestIndex,
                                completionItemSettledResult.value?.fsEntry ?? completionItemSettledResult.value,
                            );
                            continue;
                        }

                        localFailedCompletionItems.push({
                            requestIndex,
                            uploadId: completionPayloadItem.uploadId,
                            error: completionItemSettledResult?.status === 'rejected'
                                ? completionItemSettledResult.reason
                                : completionChunkError,
                        });
                    }
                }
            }

            if ( localFailedCompletionItems.length > 0 ) {
                const failedCompletionUploadIds = Array.from(new Set(localFailedCompletionItems.map((item) => item.uploadId)));
                await Promise.allSettled(failedCompletionUploadIds.map(async (uploadId) => {
                    pendingUploadIds.delete(uploadId);
                    await postJson(this.APIOrigin, this.authToken, '/fs/abortWrite', { uploadId });
                }));
                failedCompletionItems.push(...localFailedCompletionItems);
            }
        };

        const startChunkIndexes = startBatchRequestChunks.map((_chunk, index) => index);
        const startChunkGroups = chunkArray(
            startChunkIndexes,
            SIGNED_BATCH_CHUNK_PIPELINE_CONCURRENCY,
        );
        for ( const startChunkGroup of startChunkGroups ) {
            const startChunkSettledResults = await Promise.allSettled(startChunkGroup.map(async (chunkIndex) => {
                await processSignedRequestChunk(chunkIndex);
            }));
            for ( const startChunkSettledResult of startChunkSettledResults ) {
                if ( startChunkSettledResult.status === 'rejected' ) {
                    throw startChunkSettledResult.reason;
                }
            }
        }

        this[SIGNED_BATCH_WRITE_CAPABILITY_KEY] = true;

        const failedSignedItems = [
            ...failedUploadItems.map((item) => ({ ...item, stage: 'upload' })),
            ...failedCompletionItems.map((item) => ({ ...item, stage: 'complete' })),
        ];
        if ( failedSignedItems.length > 0 ) {
            const partialError = new Error('One or more signed batch file operations failed');
            const mappedFailedSignedItems = failedSignedItems.map((item) => {
                const requestItem = startRequestItems[item.requestIndex];
                const itemPath = toSignedRequestPath(dirPath, requestItem);
                return {
                    requestIndex: item.requestIndex,
                    uploadId: item.uploadId,
                    stage: item.stage,
                    path: itemPath,
                    name: typeof itemPath === 'string' && itemPath.length > 0
                        ? path.basename(itemPath)
                        : undefined,
                    message: toErrorMessage(item.error),
                };
            });
            partialError.partial = true;
            partialError.failedItems = mappedFailedSignedItems;
            partialError.failedPaths = mappedFailedSignedItems
                .map((item) => item.path)
                .filter((itemPath) => typeof itemPath === 'string' && itemPath.length > 0);
            partialError.completedItemCount = responseItemsByRequestIndex.size;
            partialError.totalItemCount = startRequestItems.length;
            throw partialError;
        }

        const signedItemsList = [];
        for ( let index = 0; index < startRequestItems.length; index++ ) {
            if ( !responseItemsByRequestIndex.has(index) ) {
                throw new Error(`Missing signed batch response item at index ${index}`);
            }
            signedItemsList.push(responseItemsByRequestIndex.get(index));
        }
        addSignedProgress(Math.max(0, signedTotalSizeForProgress - signedBytesUploaded));

        let signedItems = signedItemsList;
        signedItems = signedItems.length === 1 ? signedItems[0] : signedItems;

        if ( options.success && typeof options.success === 'function' ) {
            options.success(signedItems);
        }
        resolve(signedItems);
        return true;
    } catch (signedError) {
        if ( signedUploadAborted || signedError?.aborted ) {
            reject(signedError);
            return true;
        }

        const shouldFallbackToLegacy = isSignedBatchWriteUnavailableError(signedError);

        if ( isSignedBatchWriteUnavailableError(signedError) ) {
            this[SIGNED_BATCH_WRITE_CAPABILITY_KEY] = false;
        }

        try {
            await abortStartedUploads();
        } catch (e) {
            // Ignore cleanup errors.
        }

        if ( shouldFallbackToLegacy ) {
            delete xhr.abort;
            return false;
        } else {
            error(signedError);
            return true;
        }
    }
}
