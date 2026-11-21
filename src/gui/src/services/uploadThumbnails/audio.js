import { AUDIO_COVER_MAX_BYTES, AUDIO_MAX_READ_BYTES } from './config.js';
import { imageTypeOf } from './images.js';
import { findBox, textOf } from './isobmff.js';
import { createReader } from './reader.js';

const FRONT_COVER = 3;
// How far into a picture's frame its own header can reach before the image starts.
const PICTURE_HEADER_BYTES = 1024;
const MAX_FLAC_BLOCKS = 1024;

// A size stored seven bits to a byte, so that no byte of it looks like the start of an audio frame.
const syncsafe = (view, at) => (view.getUint8(at) & 0x7f) << 21 | (view.getUint8(at + 1) & 0x7f) << 14 |
    (view.getUint8(at + 2) & 0x7f) << 7 | view.getUint8(at + 3) & 0x7f;

/**
 * Make an image file of a stretch of the audio file, without reading it: the slice stays on disk until it is decoded.
 *
 * @returns {Promise<File | undefined>} `undefined` when the stretch is empty, over the size limit or not an image.
 */
const pictureAt = async (file, read, start, end) => {
    if ( end - start < 12 || end - start > AUDIO_COVER_MAX_BYTES || end > file.size ) return undefined;
    const signature = await read(start, 12);
    const type = signature && imageTypeOf(signature);
    return type ? new File([file.slice(start, end)], 'cover', { type }) : undefined;
};

/**
 * Find the cover in the ID3v2 tag that starts an MP3: the picture marked as the front cover, or else the first one.
 *
 * @returns {Promise<{ cover?: File, end: number } | undefined>} `end` is where the tag ends and the audio starts.
 */
const readId3Cover = async (file, read, signal) => {
    const header = await read(0, 10);
    if ( ! header ) return undefined;
    const version = header.getUint8(3);
    const flags = header.getUint8(5);
    const end = 10 + syncsafe(header, 6);
    // In an unsynchronised tag the bytes of a picture are altered, and they are left alone here.
    if ( version < 2 || version > 4 || flags & 0x80 ) return { end };
    let offset = 10;
    if ( version > 2 && flags & 0x40 ) {
        const extended = await read(offset, 4);
        if ( ! extended ) return { end };
        offset += version === 4 ? syncsafe(extended, 0) : 4 + extended.getUint32(0);
    }

    // Version 2.2 has three-letter frame names and three-byte sizes; later versions have four of each.
    const headerBytes = version === 2 ? 6 : 10;
    let cover;
    while ( offset + headerBytes <= Math.min(end, file.size) && !signal?.aborted ) {
        const frame = await read(offset, headerBytes);
        // The frames end where the padding starts.
        if ( !frame || frame.getUint8(0) === 0 ) break;
        const name = textOf(frame, 0, version === 2 ? 3 : 4);
        const size = version === 2
            ? frame.getUint8(3) << 16 | frame.getUint16(4)
            : version === 4 ? syncsafe(frame, 4) : frame.getUint32(4);
        const dataStart = offset + headerBytes;
        const dataEnd = dataStart + size;
        if ( size <= 0 || dataEnd > end ) break;
        offset = dataEnd;
        // A frame that is compressed, encrypted or altered can't be shown as it is stored.
        const altered = version === 4 ? frame.getUint8(9) & 0x0f : version === 3 ? frame.getUint8(9) & 0xc0 : 0;
        if ( (name !== 'APIC' && name !== 'PIC') || altered ) continue;

        // Text encoding, the image's type, the kind of picture, a description, then the image.
        const start = await read(dataStart, Math.min(size, PICTURE_HEADER_BYTES), PICTURE_HEADER_BYTES);
        if ( ! start ) break;
        const wide = start.getUint8(0) === 1 || start.getUint8(0) === 2;
        let at = 1;
        if ( version === 2 ) at += 3;
        else while ( at < start.byteLength && start.getUint8(at++) !== 0 );
        if ( at >= start.byteLength ) continue;
        const kind = start.getUint8(at++);
        // The description ends in one zero byte, or in two at an even position when it is 16-bit text.
        if ( wide ) while ( at + 1 < start.byteLength && start.getUint16(at) !== 0 ) at += 2;
        else while ( at < start.byteLength && start.getUint8(at) !== 0 ) at++;
        at += wide ? 2 : 1;
        if ( at >= start.byteLength ) continue;
        const picture = await pictureAt(file, read, dataStart + at, dataEnd);
        if ( picture && (kind === FRONT_COVER || !cover) ) cover = picture;
        if ( picture && kind === FRONT_COVER ) break;
    }
    return { cover, end };
};

/** Find the cover among a FLAC file's metadata blocks, which start right after its four-byte signature. */
const readFlacCover = async (file, read, start, signal) => {
    let cover;
    let offset = start + 4;
    for ( let block = 0; block < MAX_FLAC_BLOCKS && !signal?.aborted; block++ ) {
        const header = await read(offset, 4);
        if ( ! header ) break;
        const length = header.getUint32(0) & 0xffffff;
        if ( (header.getUint8(0) & 0x7f) === 6 ) {
            // A picture block: its kind, then a type and a description each behind their length, four numbers
            // about the image, and the image behind its length.
            const fixed = await read(offset + 4, 8);
            const typeLength = fixed?.getUint32(4);
            const description = fixed && await read(offset + 12 + typeLength, 4);
            const imageLength = description && await read(offset + 16 + typeLength + description.getUint32(0) + 16, 4);
            if ( imageLength ) {
                const imageStart = offset + 16 + typeLength + description.getUint32(0) + 20;
                const picture = imageStart + imageLength.getUint32(0) <= offset + 4 + length &&
                    await pictureAt(file, read, imageStart, imageStart + imageLength.getUint32(0));
                if ( picture && (fixed.getUint32(0) === FRONT_COVER || !cover) ) cover = picture;
                if ( picture && fixed.getUint32(0) === FRONT_COVER ) break;
            }
        }
        // The first bit marks the last block before the audio.
        if ( header.getUint8(0) & 0x80 ) break;
        offset += 4 + length;
    }
    return cover;
};

/** Find the cover an MP4 audio file keeps with its tags, at `moov` / `udta` / `meta` / `ilst` / `covr` / `data`. */
const readMp4Cover = async (file, read, signal) => {
    const find = (within, type, skip = 0) => within && findBox(read, within.start + skip, within.end, type, signal);
    const movie = await find({ start: 0, end: file.size }, 'moov');
    // `meta` has four bytes of version and flags before the boxes inside it.
    const list = await find(await find(await find(movie, 'udta'), 'meta'), 'ilst', 4);
    const data = await find(await find(list, 'covr'), 'data');
    // The image follows eight bytes that give its type and locale.
    return data && pictureAt(file, read, data.start + 8, data.end);
};

/**
 * Get the cover art stored in an audio file's tags: an MP3's ID3v2 tag, a FLAC's picture block or an MP4 audio file's
 * `covr` atom. Only the tags are read, never the audio.
 *
 * @param {File} file
 * @param {AbortSignal} [signal]
 * @returns {Promise<File | undefined>} An image file browsers can decode, or `undefined` for a file with no cover.
 */
export const readAudioCover = async (file, signal) => {
    const read = createReader(file, AUDIO_MAX_READ_BYTES);
    const start = await read(0, 12);
    if ( ! start ) return undefined;
    if ( textOf(start, 0, 3) === 'ID3' ) {
        const tag = await readId3Cover(file, read, signal);
        if ( !tag || tag.cover ) return tag?.cover;
        // A FLAC file can have an ID3 tag put in front of it.
        const after = await read(tag.end, 4);
        return after?.getUint32(0) === 0x664c6143 ? readFlacCover(file, read, tag.end, signal) : undefined;
    }
    if ( start.getUint32(0) === 0x664c6143 ) return readFlacCover(file, read, 0, signal);
    if ( textOf(start, 4, 4) === 'ftyp' ) return readMp4Cover(file, read, signal);
    return undefined;
};
