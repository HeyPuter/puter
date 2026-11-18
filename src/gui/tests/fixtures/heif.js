// HEIF photos (HEIC) assembled box by box, generated without an image library. The one coded picture they hold is
// real, so a device with an HEVC decoder can show them.
const ascii = text => Uint8Array.from(text, character => character.charCodeAt(0));
const fromBase64 = text => Uint8Array.from(atob(text), character => character.charCodeAt(0));
const u16 = value => [value >>> 8 & 255, value & 255];
const u32 = value => [value >>> 24 & 255, value >>> 16 & 255, value >>> 8 & 255, value & 255];
const concat = (...parts) => {
    const bytes = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
    let offset = 0;
    for ( const part of parts ) {
        bytes.set(part, offset);
        offset += part.length;
    }
    return bytes;
};

/** The HEVC configuration of the picture below: Main Still Picture profile, level 3. */
export const HEVC_CONFIGURATION = fromBase64('AQNwAAAAsAAAAAAAHvAA/P34+AAACwOgAAEAF0ABDAH//wNwAAADALAAAAMAAAMAHnAkoQABACJCAQEDcAAAAwCwAAADAAADAB6gFCBBwj4h7kWVTcCAgYAgogABAAlEAcBhcshEU2Q=');
/** A coded picture of 128 x 64 pixels, red on its left half and blue on its right. */
export const HEVC_PICTURE = fromBase64('AAAANygBr6NTRoF8//4/Z//9jH7L8f+j7Da//20Jvv4Btv/6lFP5+hY/NQFf+d0mHaRoPm4HCZjiqPw=');
export const PICTURE_WIDTH = 128;
export const PICTURE_HEIGHT = 64;

/** A box: its size, its four-letter type and its content. */
export const box = (type, ...content) => {
    const body = concat(...content);
    return concat(u32(body.length + 8), ascii(type), body);
};
const fullBox = (type, version, flags, ...content) => box(type, [version, ...u32(flags).slice(1)], ...content);

/** The properties an item can have. `turn` counts quarter turns anticlockwise; `mirror` is 0 for left to right. */
export const property = {
    configuration: (bytes = HEVC_CONFIGURATION) => box('hvcC', bytes),
    size: (width, height) => fullBox('ispe', 0, 0, u32(width), u32(height)),
    turn: quarters => box('irot', [quarters]),
    mirror: axis => box('imir', [axis]),
};

/** The data of a grid item: how many rows and columns of tiles make an image of `width` x `height`. */
export const gridLayout = (rows, columns, width, height, { wide = false } = {}) => new Uint8Array([
    0, wide ? 1 : 0, rows - 1, columns - 1, ...(wide ? [...u32(width), ...u32(height)] : [...u16(width), ...u16(height)]),
]);

/**
 * A HEIF file. `items` are `{ id, type, data, properties, inIndex, extents }`: `properties` are positions in the
 * `properties` list, counted from 1, `inIndex` keeps the item's data in the index and not in the file's data box,
 * and `extents` splits its data into that many stretches. `references` are `{ type, from, to }`. `wide` writes item
 * numbers in 32 bits and property positions in 16, `locationVersion` is the version of the item locations (0 has no
 * way to say an item's data is in the index), and `before` is put between the file's type and its index.
 */
export const createHeif = ({
    items = [{ id: 1, type: 'hvc1', data: HEVC_PICTURE, properties: [1, 2] }],
    properties = [property.configuration(), property.size(PICTURE_WIDTH, PICTURE_HEIGHT)],
    primary = 1,
    references = [],
    brand = 'heic',
    wide = false,
    locationVersion = wide ? 2 : 1,
    before = new Uint8Array(0),
} = {}) => {
    const id = value => (wide ? u32(value) : u16(value));
    const fileType = box('ftyp', ascii(brand), u32(0), ascii(`mif1${brand}`));
    const inIndex = items.filter(item => item.inIndex);
    const indexData = concat(...inIndex.map(item => item.data));
    const inFile = items.filter(item => !item.inIndex);
    const index = (dataStart) => {
        const offsets = new Map();
        let at = 0;
        for ( const item of inIndex ) {
            offsets.set(item, at);
            at += item.data.length;
        }
        at = dataStart;
        for ( const item of inFile ) {
            offsets.set(item, at);
            at += item.data.length;
        }
        return fullBox('meta', 0, 0,
                        fullBox('hdlr', 0, 0, u32(0), ascii('pict'), new Uint8Array(13)),
                        fullBox('pitm', wide ? 1 : 0, 0, id(primary)),
                        fullBox('iinf', 0, 0, u16(items.length), ...items.map(item =>
                            fullBox('infe', wide ? 3 : 2, 0, id(item.id), u16(0), ascii(item.type), [0]))),
                        ...(references.length ? [fullBox('iref', wide ? 1 : 0, 0, ...references.map(reference =>
                            box(reference.type, id(reference.from), u16(reference.to.length), ...reference.to.map(id))))] : []),
                        box('iprp', box('ipco', ...properties), fullBox('ipma', wide ? 1 : 0, wide ? 1 : 0, u32(items.length), ...items.map(item => concat(
                            id(item.id), [(item.properties ?? []).length],
                            ...(item.properties ?? []).map(position => (wide ? u16(0x8000 | position) : [0x80 | position])),
                        )))),
                        ...(indexData.length ? [box('idat', indexData)] : []),
                        // Offsets and lengths of four bytes, no base offset, and for each item its stretches of data.
                        fullBox('iloc', locationVersion, 0, [0x44, 0], id(items.length).slice(locationVersion === 2 ? 0 : -2), ...items.map((item) => {
                            const count = item.extents ?? 1;
                            const each = Math.ceil(item.data.length / count);
                            return concat(
                                id(item.id).slice(locationVersion === 2 ? 0 : -2),
                                locationVersion ? u16(item.inIndex ? 1 : 0) : [],
                                u16(0), u16(count),
                                ...Array.from({ length: count }, (_, extent) => concat(
                                    u32(offsets.get(item) + extent * each),
                                    u32(Math.min(each, item.data.length - extent * each)),
                                )),
                            );
                        })));
    };
    // The index is as long whatever offsets it holds, so its length says where the data after it starts.
    const dataStart = fileType.length + before.length + index(0).length + 8;
    return concat(fileType, before, index(dataStart), box('mdat', ...inFile.map(item => item.data)));
};

/**
 * A HEIF photo made of `rows` x `columns` copies of the picture as tiles, as a phone stores a large photo, of
 * `width` x `height` pixels in all. The grid's layout is kept in the index, as phones keep it.
 */
export const createHeifGrid = ({ rows = 2, columns = 2, width = columns * PICTURE_WIDTH, height = rows * PICTURE_HEIGHT, ...options } = {}) => {
    const tiles = Array.from({ length: rows * columns }, (_, index) => ({ id: index + 1, type: 'hvc1', data: HEVC_PICTURE, properties: [1, 2] }));
    const grid = rows * columns + 1;
    return createHeif({
        items: [...tiles, { id: grid, type: 'grid', data: gridLayout(rows, columns, width, height), properties: [3], inIndex: true }],
        properties: [property.configuration(), property.size(PICTURE_WIDTH, PICTURE_HEIGHT), property.size(width, height)],
        primary: grid,
        references: [{ type: 'dimg', from: grid, to: tiles.map(tile => tile.id) }],
        ...options,
    });
};
