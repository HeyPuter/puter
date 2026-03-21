import path from '../../../lib/path.js';
import * as utils from '../../../lib/utils.js';
import getAbsolutePathForApp from '../utils/getAbsolutePathForApp.js';

const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;
const DEFAULT_THUMBNAIL_DIMENSION = 128;
const MIN_THUMBNAIL_DIMENSION = 32;

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

const UNSUPPORTED_SIGNED_CODES = new Set([
    'signed_uploads_not_supported',
    'missing_filesystem_capability',
]);
const TRANSIENT_SIGNED_CODES = new Set([
    'upload_failed',
    'response_timeout',
    'temp_error',
    'internal_error',
]);
const FALLBACK_BLOCKED_CODES = new Set([
    'field_invalid',
    'fields_invalid',
    'field_missing',
    'field_too_long',
    'invalid_file_name',
    'item_with_same_name_exists',
    'storage_limit_reached',
    'file_too_large',
    'upload_metadata_mismatch',
    'upload_session_invalid_state',
    'upload_session_consumed',
    'upload_session_expired',
    'permission_denied',
    'forbidden',
    'immutable',
]);

const parseJsonSafe = async (response) => {
    try {
        return await response.json();
    } catch (e) {
        return null;
    }
};

const signedApiRequest = async ({
    apiOrigin,
    authToken,
    endpoint,
    method = 'POST',
    body,
}) => {
    let response;
    try {
        response = await fetch(`${apiOrigin}${endpoint}`, {
            method,
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json',
                ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
            },
            body: body ? JSON.stringify(body) : undefined,
        });
    } catch (e) {
        throw {
            code: 'upload_failed',
            message: e?.message ?? 'Network error while calling upload API.',
            network: true,
        };
    }

    const payload = await parseJsonSafe(response);
    if ( ! response.ok ) {
        const error = payload ?? {};
        error.status = response.status;
        if ( !error.code && response.status === 404 ) {
            error.code = 'signed_uploads_not_supported';
        }
        throw error;
    }
    return payload;
};

const shouldFallbackToLegacy = (error, options = {}) => {
    if ( options.disableSignedFallback ) return false;
    const code = error?.code;
    const status = Number(error?.status ?? 0);

    if ( code && FALLBACK_BLOCKED_CODES.has(code) ) return false;
    if ( code && UNSUPPORTED_SIGNED_CODES.has(code) ) return true;
    if ( code && TRANSIENT_SIGNED_CODES.has(code) ) return true;
    if ( !code && status === 404 ) return true;
    if ( status >= 500 ) return true;
    if ( error?.network ) return true;
    return false;
};

const uploadBlobToSignedUrl = async ({
    blob,
    upload,
    setAbortHandler,
    onLoaded,
    isAborted,
}) => {
    return await new Promise((resolve, reject) => {
        let loaded = 0;
        const xhr = new XMLHttpRequest();

        setAbortHandler(() => {
            xhr.abort();
        });

        xhr.open(upload.method ?? 'PUT', upload.url, true);
        for ( const [header, value] of Object.entries(upload.headers ?? {}) ) {
            if ( value !== undefined && value !== null ) {
                xhr.setRequestHeader(header, `${value}`);
            }
        }

        xhr.upload.onprogress = (event) => {
            const nextLoaded = Math.min(blob.size, event.loaded ?? loaded);
            const delta = Math.max(0, nextLoaded - loaded);
            loaded = nextLoaded;
            onLoaded(delta);
        };

        xhr.onerror = () => {
            reject({
                code: 'upload_failed',
                message: 'Failed to upload file to signed URL.',
                status: xhr.status || 0,
                network: true,
            });
        };

        xhr.onabort = () => {
            reject({
                code: 'upload_aborted',
                message: 'Upload aborted.',
                aborted: true,
            });
        };

        xhr.onreadystatechange = () => {
            if ( xhr.readyState !== 4 ) return;
            if ( xhr.status >= 200 && xhr.status < 300 ) {
                if ( loaded < blob.size ) {
                    onLoaded(blob.size - loaded);
                }
                resolve({
                    etag: xhr.getResponseHeader('etag'),
                });
                return;
            }

            if ( isAborted() || xhr.status === 0 ) {
                reject({
                    code: 'upload_aborted',
                    message: 'Upload aborted.',
                    aborted: true,
                });
                return;
            }

            reject({
                code: 'upload_failed',
                message: `Signed upload failed with status ${xhr.status}.`,
                status: xhr.status,
            });
        };

        xhr.send(blob);
    });
};

/* eslint-disable */
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
        let customAbort = null;
        const nativeAbort = xhr.abort.bind(xhr);
        xhr.abort = (...args) => {
            if ( customAbort ) {
                customAbort();
                return;
            }
            nativeAbort(...args);
        };
        const setCustomAbort = (abortHandler) => {
            customAbort = abortHandler;
        };

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
                dirs.push({ path: path.join(dirPath, entries[i].finalPath ? entries[i].finalPath : entries[i].fullPath) });
            }
            // also files
            else {
                // Dragged and dropped files do not have a finalPath property and hence the fileItem will go undefined.
                // In such cases, we need default to creating the files as uploaded by the user.
                let fileItem = entries[i].finalPath ? entries[i].finalPath : entries[i].fullPath;
                let [dirLevel, fileName] = [fileItem?.slice(0, fileItem?.lastIndexOf('/')), fileItem?.slice(fileItem?.lastIndexOf('/') + 1)];

                // If file name is blank then we need to create only an empty directory.
                // On the other hand if the file name is not blank(could be undefined), we need to create the file.
                fileName != '' && files.push(entries[i]);
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

        const canAttemptSignedUpload = (
            options.useSignedUploads !== false &&
            !options.shortcutTo &&
            dirs.length === 0 &&
            files.length > 0 &&
            !options.createFileParent &&
            files.every(file => {
                const fp = file.filepath ?? file.name ?? '';
                return !(`${fp}`.includes('/'));
            })
        );

        if ( canAttemptSignedUpload ) {
            let shouldFallback = false;
            let wasAborted = false;
            let started = false;
            let activeAbortHandler = null;
            const activeSessions = new Set();
            const signedItems = [];
            const totalSignedBytes = Math.max(1, files.reduce((acc, file) => acc + (file.size ?? 0), 0));
            let loadedSignedBytes = 0;

            const emitPhase = (phase) => {
                if ( options.phase && typeof options.phase === 'function' ) {
                    options.phase(operation_id, phase);
                }
            };
            const emitProgress = () => {
                const pct = Math.min(100, ((loadedSignedBytes / totalSignedBytes) * 100).toFixed(2));
                if ( options.progress && typeof options.progress === 'function' ) {
                    options.progress(operation_id, pct);
                }
            };
            const abortActiveSessions = async (reason = 'aborted_by_client') => {
                const sessions = Array.from(activeSessions);
                await Promise.all(sessions.map(async (sessionUid) => {
                    try {
                        await signedApiRequest({
                            apiOrigin: this.APIOrigin,
                            authToken: this.authToken,
                            endpoint: '/upload/abort',
                            body: {
                                session_uid: sessionUid,
                                reason,
                            },
                        });
                    } catch (e) {
                        // Best effort.
                    }
                }));
            };

            setCustomAbort(() => {
                wasAborted = true;
                try {
                    activeAbortHandler?.();
                } catch (e) {
                    // ignored
                }
                abortActiveSessions().catch(() => {});
            });

            try {
                emitPhase('preparing');

                for ( let i = 0; i < files.length; i++ ) {
                    const file = files[i];
                    const filename = path.basename(file.filepath ?? file.name);
                    const contentType = file.type || 'application/octet-stream';
                    const thumbnail = thumbnails[i] ?? options.thumbnail ?? undefined;

                    const prepareResponse = await signedApiRequest({
                        apiOrigin: this.APIOrigin,
                        authToken: this.authToken,
                        endpoint: '/upload/prepare',
                        body: {
                            parent_path: dirPath,
                            name: filename,
                            content_type: contentType,
                            size: file.size,
                            dedupe_name: options.dedupeName ?? true,
                            overwrite: options.overwrite ?? false,
                            thumbnail,
                            operation_id,
                            original_client_socket_id: this.socket?.id,
                            app_uid: options.appUID,
                        },
                    });

                    const sessionUid = prepareResponse.session_uid;
                    activeSessions.add(sessionUid);

                    if ( !started ) {
                        started = true;
                        if ( options.start && typeof options.start === 'function' ) {
                            options.start();
                        }
                    }

                    emitPhase('uploading');

                    if ( prepareResponse.upload_mode === 'single' ) {
                        await uploadBlobToSignedUrl({
                            blob: file,
                            upload: prepareResponse.upload,
                            setAbortHandler: (handler) => {
                                activeAbortHandler = handler;
                            },
                            onLoaded: (delta) => {
                                loadedSignedBytes += delta;
                                emitProgress();
                            },
                            isAborted: () => wasAborted,
                        });
                    } else {
                        const partSize = prepareResponse.upload?.part_size ?? (8 * 1024 * 1024);
                        const partCount = Math.max(1, Math.ceil(file.size / partSize));
                        const parts = [];

                        for ( let partNumber = 1; partNumber <= partCount; partNumber++ ) {
                            const start = (partNumber - 1) * partSize;
                            const end = Math.min(file.size, start + partSize);
                            const chunk = file.slice(start, end);

                            const signPartResponse = await signedApiRequest({
                                apiOrigin: this.APIOrigin,
                                authToken: this.authToken,
                                endpoint: '/upload/multipart/sign-part',
                                body: {
                                    session_uid: sessionUid,
                                    part_number: partNumber,
                                    content_length: chunk.size,
                                },
                            });

                            const uploadResponse = await uploadBlobToSignedUrl({
                                blob: chunk,
                                upload: signPartResponse.upload,
                                setAbortHandler: (handler) => {
                                    activeAbortHandler = handler;
                                },
                                onLoaded: (delta) => {
                                    loadedSignedBytes += delta;
                                    emitProgress();
                                },
                                isAborted: () => wasAborted,
                            });

                            if ( !uploadResponse?.etag ) {
                                throw {
                                    code: 'upload_multipart_parts_invalid',
                                    message: 'Missing ETag for multipart part upload.',
                                };
                            }

                            parts.push({
                                part_number: partNumber,
                                etag: uploadResponse.etag,
                            });
                        }

                        emitPhase('finalizing');
                        const completedItem = await signedApiRequest({
                            apiOrigin: this.APIOrigin,
                            authToken: this.authToken,
                            endpoint: '/upload/complete',
                            body: {
                                session_uid: sessionUid,
                                parts,
                                operation_id,
                                original_client_socket_id: this.socket?.id,
                            },
                        });
                        activeSessions.delete(sessionUid);
                        signedItems.push(completedItem);
                        continue;
                    }

                    emitPhase('finalizing');
                    const completedItem = await signedApiRequest({
                        apiOrigin: this.APIOrigin,
                        authToken: this.authToken,
                        endpoint: '/upload/complete',
                        body: {
                            session_uid: sessionUid,
                            operation_id,
                            original_client_socket_id: this.socket?.id,
                        },
                    });
                    activeSessions.delete(sessionUid);
                    signedItems.push(completedItem);
                }

                loadedSignedBytes = totalSignedBytes;
                emitProgress();

                const responseItems = signedItems.length === 1 ? signedItems[0] : signedItems;
                if ( options.success && typeof options.success === 'function' ) {
                    options.success(responseItems);
                }
                setCustomAbort(null);
                return resolve(responseItems);
            } catch (e) {
                const uploadAborted = wasAborted || e?.aborted || e?.code === 'upload_aborted';
                await abortActiveSessions(uploadAborted ? 'aborted_by_client' : 'aborted_after_error');
                setCustomAbort(null);

                if ( uploadAborted ) {
                    if ( options.abort && typeof options.abort === 'function' ) {
                        options.abort(operation_id);
                    }
                    return reject(e);
                }

                shouldFallback = signedItems.length === 0 && shouldFallbackToLegacy(e, options);
                if ( !shouldFallback ) {
                    return error(e);
                }
            }

            if ( !shouldFallback ) {
                return;
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
                const thumbnail = thumbnails[i] ?? options.thumbnail ?? undefined;
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
            const thumbnail = thumbnails[i] ?? options.thumbnail ?? undefined;
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
        if ( options.start && typeof options.start === 'function' ) {
            options.start();
        }

        // send request
        xhr.send(fd);
    });
};

export default upload;
