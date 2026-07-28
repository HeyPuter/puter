import getAbsolutePathForApp from '../utils/getAbsolutePathForApp.js';
import { defineOperation } from './scaffold.js';

/** @typedef {import('../../../../types/modules/filesystem').ReadOptions} ReadOptions */

/**
 * Reads a file and resolves with its contents as a `Blob`. Relative paths
 * resolve against the app's root directory.
 *
 * @type {{
 *   (options: ReadOptions): Promise<Blob>,
 *   (
 *     filePath: string,
 *     options?: ReadOptions,
 *     success?: (value: Blob) => void,
 *     error?: (reason: unknown) => void,
 *   ): Promise<Blob>,
 *   (
 *     filePath: string,
 *     success: (value: Blob) => void,
 *     error?: (reason: unknown) => void,
 *   ): Promise<Blob>,
 * }}
 */
const read = defineOperation({
    positional: ['path'],
    request (options) {
        const query = new URLSearchParams({ file: getAbsolutePathForApp(options.path) });
        if ( options.offset ) query.set('offset', String(options.offset));
        if ( options.byte_count ) query.set('byte_count', String(options.byte_count));

        return {
            endpoint: `/read?${ query.toString()}`,
            method: 'get',
            contentType: 'application/json;charset=UTF-8',
            responseType: 'blob',
            prepareXhr (xhr) {
                // `/read` is a GET on a URL that's identical for a given path, so the
                // browser HTTP-caches the response. Writes go through a different
                // endpoint (upload) and never touch this URL's cache entry, so a
                // read-after-write is served the stale pre-write body. Force the browser
                // to revalidate with the origin on every read. This still allows a cheap
                // 304 when the server sends a validator (ETag/Last-Modified), so it is
                // not a blunt cache-buster. Opt back into caching with { cache: true }.
                if ( options.cache !== true ) {
                    xhr.setRequestHeader('Cache-Control', 'no-cache');
                    xhr.setRequestHeader('Pragma', 'no-cache'); // HTTP/1.0 intermediaries
                }
            },
        };
    },
});

export default read;
