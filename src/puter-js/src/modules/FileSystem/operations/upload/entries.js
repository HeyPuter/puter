// Normalize the many accepted `upload()` input shapes into a flat list of
// entries, then split that list into the directories and files to create.

import path from '../../../../lib/path.js';

/**
 * Split an array into fixed-size chunks. Returns an empty array for empty or
 * non-array input; a non-positive `chunkSize` is treated as 1.
 *
 * @param {unknown[]} values
 * @param {number} chunkSize
 * @returns {unknown[][]}
 */
export const chunkArray = (values, chunkSize) => {
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

/**
 * Coerce the `items` argument of `upload()` (DataTransferItemList, FileList,
 * File, Blob, string, or arrays of these) into a normalized, size-sorted array
 * of entries. Throws `{ code: 'field_invalid' }` for unsupported input.
 *
 * @param {unknown} items
 * @param {Record<string, unknown>} options
 * @returns {Promise<unknown[]>}
 */
export const normalizeUploadEntries = async (items, options) => {
    const DataTransferItem = globalThis.DataTransfer || (class DataTransferItem {
    });
    const FileList = globalThis.FileList || (class FileList {
    });
    const DataTransferItemList = globalThis.DataTransferItemList || (class DataTransferItemList {
    });

    let entries;

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
        entries.sort((entryA, entryB) => {
            if ( entryA.isDirectory && !entryB.isDirectory ) return -1;
            if ( !entryA.isDirectory && entryB.isDirectory ) return 1;
            if ( entryA.isDirectory && entryB.isDirectory ) return 0;

            return entryA.size - entryB.size;
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
        entries.sort((entryA, entryB) => {
            return entryA.size - entryB.size;
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
        throw { code: 'field_invalid', message: 'upload() items parameter is an invalid type' };
    }

    return entries;
};

/**
 * Split normalized entries into the directories and files to be created,
 * resolving each into a path under `dirPath` and tallying total upload size.
 *
 * @param {unknown[]} entries
 * @param {string} dirPath
 * @param {Record<string, unknown>} options
 * @returns {{ dirs: Array<{ path: string }>, files: unknown[], totalSize: number, fileCount: number }}
 */
export const separateFilesAndDirs = (entries, dirPath, options) => {
    // Will hold directories and files to be uploaded
    let dirs = [];
    let uniqueDirs = {};
    let files = [];
    let totalSize = 0;
    let fileCount = 0;

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
            totalSize += (entries[i].size);
            fileCount++;
        }
    }

    return { dirs, files, totalSize, fileCount };
};
