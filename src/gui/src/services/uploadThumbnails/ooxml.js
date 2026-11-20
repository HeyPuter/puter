// What the Office Open XML formats share: a ZIP archive of XML parts, and an optional picture of the first page.
import {
    OFFICE_MAX_READ_BYTES,
    OFFICE_PAGE_DIMENSION,
    OFFICE_PICTURE_MAX_BYTES,
    OFFICE_PICTURE_MAX_PIXELS,
    OFFICE_THUMBNAIL_MAX_BYTES,
} from './config.js';
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
const PICTURE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp' };

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

/** The attributes of a tag, by name. */
export const attributesOf = source => Object.fromEntries(
    Array.from(source.matchAll(ATTRIBUTE), ([, name, double, single]) => [name, double ?? single]),
);

export const decodeEntities = text => text.replace(/&(?:#(\d+)|#x([0-9a-f]+)|(\w+));/gi, (match, decimal, hex, name) => {
    if ( name ) return Object.hasOwn(ENTITIES, name) ? ENTITIES[name] : match;
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
        // A target is relative to the part's folder unless it starts at the archive's root, and can climb out of it.
        const segments = [];
        for ( const segment of (target.startsWith('/') ? target : `${folder}/${target}`).split('/') ) {
            if ( segment === '..' ) segments.pop();
            else if ( segment && segment !== '.' ) segments.push(segment);
        }
        relationships.set(id, { target: segments.join('/'), type });
    }
    return relationships;
};

/**
 * Read the pixel size a PNG, GIF, BMP or JPEG file states near its start.
 *
 * @param {DataView} view The file's bytes.
 * @returns {{ width: number, height: number } | undefined} `undefined` for any other content.
 */
const pixelSizeOf = (view) => {
    const length = view.byteLength;
    if ( length >= 24 && view.getUint32(0) === 0x89504e47 ) {
        return { width: view.getUint32(16), height: view.getUint32(20) };
    }
    if ( length >= 10 && view.getUint32(0) === 0x47494638 ) {
        return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
    }
    // A BMP stored top to bottom states a negative height.
    if ( length >= 26 && view.getUint16(0) === 0x424d ) {
        return { width: Math.abs(view.getInt32(18, true)), height: Math.abs(view.getInt32(22, true)) };
    }
    if ( length < 2 || view.getUint16(0) !== 0xffd8 ) return undefined;
    // A JPEG is a run of segments, each a marker and a length. The frame header is the one that holds the size.
    for ( let at = 2; at + 9 <= length; ) {
        const marker = view.getUint8(at + 1);
        if ( view.getUint8(at) !== 0xff ) return undefined;
        if ( marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc ) {
            return { width: view.getUint16(at + 7), height: view.getUint16(at + 5) };
        }
        // A padding byte, a marker that stands alone, or a segment to step over.
        if ( marker === 0xff ) at++;
        else at += 2 + (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9) ? 0 : view.getUint16(at + 2));
    }
    return undefined;
};

/**
 * Decode a picture stored in the archive, scaled down to what a thumbnail can show.
 *
 * @param {NonNullable<Awaited<ReturnType<typeof openArchive>>>} archive
 * @param {string} name The picture's entry name.
 * @returns {Promise<ImageBitmap | undefined>} `undefined` for a picture that is over a budget, in a format browsers
 *     don't decode, or damaged. The caller closes the bitmap.
 */
export const readPicture = async ({ entries, contentOf }, name) => {
    const entry = entries.get(name);
    const type = PICTURE_TYPES[name.split('.').pop().toLowerCase()];
    if ( !type || !entry || entry.size > OFFICE_PICTURE_MAX_BYTES ) return undefined;
    try {
        const content = await contentOf(entry, OFFICE_PICTURE_MAX_BYTES);
        const pixels = pixelSizeOf(new DataView(await content.arrayBuffer()));
        // A small file can state a very large picture, and decoding one takes memory by the pixel.
        if ( !pixels?.width || !pixels.height || pixels.width * pixels.height > OFFICE_PICTURE_MAX_PIXELS ) {
            return undefined;
        }
        // The thumbnail is small, so a large picture is scaled down as it is decoded and little of it is kept.
        const scale = OFFICE_PAGE_DIMENSION / Math.max(pixels.width, pixels.height);
        return await createImageBitmap(new Blob([content], { type }), scale < 1
            ? {
                resizeWidth: Math.max(1, Math.round(pixels.width * scale)),
                resizeHeight: Math.max(1, Math.round(pixels.height * scale)),
                resizeQuality: 'medium',
            }
            : undefined);
    } catch {
        return undefined;
    }
};

/**
 * Read the colors of a theme, by the names its color scheme gives them: `dk1`, `lt1`, `accent1` and so on.
 *
 * @param {string} xml The theme part, or an empty string.
 * @returns {Record<string, string>} Each color as six hex digits.
 */
export const readThemeColors = (xml) => {
    const colors = {};
    let depth = -1;
    let slot;
    for ( const [, closing, tag, source, empty] of xml.matchAll(TOKEN) ) {
        if ( ! tag ) continue;
        const name = tag.slice(tag.indexOf(':') + 1);
        if ( name === 'clrScheme' ) {
            if ( closing ) break;
            depth = 0;
        } else if ( depth >= 0 ) {
            // The scheme's children name the colors, and each holds one color element.
            if ( closing ) depth--;
            else if ( depth === 0 ) slot = name;
            else if ( name === 'srgbClr' || name === 'sysClr' ) {
                const { val, lastClr } = attributesOf(source);
                const hex = name === 'srgbClr' ? val : lastClr;
                if ( /^[0-9a-f]{6}$/i.test(hex) ) colors[slot] ??= hex;
            }
            if ( !closing && !empty ) depth++;
        }
    }
    return colors;
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
