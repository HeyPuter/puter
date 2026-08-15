// Orchestrates a file/directory upload: authenticate, normalize the many
// accepted input shapes, generate thumbnails, check storage, then run the
// upload through the signed batch-write path (falling back to the legacy
// `/batch` path when signed writes are unavailable).

import * as utils from '../../../../lib/utils.js';
import getAbsolutePathForApp from '../../utils/getAbsolutePathForApp.js';
import { promptIfStorageLimitError } from '../storageLimitPrompt.js';
import { SIGNED_BATCH_WRITE_CAPABILITY_KEY, SIGNED_BATCH_SUPPORTED_ENVS, SPACE_CHECK_MIN_BYTES } from './constants.js';
import { normalizeUploadEntries, separateFilesAndDirs } from './entries.js';
import { generateThumbnails } from './thumbnails.js';
import { performSignedBatchUpload } from './signedBatchUpload.js';
import { performLegacyBatchUpload } from './legacyBatchUpload.js';

/** @typedef {import('../../types.js').UploadItems} UploadItems */
/** @typedef {import('../../types.js').UploadOptions} UploadOptions */
/** @typedef {import('../../../FSItem.js').FSItem} FSItem */

/**
 * @typedef {(
 *   this: import('../../index.js').PuterJSFileSystemModule,
 *   items: UploadItems,
 *   dirPath?: string,
 *   options?: UploadOptions,
 * ) => Promise<FSItem | FSItem[]>} UploadOperation
 */

/**
 * Uploads local items — files, blobs, strings, directory entries, or a
 * `DataTransferItemList` from a drop — into `dirPath`, which defaults to the
 * app's root directory. Resolves to a single `FSItem` when one item was
 * uploaded and an array when several were; rejects when any part of the
 * upload failed, so the resolved value never mixes items with errors.
 *
 * @this {import('../../index.js').PuterJSFileSystemModule}
 * @param {UploadItems} items
 * @param {string} [dirPath]
 * @param {UploadOptions} [options]
 * @returns {Promise<FSItem | FSItem[]>}
 */
const uploadImpl = async function (items, dirPath, options = {}) {
    return new Promise(async (resolve, reject) => {
        // If auth token is not provided and we are in the web environment,
        // try to authenticate with Puter
        if ( !puter.authToken && puter.env === 'web' ) {
            try {
                await puter.ui.authenticateWithPuter();
            } catch (e) {
                // if authentication fails, don't go on to attempt the upload
                return reject(e);
            }
        }

        const error = (e) => {
            // Out of storage: prompt the user to upgrade, then reject as usual.
            promptIfStorageLimitError(e);

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
        const operationId = utils.uuidv4();
        // Shared between the signed and legacy strategies so the 'start' hook
        // fires at most once even when the signed path falls back to legacy.
        const flags = { startCallbackFired: false };

        // Call 'init' callback if provided
        // init is basically a hook that allows the user to get the operation ID and the XMLHttpRequest object
        if ( options.init && typeof options.init === 'function' ) {
            options.init(operationId, xhr);
        }

        // Normalize the accepted input shapes (DataTransferItemList, FileList,
        // File, Blob, string, or arrays of these) into a flat list of entries.
        let entries;
        try {
            entries = await normalizeUploadEntries(items, options);
        } catch (e) {
            return error(e);
        }

        // Separate files from directories and tally the upload size.
        // This executor is async, so anything that throws here would settle
        // the executor's own promise and leave the upload's hanging; every
        // step has to route its failure through `error` instead.
        let dirs, files, totalSize, thumbnails;
        try {
            ({ dirs, files, totalSize } = separateFilesAndDirs(entries, dirPath, options));

            // Continue only if there are actually any files/directories to upload
            if ( dirs.length === 0 && files.length === 0 ) {
                return error({ code: 'EMPTY_UPLOAD', message: 'No files or directories to upload.' });
            }

            thumbnails = await generateThumbnails(files, options);
        } catch (e) {
            return error(e);
        }

        // Check storage capacity.
        // We need to check the storage capacity before the upload starts because
        // we want to avoid uploading files in case there is not enough storage space.
        // If we didn't check before upload starts, we could end up in a scenario where
        // the user uploads a very large folder/file and then the server rejects it because there is not enough space
        //
        // Space check in 'web' environment is currently not supported since it requires permissions.
        //
        // Below the threshold the check costs more than it saves: the round trip
        // is a fixed cost on every write, while the upload it would have avoided
        // is small, and the server still rejects an over-quota write with
        // NOT_ENOUGH_SPACE (handled by `error` above).
        let storage;
        if ( puter.env !== 'web' && totalSize >= SPACE_CHECK_MIN_BYTES ) {
            try {
                storage = await this.space();
                if ( storage.capacity - storage.used < totalSize ) {
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
            SIGNED_BATCH_SUPPORTED_ENVS.includes(puter.env) &&
            !options.shortcutTo &&
            (files.length > 0 || signedDirectories.length > 0) &&
            signedBatchWriteAllowed
        );

        const ctx = {
            options,
            dirPath,
            operationId,
            xhr,
            files,
            dirs,
            signedDirectories,
            thumbnails,
            totalSize,
            flags,
            resolve,
            reject,
            error,
        };

        try {
            // Try the signed batch-write path first. It returns `false` when
            // the backend doesn't support signed writes, signalling a legacy
            // fallback.
            if ( shouldAttemptSignedBatchWrite ) {
                const settled = await performSignedBatchUpload.call(this, ctx);
                if ( settled ) {
                    return;
                }
            }

            performLegacyBatchUpload.call(this, ctx);
        } catch (e) {
            return error(e);
        }
    });
};

const upload = /** @type {UploadOperation} */ (uploadImpl);

export default upload;
