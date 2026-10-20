import { uuidv4 } from '../../../lib/utils.js';
import getAbsolutePathForApp from '../../FileSystem/utils/getAbsolutePathForApp.js';
import { dataUriByteLength, isBlobLike } from './args.js';

/** Media up to this size is sent inline; larger media goes through a Puter file. */
export const MAX_INLINE_MEDIA_BYTES = 1024 * 1024;

const isLargeDataUri = (value) =>
    typeof value === 'string' &&
    value.startsWith('data:') &&
    dataUriByteLength(value) > MAX_INLINE_MEDIA_BYTES;

/** @param {string} dataUri */
const dataUriToBlob = (dataUri) => {
    const comma = dataUri.indexOf(',');
    const header = dataUri.slice('data:'.length, comma);
    const type = header.split(';')[0] || 'application/octet-stream';
    const payload = dataUri.slice(comma + 1);
    if ( ! header.includes(';base64') ) {
        return new Blob([decodeURIComponent(payload)], { type });
    }
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for ( let i = 0; i < binary.length; i++ ) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type });
};

/**
 * Writes large media inputs (a Blob or File, or a data URI over 1 MiB) to
 * temporary Puter files, so the request carries a file path instead of the
 * bytes. The driver reads the file within the caller's access. Call
 * `cleanup()` once the request settles to delete the files.
 *
 * @internal
 * @param {import('../../../index.js').Puter} puter
 */
export const createMediaStager = (puter) => {
    /** @type {string[]} */
    const staged = [];

    /**
     * @template T
     * @param {T} value
     * @returns {Promise<T | string>}
     */
    const stage = async (value) => {
        if ( !isBlobLike(value) && !isLargeDataUri(value) ) return value;
        const blob = isBlobLike(value) ? value : dataUriToBlob(/** @type {string} */ (value));
        const path = getAbsolutePathForApp(`.tmp/${uuidv4()}.tmp`, puter);
        const item = await puter.fs.write(path, blob, { createMissingParents: true });
        staged.push(item.uid);
        return item.path;
    };

    const cleanup = async () => {
        if ( staged.length === 0 ) return;
        try {
            await puter.fs.delete(staged.splice(0));
        } catch {
            // The request already settled; a leftover temporary file is not
            // worth failing it over.
        }
    };

    return { stage, cleanup };
};
