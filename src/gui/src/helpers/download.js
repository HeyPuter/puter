/**
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

/**
 * Launches a download process for an item, tracking its progress and handling success or error states.
 * The function returns a promise that resolves with the downloaded item or rejects in case of an error.
 * It uses XMLHttpRequest to manage the download and tracks progress both for the individual item and the entire batch it belongs to.
 *
 * @param {Object} options - Configuration options for the download process.
 * @param {string} options.url - The URL from which the item will be downloaded.
 * @param {string} options.operation_id - Unique identifier for the download operation, used for progress tracking.
 * @param {string} options.item_upload_id - Identifier for the specific item being downloaded, used for individual progress tracking.
 * @param {string} [options.name] - Optional name for the item being downloaded.
 * @param {string} [options.dest_path] - Destination path for the downloaded item.
 * @param {string} [options.shortcut_to] - Optional shortcut path for the item.
 * @param {boolean} [options.dedupe_name=false] - Flag to enable or disable deduplication of item names.
 * @param {boolean} [options.overwrite=false] - Flag to enable or disable overwriting of existing items.
 * @param {function} [options.success] - Optional callback function that is executed on successful download.
 * @param {function} [options.error] - Optional callback function that is executed in case of an error.
 * @param {number} [options.return_timeout=500] - Optional timeout in milliseconds before resolving the download.
 * @returns {Promise<Object>} A promise that resolves with the downloaded item or rejects with an error.
 */
const download = function(options){
    return new Promise((resolve, reject) => {
        // The item that is being downloaded and will be returned to the caller at the end of the process
        let item;
        // Intervals that check for progress and cancel every few milliseconds
        let progress_check_interval, cancel_check_interval;
        // Progress tracker for the entire batch to which this item belongs
        let batch_download_progress = window.progress_tracker[options.operation_id];
        // Tracker for this specific item's download progress
        let item_download_progress = batch_download_progress[options.item_upload_id];

        let xhr = new XMLHttpRequest();
        xhr.open("post", (window.api_origin + '/download'), true);
        xhr.setRequestHeader("Authorization", "Bearer " + window.auth_token);
        xhr.setRequestHeader("Content-Type", "application/json;charset=UTF-8");

        xhr.addEventListener('load', function(e){
            // error
            if(this.status !== 200){
                if(options.error && typeof options.error === 'function')
                    options.error(JSON.parse(this.responseText))
                return reject(JSON.parse(this.responseText))
            }
            // success
            else{
                item = JSON.parse(this.responseText);
            }
        });

        // error
        xhr.addEventListener('error', function(e){
            if(options.error && typeof options.error === 'function')
                options.error(e)
            return reject(e)
        })

        xhr.send(JSON.stringify({
            url: options.url,
            operation_id: options.operation_id,
            socket_id: window.socket ? window.socket.id : null,
            item_upload_id: options.item_upload_id,
            // original_client_socket_id: window.socket.id,
            name: options.name,
            path: options.dest_path,
            shortcut_to: options.shortcut_to,
            dedupe_name: options.dedupe_name ?? false,
            overwrite: options.overwrite ?? false,
        }));

        //----------------------------------------------
        // Regularly check if this operation has been cancelled by the user
        //----------------------------------------------
        cancel_check_interval = setInterval(() => {
            if(window.operation_cancelled[options.operation_id]){
                xhr.abort();
                clearInterval(cancel_check_interval);
                clearInterval(progress_check_interval);
            }
        }, 100);

        //----------------------------------------------
        // Regularly check the progress of the cloud-write operation
        //----------------------------------------------
        progress_check_interval = setInterval(function() {
            // Individual item progress
            let item_progress = 1;
            if(item_download_progress.total)
                item_progress = (item_download_progress.cloud_uploaded + item_download_progress.downloaded) / item_download_progress.total;

            // Entire batch progress
            let batch_progress = ((batch_download_progress[0].cloud_uploaded + batch_download_progress[0].downloaded)/batch_download_progress[0].total * 100).toFixed(0);
            batch_progress = batch_progress > 100 ? 100 : batch_progress;

            // If download is finished resolve promise
            if((item_progress >= 1 || item_progress === 0) && item){
                // For a better UX, resolve 0.5 second after operation is finished.
                setTimeout(function() {
                    clearInterval(progress_check_interval);
                    clearInterval(cancel_check_interval);
                    if(options.success && typeof options.success === 'function'){
                        options.success(item)
                    }
                    resolve(item);
                }, options.return_timeout ?? 500);
                // Stop and clear the cloud progress check interval
                clearInterval(progress_check_interval)
            }
        }, 200);
        return xhr;
    })
}

export default download;
