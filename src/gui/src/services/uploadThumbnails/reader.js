const READ_WINDOW_BYTES = 64 * 1024;

/**
 * Make a function that reads byte ranges of a file through one buffered window, so many small reads near each other
 * cost one read of the file. A read that would take the total past `maxReadBytes` resolves to `undefined`.
 *
 * @param {Blob} file
 * @param {number} maxReadBytes
 * @returns {(offset: number, length: number, windowLength?: number) => Promise<DataView | undefined>}
 */
export const createReader = (file, maxReadBytes) => {
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
