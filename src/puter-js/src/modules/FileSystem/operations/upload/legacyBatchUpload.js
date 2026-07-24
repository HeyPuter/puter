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
        operation_id,
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
    let total_size = ctx.total_size * 2;

    // keeps track of the amount of data uploaded to the server
    let bytes_uploaded_to_server = 0;
    // keeps track of the amount of data uploaded to the cloud
    let bytes_uploaded_to_cloud = 0;

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
    if ( !flags.startCallbackFired && options.start && typeof options.start === 'function' ) {
        options.start();
        flags.startCallbackFired = true;
    }

    // send request
    xhr.send(fd);
}
