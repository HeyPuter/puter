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

/** A 1 x 1 RGB document. Version 2 is the large document format (PSB). */
export const createPsd = ({ version = 1, colorModeData = [], resources = [psdPreviewResource()] } = {}) => {
    const resourceBytes = concat(...resources);
    return concat(
        ascii('8BPS'),
        u16(version),
        new Uint8Array(6),
        u16(3),
        u32(1),
        u32(1),
        u16(8),
        u16(3),
        u32(colorModeData.length),
        colorModeData,
        u32(resourceBytes.length),
        resourceBytes,
        // Empty layer and mask section, whose length field is 8 bytes in a PSB.
        new Uint8Array(version === 2 ? 8 : 4),
        // Uncompressed composite: one white pixel.
        u16(0),
        [255, 255, 255],
    );
};
