import { PSD_PREVIEW_MAX_BYTES, PSD_PREVIEW_MAX_READ_BYTES } from './config.js';

const READ_WINDOW_BYTES = 64 * 1024;
const FILE_SIGNATURE = 0x38425053; // '8BPS'
const RESOURCE_SIGNATURE = 0x3842494d; // '8BIM'
const PREVIEW_RESOURCE_ID = 1036;
const PREVIEW_HEADER_BYTES = 28;
const PREVIEW_FORMAT_JPEG = 1;

// Serves small reads from one buffered window, so skipping a large resource costs a seek instead of its bytes.
const createReader = (file) => {
    let windowStart = 0;
    let windowBytes = new Uint8Array(0);
    let bytesRead = 0;
    return async (offset, length) => {
        if ( offset < windowStart || offset + length > windowStart + windowBytes.length ) {
            if ( offset + length > file.size || bytesRead >= PSD_PREVIEW_MAX_READ_BYTES ) return undefined;
            windowBytes = new Uint8Array(await file.slice(offset, offset + READ_WINDOW_BYTES).arrayBuffer());
            windowStart = offset;
            bytesRead += windowBytes.length;
            if ( windowBytes.length < length ) return undefined;
        }
        return new DataView(windowBytes.buffer, offset - windowStart, length);
    };
};

/**
 * Find the JPEG preview Photoshop embeds in a PSD or PSB, without reading the layers or the composite image.
 *
 * @param {File} file
 * @param {AbortSignal} [signal]
 * @returns {Promise<File | undefined>} The preview as an image file, or `undefined` when the document has none.
 */
export const readPsdPreview = async (file, signal) => {
    const read = createReader(file);
    // Header (26 bytes), then the length of the color mode data that precedes the image resources.
    const header = await read(0, 30);
    if ( !header || header.getUint32(0) !== FILE_SIGNATURE ) return undefined;
    const version = header.getUint16(4);
    if ( version !== 1 && version !== 2 ) return undefined;

    let offset = 30 + header.getUint32(26);
    const resourcesLength = await read(offset, 4);
    if ( ! resourcesLength ) return undefined;
    offset += 4;
    const resourcesEnd = offset + resourcesLength.getUint32(0);

    while ( offset < resourcesEnd ) {
        if ( signal?.aborted ) return undefined;
        const block = await read(offset, 7);
        if ( !block || block.getUint32(0) !== RESOURCE_SIGNATURE ) return undefined;
        // The name is a Pascal string padded, with its length byte, to an even size.
        const sizeOffset = offset + 6 + ((block.getUint8(6) + 2) & ~1);
        const size = (await read(sizeOffset, 4))?.getUint32(0);
        if ( size === undefined ) return undefined;
        const dataOffset = sizeOffset + 4;

        if ( block.getUint16(4) === PREVIEW_RESOURCE_ID ) {
            const format = (await read(dataOffset, 4))?.getUint32(0);
            const previewBytes = size - PREVIEW_HEADER_BYTES;
            if ( format !== PREVIEW_FORMAT_JPEG || previewBytes <= 0 || previewBytes > PSD_PREVIEW_MAX_BYTES ||
                dataOffset + size > file.size ) {
                return undefined;
            }
            // A slice stays on disk until the image decoder reads it.
            return new File([file.slice(dataOffset + PREVIEW_HEADER_BYTES, dataOffset + size)], 'preview.jpg', {
                type: 'image/jpeg',
            });
        }
        // Resource data is padded to an even size.
        offset = dataOffset + size + (size & 1);
    }
    return undefined;
};
