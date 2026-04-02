import path from '../../../lib/path.js';
import * as utils from '../../../lib/utils.js';
import getAbsolutePathForApp from '../utils/getAbsolutePathForApp.js';

/* eslint-disable */
const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;
const DEFAULT_THUMBNAIL_DIMENSION = 128;
const MIN_THUMBNAIL_DIMENSION = 32;
const SIGNED_BATCH_WRITE_CAPABILITY_KEY = 'signedBatchWriteSupported';
const SIGNED_BATCH_REQUEST_CHUNK_SIZE = 500;
const SIGNED_BATCH_CHUNK_PIPELINE_CONCURRENCY = 4;
const SIGNED_BATCH_FILE_UPLOAD_CONCURRENCY = 8;
const SIGNED_MULTIPART_PART_UPLOAD_CONCURRENCY = 8;
const SIGNED_BATCH_WRITE_UNAVAILABLE_STATUSES = new Set([404, 405, 501]);

const isLikelyImageFile = (file) => {
    if ( ! file ) return false;
    if ( file.type && file.type.startsWith('image/') ) return true;
    const name = (file.name || '').toLowerCase();
    return ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.tiff', '.avif', '.jfif'].some(ext => name.endsWith(ext));
};

const estimateDataUrlSize = (dataUrl) => {
    if ( ! dataUrl ) return 0;
    const commaIndex = dataUrl.indexOf(',');
    const base64 = commaIndex === -1 ? dataUrl : dataUrl.slice(commaIndex + 1);
    return Math.ceil(base64.length * 3 / 4);
};

const isDataUrl = (value) => {
    return typeof value === 'string' && value.startsWith('data:');
};

const parseDataUrlContentType = (dataUrl) => {
    if ( ! isDataUrl(dataUrl) ) return undefined;
    const commaIndex = dataUrl.indexOf(',');
    const metadata = commaIndex === -1
        ? dataUrl.slice(5)
        : dataUrl.slice(5, commaIndex);
    const [rawContentType] = metadata.split(';');
    const contentType = rawContentType ? rawContentType.trim() : '';
    return contentType || 'application/octet-stream';
};

const dataUrlToBlob = async (dataUrl) => {
    const response = await fetch(dataUrl);
    if ( ! response.ok ) {
        throw new Error('Failed to read thumbnail data URL');
    }
    return await response.blob();
};

const normalizeThumbnailData = (thumbnailData) => {
    if ( typeof thumbnailData !== 'string' || thumbnailData.length === 0 ) {
        return undefined;
    }
    if ( isDataUrl(thumbnailData) && estimateDataUrlSize(thumbnailData) > MAX_THUMBNAIL_BYTES ) {
        return undefined;
    }
    return thumbnailData;
};

const scaleDimensions = (width, height, maxDim) => {
    const base = Math.max(width, height) || 1;
    const scale = Math.min(1, maxDim / base);
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    return { width: w, height: h };
};

const loadImageFromFile = (file) => new Promise((resolve, reject) => {
    if ( typeof document === 'undefined' || typeof URL === 'undefined' || typeof Image === 'undefined' ) return resolve(null);
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
    };
    img.onerror = (e) => {
        URL.revokeObjectURL(url);
        reject(e);
    };
    img.src = url;
});

const renderThumbnail = (img, maxDim, type, quality) => {
    if ( !img || typeof document === 'undefined' ) return null;
    const { width, height } = scaleDimensions(img.naturalWidth || img.width, img.naturalHeight || img.height, maxDim);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if ( ! ctx ) return null;
    ctx.drawImage(img, 0, 0, width, height);
    try {
        return canvas.toDataURL(type, quality);
    } catch (e) {
        return null;
    }
};

const defaultThumbnailGenerator = async (file) => {
    try {
        if ( typeof document === 'undefined' ) return undefined;
        if ( typeof File === 'undefined' || !(file instanceof File) ) return undefined;
        if ( ! isLikelyImageFile(file) ) return undefined;

        const img = await loadImageFromFile(file);
        if ( ! img ) return undefined;

        let dimension = DEFAULT_THUMBNAIL_DIMENSION;
        const formats = [
            { type: 'image/webp', quality: 0.85 },
            { type: 'image/jpeg', quality: 0.8 },
            { type: 'image/png' },
        ];

        while ( dimension >= MIN_THUMBNAIL_DIMENSION ) {
            for ( const { type, quality } of formats ) {
                const dataUrl = renderThumbnail(img, dimension, type, quality);
                if ( ! dataUrl ) continue;
                if ( estimateDataUrlSize(dataUrl) <= MAX_THUMBNAIL_BYTES ) {
                    return dataUrl;
                }
            }
            dimension = Math.floor(dimension / 2);
        }
    } catch (e) {
        // Ignore thumbnail errors; upload should proceed without them.
        return undefined;
    }

    return undefined;
};

const parseFetchResponseBody = async (response) => {
    const text = await response.text();
    if ( ! text ) return null;

    try {
        return JSON.parse(text);
    } catch (e) {
        return text;
    }
};

const createApiHeaders = (authToken) => {
    const headers = {
        Authorization: `Bearer ${authToken}`,
        'Content-Type': 'application/json',
    };

    if ( ['web', 'app'].includes(puter.env) ) {
        headers.Origin = 'https://puter.work';
    }

    return headers;
};

const toRequestError = (response, body, fallbackMessage) => {
    const bodyRecord = body && typeof body === 'object' ? body : null;
    const message = bodyRecord?.message
        ?? (typeof bodyRecord?.error === 'string' ? bodyRecord.error : bodyRecord?.error?.message)
        ?? (typeof body === 'string' && body.length > 0 ? body : null)
        ?? fallbackMessage
        ?? `Request failed with status ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.body = body;
    if ( typeof bodyRecord?.code === 'string' && bodyRecord.code.length > 0 ) {
        error.code = bodyRecord.code;
    } else if ( typeof bodyRecord?.errorCode === 'string' && bodyRecord.errorCode.length > 0 ) {
        error.code = bodyRecord.errorCode;
    }
    return error;
};

const postJson = async (apiOrigin, authToken, endpoint, payload) => {
    const response = await fetch(`${apiOrigin}${endpoint}`, {
        method: 'POST',
        headers: createApiHeaders(authToken),
        credentials: 'include',
        body: JSON.stringify(payload),
    });
    const body = await parseFetchResponseBody(response);
    if ( ! response.ok ) {
        throw toRequestError(response, body, `Failed request to ${endpoint}`);
    }
    return body;
};

const isSignedBatchWriteUnavailableError = (error) => {
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

const toErrorMessage = (error) => {
    if ( error && typeof error === 'object' ) {
        if ( typeof error.message === 'string' && error.message.length > 0 ) {
            return error.message;
        }
        if ( typeof error.body === 'string' && error.body.length > 0 ) {
            return error.body;
        }
        if ( error.body && typeof error.body === 'object' ) {
            if ( typeof error.body.message === 'string' && error.body.message.length > 0 ) {
                return error.body.message;
            }
            if (
                error.body.error &&
                typeof error.body.error === 'object' &&
                typeof error.body.error.message === 'string' &&
                error.body.error.message.length > 0
            ) {
                return error.body.error.message;
            }
        }
    }
    return String(error);
};

const toSignedRequestPath = (baseDirPath, requestItem) => {
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

const chunkArray = (values, chunkSize) => {
    const chunks = [];
    if ( !Array.isArray(values) || values.length === 0 ) {
        return chunks;
    }

    const normalizedChunkSize = Math.max(1, Number(chunkSize) || 1);
    for ( let index = 0; index < values.length; index += normalizedChunkSize ) {
        chunks.push(values.slice(index, index + normalizedChunkSize));
    }
    return chunks;
};

const uploadBlobToSignedUrl = async ({
    url,
    blob,
    contentType,
    onProgress,
    onRequestCreated,
    onRequestCompleted,
}) => {
    return await new Promise((resolve, reject) => {
        const request = new XMLHttpRequest();
        request.open('PUT', url, true);
        request.withCredentials = false;

        if ( contentType ) {
            request.setRequestHeader('Content-Type', contentType);
        }

        if ( onRequestCreated ) {
            onRequestCreated(request);
        }

        let previousLoaded = 0;
        request.upload.addEventListener('progress', (event) => {
            if ( ! onProgress ) return;
            if ( ! event.lengthComputable ) return;

            const delta = Math.max(0, event.loaded - previousLoaded);
            previousLoaded = event.loaded;
            if ( delta > 0 ) {
                onProgress(delta);
            }
        });

        request.onload = () => {
            if ( onRequestCompleted ) {
                onRequestCompleted(request);
            }

            if ( blob.size > previousLoaded && onProgress ) {
                onProgress(blob.size - previousLoaded);
            }

            if ( request.status >= 200 && request.status < 300 ) {
                const etag = request.getResponseHeader('etag') ?? request.getResponseHeader('ETag');
                resolve({ etag });
                return;
            }

            const error = new Error(`Signed upload failed with status ${request.status}`);
            error.status = request.status;
            reject(error);
        };

        request.onerror = () => {
            if ( onRequestCompleted ) {
                onRequestCompleted(request);
            }
            const error = new Error('Network error during signed upload');
            error.status = request.status;
            reject(error);
        };

        request.onabort = () => {
            if ( onRequestCompleted ) {
                onRequestCompleted(request);
            }
            const error = new Error('Signed upload aborted');
            error.aborted = true;
            reject(error);
        };

        request.send(blob);
    });
};

const upload = async function (items, dirPath, options = {}) {
    return new Promise(async (resolve, reject) => {
        const DataTransferItem = globalThis.DataTransfer || (class DataTransferItem {
        });
        const FileList = globalThis.FileList || (class FileList {
        });
        const DataTransferItemList = globalThis.DataTransferItemList || (class DataTransferItemList {
        });

        // If auth token is not provided and we are in the web environment,
        // try to authenticate with Puter
        if ( !puter.authToken && puter.env === 'web' ) {
            try {
                await puter.ui.authenticateWithPuter();
            } catch (e) {
                // if authentication fails, throw an error
                reject(e);
            }
        }

        const error = (e) => {
            // if error callback is provided, call it
            if ( options.error && typeof options.error === 'function' )
            {
                options.error(e);
            }
            return reject(e);
        };

        // xhr object to be used for the upload
        let xhr = new XMLHttpRequest();

        // Can not write to root
        if ( dirPath === '/' )
        {
            return error('Can not upload to root directory.');
        }

        // If dirPath is not provided or it's not starting with a slash, it means it's a relative path
        // in that case, we need to prepend the app's root directory to it
        dirPath = getAbsolutePathForApp(dirPath);

        // Generate a unique ID for this upload operation
        // This will be used to uniquely identify this operation and its progress
        // across servers and clients
        const operation_id = utils.uuidv4();
        let start_callback_fired = false;

        // Call 'init' callback if provided
        // init is basically a hook that allows the user to get the operation ID and the XMLHttpRequest object
        if ( options.init && typeof options.init === 'function' ) {
            options.init(operation_id, xhr);
        }

        // keeps track of the amount of data uploaded to the server
        let bytes_uploaded_to_server = 0;
        // keeps track of the amount of data uploaded to the cloud
        let bytes_uploaded_to_cloud = 0;

        // This will hold the normalized entries to be uploaded
        // Since 'items' could be a DataTransferItemList, FileList, File, or an array of any of these,
        // we need to normalize it into an array of consistently formatted objects which will be held in 'entries'
        let entries;

        // will hold the total size of the upload
        let total_size = 0;
        let file_count = 0;

        let seemsToBeParsedDataTransferItems = false;
        if ( Array.isArray(items) && items.length > 0 ) {
            for ( let i = 0; i < items.length; i++ ) {
                if ( items[i] instanceof DataTransferItem || items[i] instanceof DataTransferItemList ) {
                    seemsToBeParsedDataTransferItems = true;
                }
            }
        }

        // DataTransferItemList
        if ( items instanceof DataTransferItemList || items instanceof DataTransferItem || items[0] instanceof DataTransferItem || options.parsedDataTransferItems ) {
            // if parsedDataTransferItems is true, it means the user has already parsed the DataTransferItems
            if ( options.parsedDataTransferItems )
            {
                entries = items;
            }
            else
            {
                entries = await puter.ui.getEntriesFromDataTransferItems(items);
            }

            // Sort entries by size ascending
            entries.sort((entry_a, entry_b) => {
                if ( entry_a.isDirectory && !entry_b.isDirectory ) return -1;
                if ( !entry_a.isDirectory && entry_b.isDirectory ) return 1;
                if ( entry_a.isDirectory && entry_b.isDirectory ) return 0;

                return entry_a.size - entry_b.size;
            });
        }
        // FileList/File
        else if ( items instanceof File || items[0] instanceof File || items instanceof FileList || items[0] instanceof FileList ) {
            if ( ! Array.isArray(items) )
            {
                entries = items instanceof FileList ? Array.from(items) : [items];
            }
            else
            {
                entries = items;
            }

            // Sort entries by size ascending
            entries.sort((entry_a, entry_b) => {
                return entry_a.size - entry_b.size;
            });
            // add FullPath property to each entry
            for ( let i = 0; i < entries.length; i++ ) {
                entries[i].filepath = entries[i].name;
                entries[i].fullPath = entries[i].name;
            }
        }
        // blob
        else if ( items instanceof Blob ) {
            // create a File object from the blob
            let file = new File([items], options.name, { type: 'application/octet-stream' });
            entries = [file];
            // add FullPath property to each entry
            for ( let i = 0; i < entries.length; i++ ) {
                entries[i].filepath = entries[i].name;
                entries[i].fullPath = entries[i].name;
            }
        }
        // String
        else if ( typeof items === 'string' ) {
            // create a File object from the string
            let file = new File([items], 'default.txt', { type: 'text/plain' });
            entries = [file];
            // add FullPath property to each entry
            for ( let i = 0; i < entries.length; i++ ) {
                entries[i].filepath = entries[i].name;
                entries[i].fullPath = entries[i].name;
            }
        }
        // Anything else is invalid
        else {
            return error({ code: 'field_invalid', message: 'upload() items parameter is an invalid type' });
        }

        // Will hold directories and files to be uploaded
        let dirs = [];
        let uniqueDirs = {};
        let files = [];

        // Separate files from directories
        for ( let i = 0; i < entries.length; i++ ) {
            // skip empty entries
            if ( ! entries[i] )
            {
                continue;
            }
            //collect dirs
            if ( entries[i].isDirectory )
            {
                const rawDirPath = entries[i].finalPath ? entries[i].finalPath : entries[i].fullPath;
                const relativeDirPath = typeof rawDirPath === 'string'
                    ? rawDirPath.replace(/^\/+/, '')
                    : '';
                dirs.push({ path: path.join(dirPath, relativeDirPath) });
            }
            // also files
            else {
                // Dragged and dropped files do not have a finalPath property and hence the fileItem will go undefined.
                // In such cases, we need default to creating the files as uploaded by the user.
                let fileItem = entries[i].finalPath || entries[i].filepath || entries[i].fullPath || entries[i].name;
                if ( typeof fileItem === 'string' ) {
                    fileItem = fileItem.replace(/^\/+/, '');
                }
                let [dirLevel, fileName] = [fileItem?.slice(0, fileItem?.lastIndexOf('/')), fileItem?.slice(fileItem?.lastIndexOf('/') + 1)];
                const normalizedFileName = typeof fileName === 'string'
                    ? fileName.trim().toLowerCase()
                    : '';
                if ( normalizedFileName === '.ds_store' ) {
                    continue;
                }

                // If file name is blank then we need to create only an empty directory.
                // On the other hand if the file name is not blank(could be undefined), we need to create the file.
                if ( fileName !== '' ) {
                    const normalizedFileItem = fileItem || entries[i].name;
                    entries[i].puter_full_path = path.join(dirPath, normalizedFileItem);
                    files.push(entries[i]);
                }
                if ( options.createFileParent && fileItem.includes('/') ) {
                    let incrementalDir;
                    dirLevel.split('/').forEach((directory) => {
                        incrementalDir = incrementalDir ? `${incrementalDir }/${ directory}` : directory;
                        let filePath = path.join(dirPath, incrementalDir);
                        // Prevent duplicate parent directory creation
                        if ( ! uniqueDirs[filePath] ) {
                            uniqueDirs[filePath] = true;
                            dirs.push({ path: filePath });
                        }
                    });
                }
            }
            // stats about the upload to come
            if ( entries[i].size !== undefined ) {
                total_size += (entries[i].size);
                file_count++;
            }
        }

        // Continue only if there are actually any files/directories to upload
        if ( dirs.length === 0 && files.length === 0 ) {
            return error({ code: 'EMPTY_UPLOAD', message: 'No files or directories to upload.' });
        }

        let thumbnails = [];
        const shouldGenerateThumbnails = options.generateThumbnails || options.thumbnailGenerator;
        if ( files.length && shouldGenerateThumbnails ) {
            const generator = options.thumbnailGenerator || defaultThumbnailGenerator;
            thumbnails = await Promise.all(files.map(async (file) => {
                try {
                    return await generator(file);
                } catch (e) {
                    return undefined;
                }
            }));
        }

        // Check storage capacity.
        // We need to check the storage capacity before the upload starts because
        // we want to avoid uploading files in case there is not enough storage space.
        // If we didn't check before upload starts, we could end up in a scenario where
        // the user uploads a very large folder/file and then the server rejects it because there is not enough space
        //
        // Space check in 'web' environment is currently not supported since it requires permissions.
        let storage;
        if ( puter.env !== 'web' ) {
            try {
                storage = await this.space();
                if ( storage.capacity - storage.used < total_size ) {
                    return error({ code: 'NOT_ENOUGH_SPACE', message: 'Not enough storage space available.' });
                }
            } catch (e) {
                // Ignored
            }
        }

        const signedDirectories = dirs.map((dir) => dir.path);

        const signedBatchWriteCapability = this[SIGNED_BATCH_WRITE_CAPABILITY_KEY];
        const signedBatchWriteAllowed = signedBatchWriteCapability !== false;


        const shouldAttemptSignedBatchWrite = (
            !options.shortcutTo &&
            (files.length > 0 || signedDirectories.length > 0) &&
            signedBatchWriteAllowed
        );

        if ( shouldAttemptSignedBatchWrite ) {
            const overwriteEnabled = options.overwrite ?? false;
            const shouldCreateMissingParents = Boolean(
                options.createMissingAncestors ||
                options.createMissingParents ||
                options.createFileParent ||
                dirs.length > 0
            );
            let signedTotalSizeForProgress = total_size > 0 ? total_size : 1;
            let signedBytesUploaded = 0;
            const activeSignedRequests = new Set();
            const pendingUploadIds = new Set();
            let signedUploadAborted = false;

            const emitSignedProgress = () => {
                let op_progress = ((signedBytesUploaded / signedTotalSizeForProgress) * 100).toFixed(2);
                op_progress = op_progress > 100 ? 100 : op_progress;
                if ( options.progress && typeof options.progress === 'function' ) {
                    options.progress(operation_id, op_progress);
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
                    options.abort(operation_id);
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
                const signedTotalBytes = total_size + signedThumbnailSizeTotal;
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
                                operationId: operation_id,
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
                        dedupeName: options.dedupeName ?? true,
                        createMissingParents: shouldCreateMissingParents,
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
                            operationId: operation_id,
                            itemUploadId: requestItem.itemUploadId,
                            socketId: this.socket.id,
                            originalClientSocketId: this.socket.id,
                        },
                    };
                });

                if ( options.start && typeof options.start === 'function' ) {
                    options.start();
                    start_callback_fired = true;
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
                                    operationId: operation_id,
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
                                operationId: operation_id,
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
                return resolve(signedItems);
            } catch (signedError) {
                if ( signedUploadAborted || signedError?.aborted ) {
                    return reject(signedError);
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
                } else {
                    return error(signedError);
                }
            }
        }

        // total size of the upload is doubled because we will be uploading the files to the server
        // and then the server will upload them to the cloud
        total_size = total_size * 2;

        // holds the data to be sent to the server
        const fd = new FormData();

        //-------------------------------------------------
        // Generate the requests to create all the
        // folders in this upload
        //-------------------------------------------------
        dirs.sort((a, b) => b.path.length - a.path.length);
        let mkdir_requests = [];

        for ( let i = 0; i < dirs.length; i++ ) {
            // update all file paths under this folder if dirname was changed
            for ( let j = 0; j < files.length; j++ ) {
                // if file is in this folder and has not been processed yet
                if ( !files[j].puter_path_param && path.join(dirPath, files[j].filepath).startsWith(`${dirs[i].path }/`) ) {
                    files[j].puter_path_param = `$dir_${i}/${ path.basename(files[j].filepath)}`;
                }
            }

            // update all subdirs under this dir
            for ( let k = 0; k < dirs.length; k++ ) {
                if ( !dirs[k].puter_path_param && dirs[k].path.startsWith(`${dirs[i].path }/`) ) {
                    dirs[k].puter_path_param = `$dir_${i}/${ path.basename(dirs[k].path)}`;
                }
            }
        }

        for ( let i = 0; i < dirs.length; i++ ) {
            let parent_path = path.dirname(dirs[i].puter_path_param || dirs[i].path);
            let dir_path = dirs[i].puter_path_param || dirs[i].path;

            // remove parent path from the beginning of path since path is relative to parent
            if ( parent_path !== '/' )
            {
                dir_path = dir_path.replace(parent_path, '');
            }

            mkdir_requests.push({
                op: 'mkdir',
                parent: parent_path,
                path: dir_path,
                overwrite: options.overwrite ?? false,
                dedupe_name: options.dedupeName ?? true,
                create_missing_ancestors: options.createMissingAncestors ?? true,
                as: `dir_${i}`,
            });
        }

        // inverse mkdir_requests so that the root folder is created first
        // and then go down the tree
        mkdir_requests.reverse();

        fd.append('operation_id', operation_id);
        fd.append('socket_id', this.socket.id);
        fd.append('original_client_socket_id', this.socket.id);

        // Append mkdir operations to upload request
        for ( let i = 0; i < mkdir_requests.length; i++ ) {
            fd.append('operation', JSON.stringify(mkdir_requests[i]));
        }

        // Append file metadata to upload request
        if ( ! options.shortcutTo ) {
            for ( let i = 0; i < files.length; i++ ) {
                const thumbnail = normalizeThumbnailData(thumbnails[i] ?? options.thumbnail ?? undefined);
                const fileinfo_payload = {
                    name: files[i].name,
                    type: files[i].type,
                    size: files[i].size,
                };
                if ( thumbnail ) {
                    fileinfo_payload.thumbnail = thumbnail;
                }
                fd.append('fileinfo', JSON.stringify({
                    ...fileinfo_payload,
                }));
            }
        }
        // Append write operations for each file
        for ( let i = 0; i < files.length; i++ ) {
            const thumbnail = normalizeThumbnailData(thumbnails[i] ?? options.thumbnail ?? undefined);
            const operation = {
                op: options.shortcutTo ? 'shortcut' : 'write',
                dedupe_name: options.dedupeName ?? true,
                overwrite: options.overwrite ?? false,
                thumbnail,
                create_missing_ancestors: (options.createMissingAncestors || options.createMissingParents),
                operation_id: operation_id,
                path: (
                    files[i].puter_path_param &&
                    path.dirname(files[i].puter_path_param ?? '')
                ) || (
                    files[i].filepath &&
                    path.join(dirPath, path.dirname(files[i].filepath))
                ) || '',
                name: path.basename(files[i].filepath),
                item_upload_id: i,
                shortcut_to: options.shortcutTo,
                shortcut_to_uid: options.shortcutTo,
                app_uid: options.appUID,
            };

            if ( thumbnail === undefined ) {
                delete operation.thumbnail;
            }

            fd.append('operation', JSON.stringify(operation));
        }

        // Append files to upload
        if ( ! options.shortcutTo ) {
            for ( let i = 0; i < files.length; i++ ) {
                fd.append('file', files[i] ?? '');
            }
        }

        const progress_handler = (msg) => {
            if ( msg.operation_id === operation_id ) {
                bytes_uploaded_to_cloud += msg.loaded_diff;
            }
        };

        // Handle upload progress events from server
        this.socket.on('upload.progress', progress_handler);

        // keeps track of the amount of data uploaded to the server
        let previous_chunk_uploaded = null;

        // open request to server
        xhr.open('post', (`${this.APIOrigin }/batch`), true);
        xhr.withCredentials = true;
        // set auth header
        xhr.setRequestHeader('Authorization', `Bearer ${ this.authToken}`);

        // -----------------------------------------------
        // Upload progress: client -> server
        // -----------------------------------------------
        xhr.upload.addEventListener('progress', function (e) {
            // update operation tracker
            let chunk_uploaded;
            if ( previous_chunk_uploaded === null ) {
                chunk_uploaded = e.loaded;
                previous_chunk_uploaded = 0;
            } else {
                chunk_uploaded = e.loaded - previous_chunk_uploaded;
            }
            previous_chunk_uploaded += chunk_uploaded;
            bytes_uploaded_to_server += chunk_uploaded;

            // overall operation progress
            let op_progress = ((bytes_uploaded_to_cloud + bytes_uploaded_to_server) / total_size * 100).toFixed(2);
            op_progress = op_progress > 100 ? 100 : op_progress;

            // progress callback function
            if ( options.progress && typeof options.progress === 'function' )
            {
                options.progress(operation_id, op_progress);
            }
        });

        // -----------------------------------------------
        // Upload progress: server -> cloud
        // the following code will check the progress of the upload every 100ms
        // -----------------------------------------------
        let cloud_progress_check_interval = setInterval(function () {
            // operation progress
            let op_progress = ((bytes_uploaded_to_cloud + bytes_uploaded_to_server) / total_size * 100).toFixed(2);

            op_progress = op_progress > 100 ? 100 : op_progress;
            if ( options.progress && typeof options.progress === 'function' )
            {
                options.progress(operation_id, op_progress);
            }
        }, 100);

        // -----------------------------------------------
        // onabort
        // -----------------------------------------------
        xhr.onabort = () => {
            // stop the cloud upload progress tracker
            clearInterval(cloud_progress_check_interval);
            // remove progress handler
            this.socket.off('upload.progress', progress_handler);
            // if an 'abort' callback is provided, call it
            if ( options.abort && typeof options.abort === 'function' )
            {
                options.abort(operation_id);
            }
        };

        // -----------------------------------------------
        // on success/error
        // -----------------------------------------------
        xhr.onreadystatechange = async (e) => {
            if ( xhr.readyState === 4 ) {
                const resp = await utils.parseResponse(xhr);
                // Error
                if ( (xhr.status >= 400 && xhr.status < 600) || (options.strict && xhr.status === 218) ) {
                    // stop the cloud upload progress tracker
                    clearInterval(cloud_progress_check_interval);

                    // remove progress handler
                    this.socket.off('upload.progress', progress_handler);

                    // If this is a 'strict' upload (i.e. status code is 218), we need to find out which operation failed
                    // and call the error callback with that operation.
                    if ( options.strict && xhr.status === 218 ) {
                        // find the operation that failed
                        let failed_operation;
                        for ( let i = 0; i < resp.results?.length; i++ ) {
                            if ( resp.results[i].status !== 200 ) {
                                failed_operation = resp.results[i];
                                break;
                            }
                        }
                        return error(failed_operation);
                    }

                    return error(resp);
                }
                // Success
                else {
                    if ( !resp || !resp.results || resp.results.length === 0 ) {
                        // no results
                        if ( puter.debugMode )
                        {
                            console.log('no results');
                        }
                    }

                    let items = resp.results;
                    items = items.length === 1 ? items[0] : items;

                    // if success callback is provided, call it
                    if ( options.success && typeof options.success === 'function' ) {
                        options.success(items);
                    }
                    // stop the cloud upload progress tracker
                    clearInterval(cloud_progress_check_interval);
                    // remove progress handler
                    this.socket.off('upload.progress', progress_handler);

                    return resolve(items);
                }
            }
        };

        // Fire off the 'start' event
        if ( !start_callback_fired && options.start && typeof options.start === 'function' ) {
            options.start();
            start_callback_fired = true;
        }

        // send request
        xhr.send(fd);
    });
};

export default upload;
