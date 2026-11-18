// The box structure that MP4 audio and video files and HEIF images share: each box is a size, a four-letter type and
// its content, which is often more boxes.
const MAX_BOXES = 4096;

/** The text of `length` one-byte characters at `at`, as a box's type is written. */
export const textOf = (view, at, length) => {
    let text = '';
    for ( let index = 0; index < length; index++ ) text += String.fromCharCode(view.getUint8(at + index));
    return text;
};

/**
 * Find a box among the boxes between `start` and `end`, stepping over the others without reading them.
 *
 * @returns {Promise<{ start: number, end: number } | undefined>} Where the box's content starts and ends.
 */
export const findBox = async (read, start, end, type, signal) => {
    let offset = start;
    for ( let box = 0; box < MAX_BOXES && offset + 8 <= end && !signal?.aborted; box++ ) {
        const header = await read(offset, 8);
        if ( ! header ) return undefined;
        let size = header.getUint32(0);
        let headerBytes = 8;
        // A size of one means the real size follows in 64 bits, and a size of zero that the box runs to the end.
        if ( size === 1 ) {
            const large = await read(offset + 8, 8);
            if ( ! large ) return undefined;
            size = Number(large.getBigUint64(0));
            headerBytes = 16;
        } else if ( size === 0 ) {
            size = end - offset;
        }
        if ( size < headerBytes || offset + size > end ) return undefined;
        if ( textOf(header, 4, 4) === type ) return { start: offset + headerBytes, end: offset + size };
        offset += size;
    }
    return undefined;
};
