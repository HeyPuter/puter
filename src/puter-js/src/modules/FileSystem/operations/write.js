import path from 'path-browserify';
import getAbsolutePathForApp from '../utils/getAbsolutePathForApp.js';

/** @typedef {import('../../../../types/modules/filesystem').WriteOptions} WriteOptions */
/** @typedef {import('../../../../types/modules/fs-item').FSItem} FSItem */

/**
 * @typedef {{
 *   (file: File): Promise<FSItem>,
 *   (
 *     targetPath: string,
 *     data?: string | File | Blob | ArrayBuffer | ArrayBufferView,
 *     options?: WriteOptions,
 *   ): Promise<FSItem>,
 * }} WriteOperation
 */

/**
 * @this {import('../index.js').PuterJSFileSystemModule}
 * @param {string | File} targetPath
 * @param {string | File | Blob | ArrayBuffer | ArrayBufferView} [data]
 * @param {WriteOptions} [options]
 * @returns {Promise<FSItem>}
 */
const writeImpl = async function (targetPath, data, options = {}) {
    // targetPath is required
    if ( ! targetPath ) {
        throw { code: 'NO_TARGET_PATH', message: 'No target path provided.' };
    }
    // if targetPath is a File
    if ( targetPath instanceof File && data === undefined ) {
        data = targetPath;
        targetPath = targetPath.name;
    }

    const overwrite = options.overwrite ?? true;
    const uploadOptions = {
        ...options,
        overwrite,
        // if overwrite is true and dedupeName is not provided, don't dedupe
        dedupeName: options.dedupeName ?? (overwrite ? false : undefined),
        // strict mode will cause the upload to fail if even one operation fails
        // for example, if one of the files in a folder fails to upload, the entire upload will fail
        // since write is a wrapper around upload to handle single-file uploads, we need to pass the strict option to upload
        strict: true,
    };

    // if targetPath is not provided or it's not starting with a slash, it means it's a relative path
    // in that case, we need to prepend the app's root directory to it
    targetPath = getAbsolutePathForApp(targetPath);

    // extract file name from targetPath
    const filename = path.basename(targetPath);

    // extract the parent directory from targetPath
    const parent = path.dirname(targetPath);

    // if data is a string, convert it to a File object
    if ( typeof data === 'string' ) {
        data = new File([data ?? ''], filename ?? 'Untitled.txt', { type: 'text/plain' });
    }
    // blob
    else if ( data instanceof Blob ) {
        data = new File([data ?? ''], filename ?? 'Untitled', { type: data.type });
    }
    // typed arrays (Uint8Array, Int8Array, etc.) and ArrayBuffer
    else if ( data instanceof ArrayBuffer || ArrayBuffer.isView(data) ) {
        data = new File([data], filename ?? 'Untitled', { type: 'application/octet-stream' });
    }

    if ( ! data )
    {
        data = new File([data ?? ''], filename);
    }

    // data should be a File now. If it's not, it's an unsupported type
    if ( ! (data instanceof File) ) {
        throw { code: 'field_invalid', message: 'write() data parameter is an invalid type' };
    }

    // perform upload
    return this.upload(data, parent, uploadOptions);
};

/**
 * Writes data to a file, creating it if it doesn't exist and overwriting it if
 * it does. Relative paths resolve against the app's root directory. Writing no
 * data creates an empty file; writing a `File` on its own names the file after
 * itself.
 *
 * @type {WriteOperation}
 */
const write = /** @type {WriteOperation} */ (writeImpl);

export default write;