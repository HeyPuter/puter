// Word documents (DOCX) assembled part by part into a ZIP archive, generated without a document library.
import { crc32, deflateRawSync } from 'node:zlib';

const NAMESPACES = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"';
const RELATIONSHIPS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

const u16 = (value) => {
    const bytes = Buffer.alloc(2);
    bytes.writeUInt16LE(value);
    return bytes;
};
const u32be = (value) => {
    const bytes = Buffer.alloc(4);
    bytes.writeUInt32BE(value);
    return bytes;
};
const u32 = (value) => {
    const bytes = Buffer.alloc(4);
    bytes.writeUInt32LE(value);
    return bytes;
};

/**
 * About `byteLength` bytes of deflate data that inflate to nothing: blocks that hold only their end marker. Put ahead
 * of an entry's own data, they make an inflater work through any amount of input without giving any output.
 */
export const emptyDeflateBlocks = (byteLength) => {
    const bits = [];
    const field = (value, count) => {
        for ( let bit = 0; bit < count; bit++ ) bits.push(value >> bit & 1);
    };
    // Two blocks are 184 bits, so a pair ends on a byte boundary.
    for ( let block = 0; block < 2; block++ ) {
        // Not the last block, with Huffman codes of its own: 257 literal codes, 1 distance code, 18 code-length codes.
        field(0, 1);
        field(2, 2);
        field(0, 5);
        field(0, 5);
        field(14, 4);
        // The code-length alphabet: 18 (a run of zeros) in 1 bit, 0 and 1 in 2 bits.
        for ( const length of [0, 0, 1, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2] ) field(length, 3);
        // Literals 0 to 255 unused, the end marker in 1 bit, the distance code unused, then the end marker itself.
        for ( const bit of [0, ...[1, 1, 1, 1, 1, 1, 1], 0, ...[1, 1, 0, 1, 0, 1, 1], 1, 1, 1, 0, 0] ) bits.push(bit);
    }
    const pair = Buffer.alloc(bits.length / 8);
    bits.forEach((bit, index) => {
        pair[index >> 3] |= bit << (index & 7);
    });
    return Buffer.concat(Array.from({ length: Math.ceil(byteLength / pair.length) }, () => pair));
};

/**
 * A ZIP archive holding `entries`, a map of entry names to their content. Entries are deflated, except the ones
 * named in `stored`. `sizes` overrides the uncompressed size the archive states for an entry, and `padding` puts
 * that many bytes of empty deflate blocks ahead of an entry's data.
 */
export const createZip = (entries, { stored = [], comment = '', sizes = {}, flags = 0, padding = {} } = {}) => {
    const locals = [];
    const directory = [];
    let offset = 0;
    for ( const [name, content] of Object.entries(entries) ) {
        const data = Buffer.from(content);
        const method = stored.includes(name) ? 0 : 8;
        const packed = method
            ? Buffer.concat([emptyDeflateBlocks(padding[name] ?? 0), deflateRawSync(data)])
            : data;
        // Version, flags, method, time and date, checksum, both sizes, then the lengths of the name and extra field.
        const fields = Buffer.concat([
            u16(20), u16(flags), u16(method), u32(0), u32(crc32(data)),
            u32(packed.length), u32(sizes[name] ?? data.length), u16(Buffer.byteLength(name)), u16(0),
        ]);
        locals.push(Buffer.from('PK\x03\x04'), fields, Buffer.from(name), packed);
        directory.push(Buffer.from('PK\x01\x02'), u16(20), fields, u16(0), u16(0), u16(0), u32(0), u32(offset),
                        Buffer.from(name));
        offset += 30 + Buffer.byteLength(name) + packed.length;
    }
    const directoryBytes = Buffer.concat(directory);
    const count = Object.keys(entries).length;
    return new Uint8Array(Buffer.concat([
        ...locals,
        directoryBytes,
        Buffer.from('PK\x05\x06'), u16(0), u16(0), u16(count), u16(count),
        u32(directoryBytes.length), u32(offset), u16(Buffer.byteLength(comment)), Buffer.from(comment),
    ]));
};

/** A paragraph of plain text, with optional paragraph properties (`<w:pPr>` content). */
export const paragraph = (text, properties = '') =>
    `<w:p>${properties && `<w:pPr>${properties}</w:pPr>`}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

/** The start of a PNG file that states this pixel size: its signature and header chunk, with no image data. */
export const pngHeader = (width, height) => {
    const header = Buffer.concat([Buffer.from('IHDR'), u32be(width), u32be(height), Buffer.from([8, 2, 0, 0, 0])]);
    return new Uint8Array(Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), u32be(13), header, u32be(crc32(header)),
    ]));
};

/** An inline picture `width` x `height` points in size, shown from the media file with relationship `id`. */
export const picture = (id, width, height) => '<w:r><w:drawing><wp:inline>' +
    `<wp:extent cx="${width * 12700}" cy="${height * 12700}"/><a:graphic><a:graphicData><a:blip r:embed="${id}"/>` +
    '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';

/**
 * A DOCX whose main part holds `body`. `styles` is the content of the styles part, `section` the content of the
 * section properties, `media` a map of file names under `word/media/` to their bytes (related as `rId1`, `rId2`, ...
 * in order) and `thumbnail` a stored first-page JPEG. `main` renames the main part.
 */
export const createDocx = ({
    body = paragraph('Hello'),
    styles,
    section = '<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>',
    media = {},
    thumbnail,
    main = 'word/document.xml',
    ...zipOptions
} = {}) => createZip({
    '[Content_Types].xml': `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`,
    '_rels/.rels': `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="${RELATIONSHIPS}/officeDocument" Target="${main}"/></Relationships>`,
    ...(thumbnail && { 'docProps/thumbnail.jpeg': thumbnail }),
    [main.replace('word/', 'word/_rels/') + '.rels']:
        `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${
            Object.keys(media).map((name, index) =>
                `<Relationship Id="rId${index + 1}" Type="${RELATIONSHIPS}/image" Target="media/${name}"/>`).join('')
        }</Relationships>`,
    [main]: `${XML}<w:document ${NAMESPACES}><w:body>${body}${section && `<w:sectPr>${section}</w:sectPr>`}` +
        '</w:body></w:document>',
    ...(styles !== undefined && { 'word/styles.xml': `${XML}<w:styles ${NAMESPACES}>${styles}</w:styles>` }),
    ...Object.fromEntries(Object.entries(media).map(([name, bytes]) => [`word/media/${name}`, bytes])),
}, zipOptions);
