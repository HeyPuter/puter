// What the Office Open XML formats share: XML parts in a ZIP archive, pictures, a theme, and an optional picture of
// the first page.
import {
    OFFICE_PAGE_DIMENSION,
    OFFICE_PICTURE_MAX_BYTES,
    OFFICE_PICTURE_MAX_PIXELS,
    OFFICE_THUMBNAIL_MAX_BYTES,
} from './config.js';

// One match per tag, or per stretch of text between tags. A name ends at whitespace and no part runs past the next
// '<', so each character is looked at a fixed number of times, however malformed the markup is.
export const TOKEN = /<(\/?)([\w:.-]+)((?:\s(?:[^<>"']|"[^"<]*"|'[^'<]*')*?)?)(\/?)>|([^<]+)/g;
const ATTRIBUTE = /(?:^|\s)([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'' };
const PICTURE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp' };

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
 * @param {NonNullable<Awaited<ReturnType<typeof import('./zip.js').openArchive>>>} archive
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
 * @param {NonNullable<Awaited<ReturnType<typeof import('./zip.js').openArchive>>>} archive
 * @returns {Promise<File | undefined>}
 */
export const readStoredThumbnail = async ({ entries, contentOf }) => {
    const thumbnail = entries.get('docProps/thumbnail.jpeg');
    if ( !thumbnail || thumbnail.size > OFFICE_THUMBNAIL_MAX_BYTES ) return undefined;
    const content = await contentOf(thumbnail, OFFICE_THUMBNAIL_MAX_BYTES);
    return content?.size ? new File([content], 'preview.jpg', { type: 'image/jpeg' }) : undefined;
};
