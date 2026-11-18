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
