import {
    HEIF_DECODE_TIMEOUT_MS,
    HEIF_MAX_PIXELS,
    HEIF_MAX_READ_BYTES,
    HEIF_MAX_TILES,
    HEIF_META_MAX_BYTES,
    HEIF_PICTURE_DIMENSION,
} from './config.js';
import { findBox, textOf } from './isobmff.js';
import { createReader } from './reader.js';

const MAX_ENTRIES = 4096;

/**
 * @typedef {Object} HeifItem One of the images, or pieces of data, a HEIF file holds.
 * @property {string} [type] `hvc1` for an HEVC picture, `grid` for an image made of tiles.
 * @property {number} [method] 0 when its data is at offsets in the file, 1 when it is in the `idat` box.
 * @property {Array<{ offset: number, length: number }>} extents Where its data is.
 * @property {Array<{ type: string, start: number, end: number }>} properties Its properties, in the order they apply.
 */

// The boxes inside a stretch of a box already in memory.
const boxesIn = (view, start, end) => {
    const boxes = [];
    for ( let at = start; at + 8 <= end && boxes.length < MAX_ENTRIES; ) {
        const size = view.getUint32(at);
        if ( size < 8 || at + size > end ) break;
        boxes.push({ type: textOf(view, at + 4, 4), start: at + 8, end: at + size });
        at += size;
    }
    return boxes;
};

// A number of `bytes` bytes, as the item locations store them in whatever width the file chose.
const numberAt = (view, at, bytes) => {
    let value = 0;
    for ( let index = 0; index < bytes; index++ ) value = value * 256 + view.getUint8(at + index);
    return value;
};

/**
 * Read the index of a HEIF file: its items, where their data is, how they refer to each other and their properties.
 *
 * @param {DataView} view The content of the `meta` box.
 * @returns {{ primary?: number, items: Map<number, HeifItem>, references: Array<{ type: string, from: number, to: number[] }>, data?: { start: number, end: number } }}
 */
const readIndex = (view) => {
    const items = new Map();
    const itemOf = (id) => {
        if ( !items.has(id) && items.size < MAX_ENTRIES ) items.set(id, { extents: [], properties: [] });
        return items.get(id);
    };
    const index = { primary: undefined, items, references: [], data: undefined };
    // `meta` starts with four bytes of version and flags, as most of the boxes inside it do.
    for ( const box of boxesIn(view, 4, view.byteLength) ) {
        const version = box.end - box.start >= 4 ? view.getUint8(box.start) : 0;
        let at = box.start + 4;
        if ( box.type === 'pitm' ) {
            index.primary = version ? view.getUint32(at) : view.getUint16(at);
        } else if ( box.type === 'idat' ) {
            index.data = { start: box.start, end: box.end };
        } else if ( box.type === 'iinf' ) {
            // An entry count, then one box per item: its number, a protection index and its type.
            for ( const entry of boxesIn(view, at + (version ? 4 : 2), box.end) ) {
                const wide = view.getUint8(entry.start) >= 3;
                const id = wide ? view.getUint32(entry.start + 4) : view.getUint16(entry.start + 4);
                if ( entry.type === 'infe' && view.getUint8(entry.start) >= 2 && itemOf(id) ) {
                    itemOf(id).type = textOf(view, entry.start + (wide ? 10 : 8), 4);
                }
            }
        } else if ( box.type === 'iref' ) {
            // One box per reference: the item it comes from, then the items it points at.
            const idBytes = version ? 4 : 2;
            for ( const reference of boxesIn(view, at, box.end) ) {
                const count = view.getUint16(reference.start + idBytes);
                if ( reference.start + idBytes + 2 + count * idBytes > reference.end ) continue;
                index.references.push({
                    type: reference.type,
                    from: numberAt(view, reference.start, idBytes),
                    to: Array.from({ length: count }, (_, to) => numberAt(view, reference.start + idBytes + 2 + to * idBytes, idBytes)),
                });
            }
        } else if ( box.type === 'iloc' ) {
            // The widths of the numbers that follow, then for each item its number and the stretches of its data.
            const offsetBytes = view.getUint8(at) >> 4;
            const lengthBytes = view.getUint8(at) & 15;
            const baseBytes = view.getUint8(at + 1) >> 4;
            const indexBytes = version ? view.getUint8(at + 1) & 15 : 0;
            const idBytes = version === 2 ? 4 : 2;
            const count = numberAt(view, at + 2, idBytes);
            at += 2 + idBytes;
            for ( let item = 0; item < count && at < box.end; item++ ) {
                const located = itemOf(numberAt(view, at, idBytes));
                at += idBytes;
                const method = version ? view.getUint16(at) & 15 : 0;
                at += version ? 4 : 2;
                const base = numberAt(view, at, baseBytes);
                at += baseBytes;
                const extentCount = view.getUint16(at);
                at += 2;
                for ( let extent = 0; extent < extentCount && at < box.end; extent++ ) {
                    at += indexBytes;
                    if ( located && located.extents.length < MAX_ENTRIES ) {
                        located.method = method;
                        located.extents.push({ offset: base + numberAt(view, at, offsetBytes), length: numberAt(view, at + offsetBytes, lengthBytes) });
                    }
                    at += offsetBytes + lengthBytes;
                }
            }
        } else if ( box.type === 'iprp' ) {
            // A list of properties, and for each item the positions in it of the properties that item has.
            const [list, associations] = ['ipco', 'ipma'].map(type => boxesIn(view, box.start, box.end).find(inner => inner.type === type));
            if ( !list || !associations ) continue;
            const properties = boxesIn(view, list.start, list.end);
            const idBytes = view.getUint8(associations.start) ? 4 : 2;
            const wide = view.getUint32(associations.start) & 1;
            const count = view.getUint32(associations.start + 4);
            at = associations.start + 8;
            for ( let entry = 0; entry < Math.min(count, MAX_ENTRIES) && at + idBytes < associations.end; entry++ ) {
                const owner = itemOf(numberAt(view, at, idBytes));
                const owned = view.getUint8(at + idBytes);
                at += idBytes + 1;
                for ( let property = 0; property < owned && at < associations.end; property++ ) {
                    // The top bit says whether a reader must understand the property; the rest is its position.
                    const position = (wide ? view.getUint16(at) & 0x7fff : view.getUint8(at) & 0x7f) - 1;
                    at += wide ? 2 : 1;
                    if ( owner && properties[position] ) owner.properties.push(properties[position]);
                }
            }
        }
    }
    return index;
};

/**
 * The codec string a video decoder is configured with, from the HEVC configuration a picture carries.
 *
 * @param {DataView} configuration The content of an `hvcC` box.
 * @returns {string} For example `hvc1.3.E.L90.B0`.
 */
const codecOf = (configuration) => {
    const first = configuration.getUint8(1);
    // The profiles a stream is compatible with are written with their bits in reverse order.
    let compatibility = 0;
    for ( let bit = 0; bit < 32; bit++ ) compatibility = compatibility * 2 + (configuration.getUint32(2) >>> bit & 1);
    const constraints = Array.from({ length: 6 }, (_, index) => configuration.getUint8(6 + index));
    while ( constraints.length && !constraints.at(-1) ) constraints.pop();
    return [
        `hvc1.${['', 'A', 'B', 'C'][first >> 6]}${first & 31}`,
        compatibility.toString(16).toUpperCase(),
        `${first & 32 ? 'H' : 'L'}${configuration.getUint8(12)}`,
        ...constraints.map(byte => byte.toString(16).toUpperCase()),
    ].join('.');
};

/**
 * Decode HEVC pictures with the browser's video decoder, which uses the one the device has.
 *
 * @param {VideoDecoderConfig} config
 * @param {Uint8Array[]} pictures Each picture's coded data.
 * @param {(frame: VideoFrame, index: number) => void} show Called with each picture, by its position in `pictures`.
 * @param {AbortSignal} [signal]
 * @returns {Promise<boolean>} Whether every picture was decoded.
 */
const decodePictures = (config, pictures, show, signal) => new Promise((resolve) => {
    let shown = 0;
    let settled = false;
    let timer;
    let decoder;
    const finish = (complete) => {
        if ( settled ) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        if ( decoder.state !== 'closed' ) decoder.close();
        resolve(complete);
    };
    const onAbort = () => finish(false);
    decoder = new VideoDecoder({
        output: (frame) => {
            try {
                if ( ! settled ) show(frame, frame.timestamp);
                shown++;
            } finally {
                frame.close();
            }
        },
        error: () => finish(false),
    });
    timer = setTimeout(() => finish(false), HEIF_DECODE_TIMEOUT_MS);
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
        decoder.configure(config);
        // Every picture stands alone, so each is a key frame. Its timestamp carries its position.
        pictures.forEach((data, index) => decoder.decode(new EncodedVideoChunk({ type: 'key', timestamp: index, data })));
        decoder.flush().then(() => finish(shown === pictures.length), () => finish(false));
    } catch {
        finish(false);
    }
});

/**
 * Get a small image of a HEIC or HEIF photo, for a browser that can't decode the file itself: its stored thumbnail,
 * or else the photo, decoded with the device's video decoder and scaled down. Nothing is decoded in script.
 *
 * @param {File} file
 * @param {AbortSignal} [signal]
 * @returns {Promise<File | undefined>} A JPEG, or `undefined` when the device has no decoder for the photo, or the
 *     file holds no picture this reads.
 */
export const readHeifPreview = async (file, signal) => {
    if ( typeof VideoDecoder === 'undefined' ) return undefined;
    const read = createReader(file, HEIF_MAX_READ_BYTES);
    const start = await read(0, 12);
    if ( !start || textOf(start, 4, 4) !== 'ftyp' ) return undefined;
    const meta = await findBox(read, 0, file.size, 'meta', signal);
    if ( !meta || meta.end - meta.start > HEIF_META_MAX_BYTES ) return undefined;
    const view = await read(meta.start, meta.end - meta.start, 0);
    if ( ! view ) return undefined;
    let index;
    try {
        index = readIndex(view);
    } catch {
        // An index that points outside itself is not one to go by.
        return undefined;
    }
    const { primary, items, references, data } = index;

    // The file's own small copy of the photo, when it has one, and the photo itself otherwise.
    const referring = (type, id) => references.filter(reference => reference.type === type && (type === 'dimg' ? reference.from === id : reference.to.includes(id)));
    const thumbnail = referring('thmb', primary).map(reference => reference.from).find(id => items.get(id)?.type === 'hvc1');
    const shownId = thumbnail ?? primary;
    const shown = items.get(shownId);
    if ( ! shown ) return undefined;
    const propertyOf = (item, type) => item.properties.find(property => property.type === type);
    const sizeOf = (item) => {
        const size = propertyOf(item, 'ispe');
        return size && { width: view.getUint32(size.start + 4), height: view.getUint32(size.start + 8) };
    };
    // An item's data, from the stretches of the file, or of the index's own data box, that hold it.
    const dataOf = async (item) => {
        const length = item.extents.reduce((total, extent) => total + extent.length, 0);
        if ( !length || length > HEIF_MAX_READ_BYTES ) return undefined;
        const bytes = new Uint8Array(length);
        let written = 0;
        for ( const extent of item.extents ) {
            if ( item.method === 1 ) {
                if ( !data || data.start + extent.offset + extent.length > data.end ) return undefined;
                bytes.set(new Uint8Array(view.buffer, view.byteOffset + data.start + extent.offset, extent.length), written);
            } else if ( item.method === 0 ) {
                const part = await read(extent.offset, extent.length, 0);
                if ( ! part ) return undefined;
                bytes.set(new Uint8Array(part.buffer, part.byteOffset, extent.length), written);
            } else {
                return undefined;
            }
            written += extent.length;
        }
        return bytes;
    };

    // A photo is one picture, or a grid of pictures of one size, laid out in rows from the top left.
    let tiles = [shown];
    let columns = 1;
    let size = sizeOf(shown);
    if ( shown.type === 'grid' ) {
        const grid = await dataOf(shown);
        tiles = (referring('dimg', shownId)[0]?.to ?? []).map(id => items.get(id));
        if ( !grid || grid.length < 8 || !tiles.length || tiles.length > HEIF_MAX_TILES || tiles.includes(undefined) ) return undefined;
        const layout = new DataView(grid.buffer);
        columns = layout.getUint8(3) + 1;
        // The size of the whole image, in 16 or in 32 bits each way.
        size = layout.getUint8(1) & 1 && grid.length >= 12
            ? { width: layout.getUint32(4), height: layout.getUint32(8) }
            : { width: layout.getUint16(4), height: layout.getUint16(6) };
        if ( tiles.length !== columns * (layout.getUint8(2) + 1) ) return undefined;
    }
    const tileSize = sizeOf(tiles[0]);
    const configuration = propertyOf(tiles[0], 'hvcC');
    if ( tiles.some(tile => tile.type !== 'hvc1') || !configuration || configuration.end - configuration.start < 23 ||
        !size?.width || !size.height || !tileSize?.width || !tileSize.height ||
        size.width * size.height > HEIF_MAX_PIXELS || tileSize.width * tileSize.height > HEIF_MAX_PIXELS ) {
        return undefined;
    }
    const description = new Uint8Array(view.buffer.slice(view.byteOffset + configuration.start, view.byteOffset + configuration.end));
    const config = {
        codec: codecOf(new DataView(description.buffer)),
        description,
        codedWidth: tileSize.width,
        codedHeight: tileSize.height,
    };
    // Whether the device can decode this is asked before any of the photo is read.
    if ( !(await VideoDecoder.isConfigSupported(config)).supported || signal?.aborted ) return undefined;
    const pictures = [];
    for ( const tile of tiles ) {
        const picture = await dataOf(tile);
        if ( !picture || signal?.aborted ) return undefined;
        pictures.push(picture);
    }

    // The photo is turned and mirrored as its properties say, in the order they are listed, and scaled as it is drawn.
    const turns = [];
    for ( const property of shown.properties ) {
        if ( property.type === 'irot' ) turns.push(['turn', view.getUint8(property.start) & 3]);
        else if ( property.type === 'imir' ) turns.push(['mirror', view.getUint8(property.start) & 1]);
    }
    const sideways = turns.reduce((quarters, [kind, amount]) => quarters + (kind === 'turn' ? amount : 0), 0) % 2 === 1;
    const scale = Math.min(1, HEIF_PICTURE_DIMENSION / Math.max(size.width, size.height));
    const width = Math.max(1, Math.round(size.width * scale));
    const height = Math.max(1, Math.round(size.height * scale));
    const canvas = new OffscreenCanvas(sideways ? height : width, sideways ? width : height);
    const ctx = canvas.getContext('2d');
    ctx.translate(canvas.width / 2, canvas.height / 2);
    // A canvas applies the last change made to it first, so the changes are made in reverse.
    for ( const [kind, amount] of turns.reverse() ) {
        // A turn is counted in quarters, anticlockwise. A mirror is about the vertical axis, or else the horizontal.
        if ( kind === 'turn' ) ctx.rotate(-amount * Math.PI / 2);
        else ctx.scale(amount ? 1 : -1, amount ? -1 : 1);
    }
    ctx.translate(-width / 2, -height / 2);
    // Tiles can reach past the image's own size, which cuts them off.
    ctx.beginPath();
    ctx.rect(0, 0, width, height);
    ctx.clip();
    const decoded = await decodePictures(config, pictures, (frame, index) => {
        ctx.drawImage(frame, index % columns * tileSize.width * scale, Math.floor(index / columns) * tileSize.height * scale,
                        tileSize.width * scale, tileSize.height * scale);
    }, signal);
    if ( ! decoded ) return undefined;
    return new File([await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 })], 'preview.jpg', { type: 'image/jpeg' });
};
