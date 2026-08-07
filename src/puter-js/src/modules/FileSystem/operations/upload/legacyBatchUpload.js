// Legacy batch upload strategy: everything (mkdir + write operations and file
// bytes) is streamed to the `/batch` endpoint in a single multipart request,
// with the server relaying the bytes on to cloud storage. Used when signed
// batch writes are unavailable or unsupported in the current environment.
// Invoked with the FileSystem module as `this`.

import { parseResponse } from '../../../../lib/networkUtils.js';
import path from 'path-browserify';
import { normalizeThumbnailData } from './thumbnails.js';

/** @typedef {{ error?: boolean, status?: number, message?: string, code?: string }} BatchResult */

/**
 * Whether a `/batch` per-operation result describes a failure. Failed
 * operations are marked with `error: true` and carry a non-200 `status`;
 * successful ones are plain filesystem entries with neither field.
 *
 * @param {unknown} result
 * @returns {boolean}
 */
const isFailedBatchResult = (result) => {
    if ( ! result || typeof result !== 'object' ) return false;
    if ( result.error === true ) return true;
    return typeof result.status === 'number' && result.status !== 200;
};

/**
 * Summarize a partially- or wholly-failed `/batch` response into a rejectable
 * `{ message, code }` error that still carries the per-operation results.
 *
 * @param {BatchResult[]} results
 * @param {BatchResult[]} failedResults
 * @returns {{
 *   message: string,
 *   code: 'batch_upload_failed' | 'batch_upload_partially_failed',
 *   status: number,
 *   results: BatchResult[],
 *   failedItems: BatchResult[],
 *   failedCount: number,
 *   totalCount: number,
 * }}
 */
const buildBatchFailureError = (results, failedResults) => {
    const totalCount = results.length;
    const failedCount = failedResults.length;
    const allFailed = failedCount > 0 && failedCount === totalCount;
    const reason = failedResults
        .map((result) => result?.message)
        .find((message) => typeof message === 'string' && message.length > 0);

    let message;
    if ( failedCount === 0 ) {
        // 218 without an identifiable failed operation: the server says
        // something failed but we can't say which, so report the weaker claim.
        message = 'Upload partially failed: the server reported a failed operation.';
    } else if ( allFailed ) {
        message = `Upload failed: ${reason ?? 'the server did not report a reason'}`;
    } else {
        message = `Upload partially failed: ${failedCount} of ${totalCount} operations failed`
            + ` (${reason ?? 'the server did not report a reason'})`;
    }

    return {
        message,
        code: allFailed ? 'batch_upload_failed' : 'batch_upload_partially_failed',
        status: 218,
        results,
        failedItems: failedResults,
        failedCount,
        totalCount,
    };
};

/**
 * Run the legacy `/batch` upload for the current operation. Settles the
 * caller's promise asynchronously through `ctx.resolve` / `ctx.error` once the
 * server responds.
 *
 * Must be called with the FileSystem module as `this`.
 *
 * @param {object} ctx
 * @returns {void}
 */
export function performLegacyBatchUpload (ctx) {
    const {
        options,
        dirPath,
        operationId,
        xhr,
        files,
        dirs,
        thumbnails,
        resolve,
        error,
        flags,
    } = ctx;

    // total size of the upload is doubled because we will be uploading the files to the server
    // and then the server will upload them to the cloud
    let totalSize = ctx.totalSize * 2;

    // keeps track of the amount of data uploaded to the server
    let bytesUploadedToServer = 0;
    // keeps track of the amount of data uploaded to the cloud
    let bytesUploadedToCloud = 0;

    // holds the data to be sent to the server
    const fd = new FormData();

    //-------------------------------------------------
    // Generate the requests to create all the
    // folders in this upload
    //-------------------------------------------------
    dirs.sort((a, b) => b.path.length - a.path.length);
    let mkdirRequests = [];

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
        let parentPath = path.dirname(dirs[i].puter_path_param || dirs[i].path);
        let relativeDirPath = dirs[i].puter_path_param || dirs[i].path;

        // remove parent path from the beginning of path since path is relative to parent
        if ( parentPath !== '/' )
        {
            relativeDirPath = relativeDirPath.replace(parentPath, '');
        }

        mkdirRequests.push({
            op: 'mkdir',
            parent: parentPath,
            path: relativeDirPath,
            overwrite: options.overwrite ?? false,
            dedupe_name: options.dedupeName ?? true,
            create_missing_ancestors: options.createMissingAncestors ?? true,
            as: `dir_${i}`,
        });
    }

    // inverse mkdirRequests so that the root folder is created first
    // and then go down the tree
    mkdirRequests.reverse();

    fd.append('operation_id', operationId);
    fd.append('socket_id', this.socket.id);
    fd.append('original_client_socket_id', this.socket.id);

    // Append mkdir operations to upload request
    for ( let i = 0; i < mkdirRequests.length; i++ ) {
        fd.append('operation', JSON.stringify(mkdirRequests[i]));
    }

    // Append file metadata to upload request
    if ( ! options.shortcutTo ) {
        for ( let i = 0; i < files.length; i++ ) {
            const thumbnail = normalizeThumbnailData(thumbnails[i] ?? options.thumbnail ?? undefined);
            const fileinfoPayload = {
                name: files[i].name,
                type: files[i].type,
                size: files[i].size,
            };
            if ( thumbnail ) {
                fileinfoPayload.thumbnail = thumbnail;
            }
            fd.append('fileinfo', JSON.stringify({
                ...fileinfoPayload,
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
            operation_id: operationId,
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

    const progressHandler = (msg) => {
        if ( msg.operation_id === operationId ) {
            bytesUploadedToCloud += msg.loaded_diff;
        }
    };

    // Handle upload progress events from server
    this.socket.on('upload.progress', progressHandler);

    // keeps track of the amount of data uploaded to the server
    let previousChunkUploaded = null;

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
        let chunkUploaded;
        if ( previousChunkUploaded === null ) {
            chunkUploaded = e.loaded;
            previousChunkUploaded = 0;
        } else {
            chunkUploaded = e.loaded - previousChunkUploaded;
        }
        previousChunkUploaded += chunkUploaded;
        bytesUploadedToServer += chunkUploaded;

        // overall operation progress
        let opProgress = ((bytesUploadedToCloud + bytesUploadedToServer) / totalSize * 100).toFixed(2);
        opProgress = opProgress > 100 ? 100 : opProgress;

        // progress callback function
        if ( options.progress && typeof options.progress === 'function' )
        {
            options.progress(operationId, opProgress);
        }
    });

    // -----------------------------------------------
    // Upload progress: server -> cloud
    // the following code will check the progress of the upload every 100ms
    // -----------------------------------------------
    let cloudProgressCheckInterval = setInterval(function () {
        // operation progress
        let opProgress = ((bytesUploadedToCloud + bytesUploadedToServer) / totalSize * 100).toFixed(2);

        opProgress = opProgress > 100 ? 100 : opProgress;
        if ( options.progress && typeof options.progress === 'function' )
        {
            options.progress(operationId, opProgress);
        }
    }, 100);

    // Stops the cloud upload progress tracker and unsubscribes the socket
    // handler; every terminal outcome of the request goes through this.
    const stopProgressTracking = () => {
        clearInterval(cloudProgressCheckInterval);
        this.socket.off('upload.progress', progressHandler);
    };

    // -----------------------------------------------
    // onabort
    // -----------------------------------------------
    xhr.onabort = () => {
        stopProgressTracking();
        // if an 'abort' callback is provided, call it
        if ( options.abort && typeof options.abort === 'function' )
        {
            options.abort(operationId);
        }
    };

    // -----------------------------------------------
    // on success/error
    // -----------------------------------------------

    xhr.onreadystatechange = async () => {
        if ( xhr.readyState !== 4 ) {
            return;
        }

        const resp = await parseResponse(xhr);
        const results = Array.isArray(resp?.results) ? resp.results : null;

        // Request-level failure: pass the server's body through unchanged.
        if ( xhr.status >= 400 && xhr.status < 600 ) {
            stopProgressTracking();
            return error(resp);
        }

        // `strict` (what `write()` uses) reports the failed operation itself
        // rather than a summary of the batch.
        if ( options.strict && xhr.status === 218 ) {
            stopProgressTracking();
            const failedOperation = results?.find(isFailedBatchResult) ?? results?.[0];
            return error(failedOperation);
        }

        // 218 means at least one operation failed. The body is still shaped
        // like a success, so resolving it would report an upload that wrote
        // nothing (or only part of what was asked for) as a success.
        const failedResults = results ? results.filter(isFailedBatchResult) : [];
        if ( xhr.status === 218 || failedResults.length > 0 ) {
            stopProgressTracking();
            return error(buildBatchFailureError(results ?? [], failedResults));
        }

        // A 2xx carrying no operation results means nothing was written.
        if ( ! results || results.length === 0 ) {
            stopProgressTracking();
            return error({
                message: 'Upload failed: the server returned no results.',
                code: 'batch_upload_no_results',
                status: xhr.status,
                results: [],
                failedItems: [],
                failedCount: 0,
                totalCount: 0,
            });
        }

        const items = results.length === 1 ? results[0] : results;

        // if success callback is provided, call it
        if ( options.success && typeof options.success === 'function' ) {
            options.success(items);
        }
        stopProgressTracking();

        return resolve(items);
    };

    // Fire off the 'start' event
    if ( !flags.startCallbackFired && options.start && typeof options.start === 'function' ) {
        options.start();
        flags.startCallbackFired = true;
    }

    // send request
    xhr.send(fd);
}
