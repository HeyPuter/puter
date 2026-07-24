// Legacy batch upload strategy: everything (mkdir + write operations and file
// bytes) is streamed to the `/batch` endpoint in a single multipart request,
// with the server relaying the bytes on to cloud storage. Used when signed
// batch writes are unavailable or unsupported in the current environment.
// Invoked with the FileSystem module as `this`.

import path from '../../../../lib/path.js';
import * as utils from '../../../../lib/utils.js';
import { normalizeThumbnailData } from './thumbnails.js';

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

    // -----------------------------------------------
    // onabort
    // -----------------------------------------------
    xhr.onabort = () => {
        // stop the cloud upload progress tracker
        clearInterval(cloudProgressCheckInterval);
        // remove progress handler
        this.socket.off('upload.progress', progressHandler);
        // if an 'abort' callback is provided, call it
        if ( options.abort && typeof options.abort === 'function' )
        {
            options.abort(operationId);
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
                clearInterval(cloudProgressCheckInterval);

                // remove progress handler
                this.socket.off('upload.progress', progressHandler);

                // If this is a 'strict' upload (i.e. status code is 218), we need to find out which operation failed
                // and call the error callback with that operation.
                if ( options.strict && xhr.status === 218 ) {
                    // find the operation that failed
                    let failedOperation;
                    for ( let i = 0; i < resp.results?.length; i++ ) {
                        if ( resp.results[i].status !== 200 ) {
                            failedOperation = resp.results[i];
                            break;
                        }
                    }
                    return error(failedOperation);
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
                clearInterval(cloudProgressCheckInterval);
                // remove progress handler
                this.socket.off('upload.progress', progressHandler);

                return resolve(items);
            }
        }
    };

    // Fire off the 'start' event
    if ( !flags.startCallbackFired && options.start && typeof options.start === 'function' ) {
        options.start();
        flags.startCallbackFired = true;
    }

    // send request
    xhr.send(fd);
}
