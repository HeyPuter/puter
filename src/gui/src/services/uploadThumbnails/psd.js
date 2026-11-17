import {
    PSD_COMPOSITE_DIMENSION,
    PSD_COMPOSITE_MAX_READ_BYTES,
    PSD_PREVIEW_MAX_BYTES,
    PSD_PREVIEW_MAX_READ_BYTES,
} from './config.js';

const READ_WINDOW_BYTES = 64 * 1024;
// Needed rows closer together than this share a read; reading the rows between them costs less than another seek.
const ROW_WINDOW_BYTES = 16 * 1024;
const FILE_SIGNATURE = 0x38425053; // '8BPS'
const RESOURCE_SIGNATURE = 0x3842494d; // '8BIM'
const PREVIEW_RESOURCE_ID = 1036;
const PREVIEW_HEADER_BYTES = 28;
const PREVIEW_FORMAT_JPEG = 1;
const MAX_DOCUMENT_DIMENSION = 300_000;
const COLOR_MODE_GRAYSCALE = 1;
const COLOR_MODE_RGB = 3;
const COMPRESSION_RAW = 0;
const COMPRESSION_RLE = 1;
const BMP_HEADER_BYTES = 54;

// Serves small reads from one buffered window, so skipping a large resource costs a seek instead of its bytes.
const createReader = (file, maxReadBytes) => {
    let windowStart = 0;
    let windowBytes = new Uint8Array(0);
    let bytesRead = 0;
    return async (offset, length, windowLength = READ_WINDOW_BYTES) => {
        if ( offset < windowStart || offset + length > windowStart + windowBytes.length ) {
            const end = Math.min(file.size, offset + Math.max(length, windowLength));
            if ( offset + length > end || bytesRead + end - offset > maxReadBytes ) return undefined;
            windowBytes = new Uint8Array(await file.slice(offset, end).arrayBuffer());
            windowStart = offset;
            bytesRead += windowBytes.length;
            if ( windowBytes.length < length ) return undefined;
        }
        return new DataView(windowBytes.buffer, offset - windowStart, length);
    };
};

// PackBits: a count byte below 128 copies the next count + 1 bytes, one above 128 repeats the next byte 257 - count times.
const unpackRow = (packed, row) => {
    let read = 0;
    let written = 0;
    while ( read < packed.length && written < row.length ) {
        const count = packed[read++];
        if ( count < 128 ) {
            const length = Math.min(count + 1, row.length - written, packed.length - read);
            row.set(packed.subarray(read, read + length), written);
            read += count + 1;
            written += length;
        } else if ( count > 128 ) {
            const length = Math.min(257 - count, row.length - written);
            row.fill(packed[read++], written, written + length);
            written += length;
        }
    }
};

/**
 * Scale the merged image at the end of a PSD down to a small BMP by reading only the rows the result needs.
 *
 * @param {File} file
 * @param {DataView} header The document's first 26 bytes.
 * @param {number} sectionOffset Where the layer and mask section starts.
 * @param {AbortSignal} [signal]
 * @returns {Promise<File | undefined>}
 */
const renderComposite = async (file, header, sectionOffset, signal) => {
    const isPsb = header.getUint16(4) === 2;
    const channels = header.getUint16(12);
    const height = header.getUint32(14);
    const width = header.getUint32(18);
    const sampleBytes = header.getUint16(22) / 8;
    const colorMode = header.getUint16(24);
    const colorChannels = colorMode === COLOR_MODE_RGB ? 3 : 1;
    if ( (colorMode !== COLOR_MODE_RGB && colorMode !== COLOR_MODE_GRAYSCALE) || channels < colorChannels ||
        (sampleBytes !== 1 && sampleBytes !== 2) || !width || !height ||
        width > MAX_DOCUMENT_DIMENSION || height > MAX_DOCUMENT_DIMENSION ) {
        return undefined;
    }

    const read = createReader(file, PSD_COMPOSITE_MAX_READ_BYTES);
    // A PSB widens the section lengths and the RLE row lengths.
    const lengthBytes = isPsb ? 8 : 4;
    const readLength = (view, at) => (isPsb ? Number(view.getBigUint64(at)) : view.getUint32(at));
    // Section length, layer info length, then the layer count.
    const section = await read(sectionOffset, lengthBytes);
    if ( ! section ) return undefined;
    const sectionLength = readLength(section, 0);
    const layers = sectionLength >= lengthBytes + 2 && await read(sectionOffset + lengthBytes, lengthBytes + 2);
    // A negative layer count marks the first extra channel as the merged image's transparency.
    const hasAlpha = channels > colorChannels && !!layers && readLength(layers, 0) >= 2 &&
        layers.getInt16(lengthBytes) < 0;
    const planes = colorChannels + (hasAlpha ? 1 : 0);

    let offset = sectionOffset + lengthBytes + sectionLength;
    const compression = (await read(offset, 2))?.getUint16(0);
    offset += 2;
    const rowBytes = width * sampleBytes;
    const scale = Math.min(1, PSD_COMPOSITE_DIMENSION / Math.max(width, height));
    const outWidth = Math.max(1, Math.round(width * scale));
    const outHeight = Math.max(1, Math.round(height * scale));
    const sourceRow = outY => Math.floor((outY + 0.5) * height / outHeight);

    // Where each needed row starts and how long it is, in file order: a plane at a time, top to bottom.
    const rowOffsets = new Float64Array(planes * outHeight);
    const rowLengths = new Float64Array(planes * outHeight);
    if ( compression === COMPRESSION_RAW ) {
        for ( let index = 0; index < rowOffsets.length; index++ ) {
            const plane = Math.floor(index / outHeight);
            rowOffsets[index] = offset + (plane * height + sourceRow(index % outHeight)) * rowBytes;
            rowLengths[index] = rowBytes;
        }
    } else if ( compression === COMPRESSION_RLE ) {
        // Every row's packed length is listed before the data, so a row's position is the sum of the lengths before it.
        const countBytes = isPsb ? 4 : 2;
        const counts = await read(offset, planes * height * countBytes, 0);
        if ( ! counts ) return undefined;
        let rowOffset = offset + channels * height * countBytes;
        for ( let plane = 0, outY = 0, index = 0; plane < planes; plane++, outY = 0 ) {
            for ( let row = 0; row < height; row++ ) {
                const at = (plane * height + row) * countBytes;
                const length = isPsb ? counts.getUint32(at) : counts.getUint16(at);
                while ( outY < outHeight && sourceRow(outY) === row ) {
                    rowOffsets[index] = rowOffset;
                    rowLengths[index++] = length;
                    outY++;
                }
                rowOffset += length;
            }
        }
    } else {
        return undefined;
    }

    // 24-bit BMP: rows run bottom to top, each padded to 4 bytes, with pixels stored blue, green, red.
    const stride = (outWidth * 3 + 3) & ~3;
    const bmp = new Uint8Array(BMP_HEADER_BYTES + stride * outHeight);
    const bmpHeader = new DataView(bmp.buffer);
    bmpHeader.setUint16(0, 0x424d); // 'BM'
    bmpHeader.setUint32(2, bmp.length, true);
    bmpHeader.setUint32(10, BMP_HEADER_BYTES, true);
    bmpHeader.setUint32(14, 40, true);
    bmpHeader.setInt32(18, outWidth, true);
    bmpHeader.setInt32(22, outHeight, true);
    bmpHeader.setUint16(26, 1, true);
    bmpHeader.setUint16(28, 24, true);
    bmpHeader.setUint32(34, stride * outHeight, true);

    const unpacked = compression === COMPRESSION_RLE ? new Uint8Array(rowBytes) : undefined;
    for ( let index = 0; index < rowOffsets.length; index++ ) {
        if ( signal?.aborted ) return undefined;
        let end = rowOffsets[index] + rowLengths[index];
        for ( let next = index + 1; next < rowOffsets.length; next++ ) {
            const nextEnd = rowOffsets[next] + rowLengths[next];
            if ( nextEnd - rowOffsets[index] > ROW_WINDOW_BYTES ) break;
            end = nextEnd;
        }
        const view = await read(rowOffsets[index], rowLengths[index], end - rowOffsets[index]);
        if ( ! view ) return undefined;
        let row = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
        if ( unpacked ) {
            unpackRow(row, unpacked);
            row = unpacked;
        }

        const plane = Math.floor(index / outHeight);
        const outRow = BMP_HEADER_BYTES + (outHeight - 1 - index % outHeight) * stride;
        for ( let outX = 0; outX < outWidth; outX++ ) {
            // Samples are big-endian, so the first byte of a 16-bit one is its high byte.
            const value = row[Math.floor((outX + 0.5) * width / outWidth) * sampleBytes];
            const pixel = outRow + outX * 3;
            if ( plane === colorChannels ) {
                // The alpha plane comes after the colors, which are flattened onto white here.
                for ( let channel = 0; channel < 3; channel++ ) {
                    bmp[pixel + channel] = Math.round((bmp[pixel + channel] * value + 255 * (255 - value)) / 255);
                }
            } else if ( colorChannels === 1 ) {
                bmp.fill(value, pixel, pixel + 3);
            } else {
                bmp[pixel + 2 - plane] = value;
            }
        }
    }
    return new File([bmp], 'preview.bmp', { type: 'image/bmp' });
};

/**
 * Get a small image of a PSD or PSB: the JPEG preview Photoshop embeds in it, or else its merged image scaled down.
 * Layers are never read.
 *
 * @param {File} file
 * @param {AbortSignal} [signal]
 * @returns {Promise<File | undefined>} An image file browsers can decode, or `undefined` when the document has neither.
 */
export const readPsdPreview = async (file, signal) => {
    const read = createReader(file, PSD_PREVIEW_MAX_READ_BYTES);
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
                break;
            }
            // A slice stays on disk until the image decoder reads it.
            return new File([file.slice(dataOffset + PREVIEW_HEADER_BYTES, dataOffset + size)], 'preview.jpg', {
                type: 'image/jpeg',
            });
        }
        // Resource data is padded to an even size.
        offset = dataOffset + size + (size & 1);
    }
    // Editors other than Photoshop often save no preview.
    return renderComposite(file, header, resourcesEnd, signal);
};
