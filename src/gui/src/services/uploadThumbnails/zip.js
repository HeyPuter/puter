// A ZIP archive, read from the directory at its end. Office documents and other packaged files are ZIP archives.
import { ARCHIVE_MAX_READ_BYTES } from './config.js';
import { createReader } from './reader.js';

// ZIP signatures, as a big-endian read sees them.
const LOCAL_HEADER_SIGNATURE = 0x504b0304;
const DIRECTORY_ENTRY_SIGNATURE = 0x504b0102;
const DIRECTORY_END_SIGNATURE = 0x504b0506;
const DIRECTORY_END_BYTES = 22;
const MAX_COMMENT_BYTES = 65535;
const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

/**
 * @typedef {Object} ZipEntry
 * @property {boolean} encrypted
 * @property {number} method
 * @property {number} compressedSize
 * @property {number} size Size after decompression, as the archive states it.
 * @property {number} offset Where the entry's local header starts.
 */

/**
 * List a ZIP archive's entries from the directory at its end, without reading their content.
 *
 * @param {File} file
 * @returns {Promise<{
 *     entries: Map<string, ZipEntry>,
 *     contentOf: (entry: ZipEntry | undefined, maxBytes: number) => Promise<Blob | undefined>,
 * } | undefined>}
 */
export const openArchive = async (file) => {
    const read = createReader(file, ARCHIVE_MAX_READ_BYTES);
    if ( (await read(0, 4))?.getUint32(0) !== LOCAL_HEADER_SIGNATURE ) return undefined;
    // The record that locates the directory is the last thing in the file, apart from an optional comment.
    const tailStart = Math.max(0, file.size - DIRECTORY_END_BYTES - MAX_COMMENT_BYTES);
    const tail = await read(tailStart, file.size - tailStart, 0);
    let end = (tail?.byteLength ?? 0) - DIRECTORY_END_BYTES;
    while ( end >= 0 && tail.getUint32(end) !== DIRECTORY_END_SIGNATURE ) end--;
    if ( end < 0 ) return undefined;
    const count = tail.getUint16(end + 10, true);
    const directory = await read(tail.getUint32(end + 16, true), tail.getUint32(end + 12, true), 0);
    if ( ! directory ) return undefined;

    const entries = new Map();
    const decoder = new TextDecoder();
    for ( let at = 0, index = 0; index < count && at + 46 <= directory.byteLength; index++ ) {
        if ( directory.getUint32(at) !== DIRECTORY_ENTRY_SIGNATURE ) break;
        const nameLength = directory.getUint16(at + 28, true);
        if ( at + 46 + nameLength > directory.byteLength ) break;
        const name = decoder.decode(new Uint8Array(directory.buffer, directory.byteOffset + at + 46, nameLength));
        entries.set(name, {
            encrypted: !!(directory.getUint16(at + 8, true) & 1),
            method: directory.getUint16(at + 10, true),
            compressedSize: directory.getUint32(at + 20, true),
            size: directory.getUint32(at + 24, true),
            offset: directory.getUint32(at + 42, true),
        });
        at += 46 + nameLength + directory.getUint16(at + 30, true) + directory.getUint16(at + 32, true);
    }

    // Reading stops at `maxBytes` of output, so an entry that inflates to more than it states costs no more than that.
    const contentOf = async (entry, maxBytes) => {
        if ( !entry || entry.encrypted || (entry.method !== METHOD_STORED && entry.method !== METHOD_DEFLATE) ) {
            return undefined;
        }
        const header = await read(entry.offset, 30, 30);
        if ( header?.getUint32(0) !== LOCAL_HEADER_SIGNATURE ) return undefined;
        const start = entry.offset + 30 + header.getUint16(26, true) + header.getUint16(28, true);
        // Deflate data can also inflate to nothing at all, so the input is cut off as well. Data that deflate could
        // not shrink is a little larger than what it inflates to, which the margin allows for.
        const packedBytes = Math.min(entry.compressedSize, maxBytes + Math.ceil(maxBytes / 64) + 1024);
        const data = file.slice(start, start + packedBytes).stream();
        const reader = (entry.method === METHOD_DEFLATE
            ? data.pipeThrough(new DecompressionStream('deflate-raw'))
            : data).getReader();
        const chunks = [];
        try {
            for ( let length = 0; length < maxBytes; ) {
                const { done, value } = await reader.read();
                if ( done ) break;
                chunks.push(value);
                length += value.length;
            }
        } catch ( error ) {
            // Input that was cut off ends in the middle of the data. What it gave before that is all there is.
            if ( packedBytes === entry.compressedSize ) throw error;
        } finally {
            reader.cancel().catch(() => {});
        }
        return new Blob(chunks).slice(0, maxBytes);
    };
    return { entries, contentOf };
};
