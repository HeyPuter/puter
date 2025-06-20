import * as utils from '../../../lib/utils.js';
import getAbsolutePathForApp from '../utils/getAbsolutePathForApp.js';
import path from "../../../lib/path.js"

const upload = async function(items, dirPath, options = {}){
    return new Promise(async (resolve, reject) => {
        const DataTransferItem = globalThis.DataTransfer || (class DataTransferItem {});
        const FileList = globalThis.FileList || (class FileList {});
        const DataTransferItemList = globalThis.DataTransferItemList || (class DataTransferItemList {});

        // If auth token is not provided and we are in the web environment, 
        // try to authenticate with Puter
        if(!puter.authToken && puter.env === 'web'){
            try{
                await puter.ui.authenticateWithPuter();
            }catch(e){
                // if authentication fails, throw an error
                reject(e);
            }
        }

        const error = (e) => {
            // if error callback is provided, call it
            if(options.error && typeof options.error === 'function')
                options.error(e);
            return reject(e);
        };

        // xhr object to be used for the upload
        let xhr = new XMLHttpRequest();

        // Can not write to root
        if(dirPath === '/')
            return error('Can not upload to root directory.');

        // If dirPath is not provided or it's not starting with a slash, it means it's a relative path
        // in that case, we need to prepend the app's root directory to it
        dirPath = getAbsolutePathForApp(dirPath);

        // Generate a unique ID for this upload operation
        // This will be used to uniquely identify this operation and its progress
        // across servers and clients
        const operation_id = utils.uuidv4();

        // Call 'init' callback if provided
        // init is basically a hook that allows the user to get the operation ID and the XMLHttpRequest object
        if(options.init && typeof options.init === 'function'){
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
        if(Array.isArray(items) && items.length > 0){
            for(let i=0; i<items.length; i++){
                if(items[i] instanceof DataTransferItem || items[i] instanceof DataTransferItemList){
                    seemsToBeParsedDataTransferItems = true;
                }
            }
        }

        // DataTransferItemList
        if(items instanceof DataTransferItemList || items instanceof DataTransferItem  || items[0] instanceof DataTransferItem || options.parsedDataTransferItems){
            // if parsedDataTransferItems is true, it means the user has already parsed the DataTransferItems
            if(options.parsedDataTransferItems)
                entries = items;
            else
                entries = await puter.ui.getEntriesFromDataTransferItems(items);

            // Sort entries by size ascending
            entries.sort((entry_a, entry_b) => {
                if ( entry_a.isDirectory && ! entry_b.isDirectory ) return -1;
                if ( ! entry_a.isDirectory && entry_b.isDirectory ) return 1;
                if ( entry_a.isDirectory && entry_b.isDirectory ) return 0;
        
                return entry_a.size - entry_b.size;
            });
        }
        // FileList/File
        else if(items instanceof File || items[0] instanceof File || items instanceof FileList || items[0] instanceof FileList){
            if(!Array.isArray(items))
                entries = items instanceof FileList ? Array.from(items) : [items];
            else
                entries = items;

            // Sort entries by size ascending
            entries.sort((entry_a, entry_b) => {
                return entry_a.size - entry_b.size;
            })
            // add FullPath property to each entry
            for(let i=0; i<entries.length; i++){
                entries[i].filepath = entries[i].name;
                entries[i].fullPath = entries[i].name;
            }
        }
        // blob
        else if(items instanceof Blob){
            // create a File object from the blob
            let file = new File([items], options.name, { type: "application/octet-stream" });
            entries = [file];
            // add FullPath property to each entry
            for(let i=0; i<entries.length; i++){
                entries[i].filepath = entries[i].name;
                entries[i].fullPath = entries[i].name;
            }
        }
        // String
        else if(typeof items === 'string'){
            // create a File object from the string
            let file = new File([items], 'default.txt', { type: "text/plain" });
            entries = [file];
            // add FullPath property to each entry
            for(let i=0; i<entries.length; i++){
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
        let uniqueDirs = {}
        let files = [];

        // Separate files from directories
        for(let i=0; i<entries.length; i++){
            // skip empty entries
            if(!entries[i])
                continue;
            //collect dirs
            if(entries[i].isDirectory)
                dirs.push({path: path.join(dirPath, entries[i].finalPath ? entries[i].finalPath : entries[i].fullPath)});
            // also files
            else{
                // Dragged and dropped files do not have a finalPath property and hence the fileItem will go undefined.
                // In such cases, we need default to creating the files as uploaded by the user.
                let fileItem = entries[i].finalPath ? entries[i].finalPath : entries[i].fullPath;
                let [dirLevel, fileName] = [fileItem?.slice(0, fileItem?.lastIndexOf("/")), fileItem?.slice(fileItem?.lastIndexOf("/") + 1)]
                
                // If file name is blank then we need to create only an empty directory.
                // On the other hand if the file name is not blank(could be undefined), we need to create the file.
                fileName != "" && files.push(entries[i])
                if (options.createFileParent && fileItem.includes('/')) {
                    let incrementalDir;
                    dirLevel.split('/').forEach((directory) => {
                        incrementalDir = incrementalDir ? incrementalDir + '/' + directory : directory;
                        let filePath = path.join(dirPath, incrementalDir)
                        // Prevent duplicate parent directory creation
                        if(!uniqueDirs[filePath]){
                            uniqueDirs[filePath] = true;
                            dirs.push({path: filePath});
                        }
                    })
                }
            }
            // stats about the upload to come
            if(entries[i].size !== undefined){
                total_size += (entries[i].size);
                file_count++;
            }
        }

        // Continue only if there are actually any files/directories to upload
        if(dirs.length === 0 && files.length === 0){
            return error({code: 'EMPTY_UPLOAD', message: 'No files or directories to upload.'});
        }

        // Check storage capacity.
        // We need to check the storage capacity before the upload starts because
        // we want to avoid uploading files in case there is not enough storage space.
        // If we didn't check before upload starts, we could end up in a scenario where
        // the user uploads a very large folder/file and then the server rejects it because there is not enough space
        //
        // Space check in 'web' environment is currently not supported since it requires permissions.
        let storage;
        if(puter.env !== 'web'){
            try{
                storage = await this.space();
                if(storage.capacity - storage.used < total_size){
                    return error({code: 'NOT_ENOUGH_SPACE', message: 'Not enough storage space available.'});
                }
            }catch(e){
                // Ignored
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
    
        for(let i=0; i < dirs.length; i++){
            // update all file paths under this folder if dirname was changed
            for(let j=0; j<files.length; j++){
                // if file is in this folder and has not been processed yet
                if(!files[j].puter_path_param && path.join(dirPath, files[j].filepath).startsWith((dirs[i].path) + '/')){
                    files[j].puter_path_param = `$dir_${i}/`+ path.basename(files[j].filepath);
                }
            }
    
            // update all subdirs under this dir
            for(let k=0; k < dirs.length; k++){
                if(!dirs[k].puter_path_param && dirs[k].path.startsWith(dirs[i].path + '/')){
                    dirs[k].puter_path_param = `$dir_${i}/`+ path.basename(dirs[k].path);
                }
            }
        }

        for(let i=0; i < dirs.length; i++){
            let parent_path = path.dirname(dirs[i].puter_path_param || dirs[i].path);
            let dir_path = dirs[i].puter_path_param || dirs[i].path;
            
            // remove parent path from the beginning of path since path is relative to parent
            if(parent_path !== '/')
                dir_path = dir_path.replace(parent_path, '');
    
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
        for(let i=0; i<mkdir_requests.length; i++){
            fd.append('operation', JSON.stringify(mkdir_requests[i]));          
        }
    
        // Append file metadata to upload request
        if(!options.shortcutTo){
            for(let i=0; i<files.length; i++){
                fd.append('fileinfo', JSON.stringify({
                    name: files[i].name,
                    type: files[i].type,
                    size: files[i].size,
                }));
            }
        }
        // Append write operations for each file
        for(let i=0; i<files.length; i++){
            fd.append('operation', JSON.stringify({
                op: options.shortcutTo ? 'shortcut' : 'write',
                dedupe_name: options.dedupeName ?? true,
                overwrite: options.overwrite ?? false,
                create_missing_ancestors: (options.createMissingAncestors ||  options.createMissingParents),
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
            }));
        }
        
        // Append files to upload
        if(!options.shortcutTo){
            for(let i=0; i<files.length; i++){
                fd.append('file', files[i] ?? '');
            }
        }
    
        const progress_handler = (msg) => {
            if(msg.operation_id === operation_id){
                bytes_uploaded_to_cloud += msg.loaded_diff
            }
        }

        // Handle upload progress events from server
        this.socket.on('upload.progress', progress_handler);

        // keeps track of the amount of data uploaded to the server
        let previous_chunk_uploaded = null;
    
        // open request to server
        xhr.open("post",(this.APIOrigin +'/batch'), true);
        // set auth header
        xhr.setRequestHeader("Authorization", "Bearer " + this.authToken);

        // -----------------------------------------------
        // Upload progress: client -> server
        // -----------------------------------------------
        xhr.upload.addEventListener('progress', function(e){
            // update operation tracker
            let chunk_uploaded;
            if(previous_chunk_uploaded === null){
                chunk_uploaded = e.loaded;
                previous_chunk_uploaded = 0;
            }else{
                chunk_uploaded = e.loaded - previous_chunk_uploaded;
            }
            previous_chunk_uploaded += chunk_uploaded;
            bytes_uploaded_to_server += chunk_uploaded;

            // overall operation progress
            let op_progress = ((bytes_uploaded_to_cloud + bytes_uploaded_to_server)/total_size * 100).toFixed(2);
            op_progress = op_progress > 100 ? 100 : op_progress;

            // progress callback function
            if(options.progress && typeof options.progress === 'function')
                options.progress(operation_id, op_progress);
        })
    
        // -----------------------------------------------
        // Upload progress: server -> cloud
        // the following code will check the progress of the upload every 100ms
        // -----------------------------------------------
        let cloud_progress_check_interval = setInterval(function() {
            // operation progress
            let op_progress = ((bytes_uploaded_to_cloud + bytes_uploaded_to_server)/total_size * 100).toFixed(2);
    
            op_progress = op_progress > 100 ? 100 : op_progress;
            if(options.progress && typeof options.progress === 'function')
                options.progress(operation_id, op_progress);
        }, 100);
    
        // -----------------------------------------------
        // onabort
        // -----------------------------------------------
        xhr.onabort = ()=>{
            // stop the cloud upload progress tracker
            clearInterval(cloud_progress_check_interval);
            // remove progress handler
            this.socket.off('upload.progress', progress_handler);
            // if an 'abort' callback is provided, call it
            if(options.abort && typeof options.abort === 'function')
                options.abort(operation_id);
        }

        // -----------------------------------------------
        // on success/error
        // -----------------------------------------------
        xhr.onreadystatechange = async (e)=>{
            if (xhr.readyState === 4) {
                const resp = await utils.parseResponse(xhr);
                // Error 
                if((xhr.status >= 400 && xhr.status < 600) || (options.strict && xhr.status === 218)) {
                    // stop the cloud upload progress tracker
                    clearInterval(cloud_progress_check_interval);

                    // remove progress handler
                    this.socket.off('upload.progress', progress_handler);

                    // If this is a 'strict' upload (i.e. status code is 218), we need to find out which operation failed 
                    // and call the error callback with that operation.
                    if(options.strict && xhr.status === 218){
                        // find the operation that failed
                        let failed_operation;
                        for(let i=0; i<resp.results?.length; i++){
                            if(resp.results[i].status !== 200){
                                failed_operation = resp.results[i];
                                break;
                            }
                        }
                        return error(failed_operation);
                    }

                    return error(resp);
                }
                // Success
                else{
                    if(!resp || !resp.results || resp.results.length === 0){
                        // no results
                        if(puter.debugMode)
                            console.log('no results');
                    }
    
                    let items = resp.results;
                    items = items.length === 1 ? items[0] : items;

                    // if success callback is provided, call it
                    if(options.success && typeof options.success === 'function'){
                        options.success(items);
                    }
                    // stop the cloud upload progress tracker
                    clearInterval(cloud_progress_check_interval);
                    // remove progress handler
                    this.socket.off('upload.progress', progress_handler);

                    return resolve(items);
                }
            }
        }
    
        // Fire off the 'start' event
        if(options.start && typeof options.start === 'function'){
            options.start();
        }

        // send request
        xhr.send(fd);
    })
}

export default upload;