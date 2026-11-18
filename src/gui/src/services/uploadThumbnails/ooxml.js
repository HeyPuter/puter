// What the Office Open XML formats share: a ZIP archive of XML parts, and an optional picture of the first page.
import { OFFICE_MAX_READ_BYTES, OFFICE_THUMBNAIL_MAX_BYTES } from './config.js';
import { createReader } from './reader.js';

// ZIP signatures, as a big-endian read sees them.
const LOCAL_HEADER_SIGNATURE = 0x504b0304;
const DIRECTORY_ENTRY_SIGNATURE = 0x504b0102;
const DIRECTORY_END_SIGNATURE = 0x504b0506;
const DIRECTORY_END_BYTES = 22;
const MAX_COMMENT_BYTES = 65535;
const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

// One match per tag, or per stretch of text between tags. A name ends at whitespace and no part runs past the next
// '<', so each character is looked at a fixed number of times, however malformed the markup is.
export const TOKEN = /<(\/?)([\w:.-]+)((?:\s(?:[^<>"']|"[^"<]*"|'[^'<]*')*?)?)(\/?)>|([^<]+)/g;
const ATTRIBUTE = /(?:^|\s)([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'' };

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
    const read = createReader(file, OFFICE_MAX_READ_BYTES);
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

    // Reading stops at `maxBytes`, so an entry that inflates to more than it states costs no more than that.
    const contentOf = async (entry, maxBytes) => {
        if ( !entry || entry.encrypted || (entry.method !== METHOD_STORED && entry.method !== METHOD_DEFLATE) ) {
            return undefined;
        }
        const header = await read(entry.offset, 30, 30);
        if ( header?.getUint32(0) !== LOCAL_HEADER_SIGNATURE ) return undefined;
        const start = entry.offset + 30 + header.getUint16(26, true) + header.getUint16(28, true);
        const data = file.slice(start, start + entry.compressedSize).stream();
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
        } finally {
            reader.cancel().catch(() => {});
        }
        return new Blob(chunks).slice(0, maxBytes);
    };
    return { entries, contentOf };
};

/** The attributes of a tag, by name. */
export const attributesOf = source => Object.fromEntries(
    Array.from(source.matchAll(ATTRIBUTE), ([, name, double, single]) => [name, double ?? single]),
);

export const decodeEntities = text => text.replace(/&(?:#(\d+)|#x([0-9a-f]+)|(\w+));/gi, (match, decimal, hex, name) => {
    if ( name ) return ENTITIES[name] ?? match;
    const codePoint = decimal ? Number(decimal) : parseInt(hex, 16);
    return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : match;
});

/**
 * Read a part's relationships: the other parts it refers to, by the ids it uses for them.
 *
 * @param {string} [xml]
 * @returns {Map<string, { target: string, type: string }>} Each target as an entry name, given the part's `folder`.
 */
export const readRelationships = (xml, folder) => {
    const relationships = new Map();
    for ( const [, , name, source] of xml?.matchAll(TOKEN) ?? [] ) {
        if ( name !== 'Relationship' ) continue;
        const { Id: id, Target: target = '', Type: type = '' } = attributesOf(source);
        // A target is relative to the part's folder unless it starts at the archive's root.
        relationships.set(id, { target: target.startsWith('/') ? target.slice(1) : `${folder}/${target}`, type });
    }
    return relationships;
};

/**
 * Get the picture of the first page that some editors store in a document. EMF and WMF ones can't be decoded here.
 *
 * @param {NonNullable<Awaited<ReturnType<typeof openArchive>>>} archive
 * @returns {Promise<File | undefined>}
 */
export const readStoredThumbnail = async ({ entries, contentOf }) => {
    const thumbnail = entries.get('docProps/thumbnail.jpeg');
    if ( !thumbnail || thumbnail.size > OFFICE_THUMBNAIL_MAX_BYTES ) return undefined;
    const content = await contentOf(thumbnail, OFFICE_THUMBNAIL_MAX_BYTES);
    return content?.size ? new File([content], 'preview.jpg', { type: 'image/jpeg' }) : undefined;
};
