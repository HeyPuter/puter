// Small Photoshop documents with real section framing, generated without a PSD library.
const PREVIEW_JPEG = '/9j/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCABQAKADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFgEBAQEAAAAAAAAAAAAAAAAAAAUH/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AnwEZpIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/9k=';

const u16 = value => [value >>> 8 & 255, value & 255];
const u32 = value => [...u16(value >>> 16), ...u16(value & 65535)];
const ascii = text => [...text].map(character => character.charCodeAt(0));
const concat = (...parts) => {
    const bytes = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
    let offset = 0;
    for ( const part of parts ) {
        bytes.set(part, offset);
        offset += part.length;
    }
    return bytes;
};

/** The 160 x 80 red JPEG the fixtures embed as their preview. */
export const psdPreviewJpeg = () => Uint8Array.from(atob(PREVIEW_JPEG), character => character.charCodeAt(0));

/** One image resource block, with the name and the data each padded to an even size. */
export const psdResource = (id, data, { name = '', signature = '8BIM' } = {}) => concat(
    ascii(signature),
    u16(id),
    [name.length, ...ascii(name), ...(name.length % 2 ? [] : [0])],
    u32(data.length),
    data,
    data.length % 2 ? [0] : [],
);

/** The thumbnail resource Photoshop writes: a 28-byte header (format 1 is JPEG) followed by the image. */
export const psdPreviewResource = ({ jpeg = psdPreviewJpeg(), format = 1 } = {}) => psdResource(1036, concat(
    u32(format),
    u32(160),
    u32(80),
    u32(480),
    u32(480 * 80),
    u32(jpeg.length),
    u16(24),
    u16(1),
    jpeg,
));

// PackBits, as an RLE merged image stores each row: repeated bytes become a count and a value, the rest is copied.
const packRow = (row) => {
    const packed = [];
    for ( let start = 0; start < row.length; ) {
        let run = 1;
        while ( start + run < row.length && run < 128 && row[start + run] === row[start] ) run++;
        if ( run > 1 ) {
            packed.push(257 - run, row[start]);
            start += run;
            continue;
        }
        let length = 1;
        while ( start + length < row.length && length < 128 && row[start + length] !== row[start + length - 1] ) length++;
        // The byte that stopped the scan starts the next run.
        if ( start + length < row.length && length < 128 && length > 1 ) length--;
        packed.push(length - 1, ...row.slice(start, start + length));
        start += length;
    }
    return packed;
};

/**
 * A Photoshop document, by default 1 x 1 white RGB. Version 2 is the large document format (PSB).
 *
 * `channels` holds one array of samples per channel of the merged image, rows top to bottom. A negative
 * `layerCount` marks the channel after the colors as transparency. `compression` is 0 (raw) or 1 (RLE).
 */
export const createPsd = ({
    version = 1,
    colorModeData = [],
    resources = [psdPreviewResource()],
    width = 1,
    height = 1,
    depth = 8,
    colorMode = 3,
    channels = Array.from({ length: 3 }, () => new Uint8Array(width * height * depth / 8).fill(255)),
    layerCount = 0,
    compression = 0,
} = {}) => {
    const resourceBytes = concat(...resources);
    // Section lengths and RLE row lengths are twice as wide in a PSB.
    const length = value => (version === 2 ? [...u32(0), ...u32(value)] : u32(value));
    const rowBytes = width * depth / 8;
    const rows = channels.flatMap(channel => Array.from({ length: height }, (_, row) =>
        [...channel.slice(row * rowBytes, (row + 1) * rowBytes)]));
    const packedRows = rows.map(packRow);
    return concat(
        ascii('8BPS'),
        u16(version),
        new Uint8Array(6),
        u16(channels.length),
        u32(height),
        u32(width),
        u16(depth),
        u16(colorMode),
        u32(colorModeData.length),
        colorModeData,
        u32(resourceBytes.length),
        resourceBytes,
        // Layer and mask section: empty, or a layer info block holding only the layer count.
        ...(layerCount ? [length(length(0).length + 2), length(2), u16(layerCount & 0xffff)] : [length(0)]),
        u16(compression),
        ...(compression === 1
            ? [...packedRows.map(row => (version === 2 ? u32(row.length) : u16(row.length))), ...packedRows]
            : channels),
    );
};
