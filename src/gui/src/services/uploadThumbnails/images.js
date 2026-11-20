/**
 * Tell what kind of image some bytes start, from their signature. The type a file states for an image it holds is not
 * always right.
 *
 * @param {DataView} view At least the image's first 12 bytes.
 * @returns {string | undefined} A MIME type browsers decode, or `undefined`.
 */
export const imageTypeOf = (view) => {
    if ( view.byteLength < 12 ) return undefined;
    if ( view.getUint16(0) === 0xffd8 ) return 'image/jpeg';
    if ( view.getUint32(0) === 0x89504e47 ) return 'image/png';
    if ( view.getUint32(0) === 0x47494638 ) return 'image/gif';
    if ( view.getUint32(0) === 0x52494646 && view.getUint32(8) === 0x57454250 ) return 'image/webp';
    if ( view.getUint16(0) === 0x424d ) return 'image/bmp';
    return undefined;
};

/**
 * Read the pixel size a PNG, GIF, BMP, WebP or JPEG file states near its start.
 *
 * @param {DataView} view The file's bytes.
 * @returns {{ width: number, height: number } | undefined} `undefined` for any other content.
 */
export const pixelSizeOf = (view) => {
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
    if ( length >= 16 && view.getUint32(0) === 0x52494646 && view.getUint32(8) === 0x57454250 ) {
        // The first chunk of a WebP is its lossy or lossless bitstream, or the extended header that states the canvas.
        const chunk = view.getUint32(12);
        if ( chunk === 0x56503820 && length >= 30 && view.getUint32(23) >>> 8 === 0x9d012a ) {
            return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
        }
        if ( chunk === 0x5650384c && length >= 25 && view.getUint8(20) === 0x2f ) {
            const bits = view.getUint32(21, true);
            return { width: (bits & 0x3fff) + 1, height: (bits >>> 14 & 0x3fff) + 1 };
        }
        if ( chunk === 0x56503858 && length >= 30 ) {
            return {
                width: (view.getUint16(24, true) | view.getUint8(26) << 16) + 1,
                height: (view.getUint16(27, true) | view.getUint8(29) << 16) + 1,
            };
        }
        return undefined;
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
