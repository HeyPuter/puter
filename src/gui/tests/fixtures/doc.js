// Word 97-2003 documents (DOC) laid out sector by sector in an OLE compound file, generated without a library.
const SECTOR_BYTES = 512;
const MINI_SECTOR_BYTES = 64;
const MINI_CUTOFF = 4096;
const END_OF_CHAIN = 0xfffffffe;
const TABLE_SECTOR = 0xfffffffd;
const LIST_SECTOR = 0xfffffffc;
const FREE = 0xffffffff;
const HEADER_TABLE_SECTORS = 109;

const padded = (bytes, unit) => {
    const whole = new Uint8Array(Math.ceil(bytes.length / unit) * unit);
    whole.set(bytes);
    return whole;
};

/**
 * An OLE compound file holding `streams`, a map of top-level stream names to their bytes. Streams under 4096 bytes
 * go in the mini stream, as the format requires.
 */
export const createCompoundFile = (streams) => {
    // Siblings are ordered by name length, then by name, and linked as a chain down the right side of the tree.
    const names = Object.keys(streams).sort((a, b) => a.length - b.length || (a.toUpperCase() < b.toUpperCase() ? -1 : 1));
    const sectors = [];
    const next = [];
    // Append a chain of sectors holding `bytes` and return its first sector.
    const allocate = (bytes, marker) => {
        const whole = padded(bytes, SECTOR_BYTES);
        const first = sectors.length;
        for ( let at = 0; at < whole.length; at += SECTOR_BYTES ) {
            sectors.push(whole.subarray(at, at + SECTOR_BYTES));
            next.push(marker ?? (at + SECTOR_BYTES < whole.length ? sectors.length : END_OF_CHAIN));
        }
        return whole.length ? first : END_OF_CHAIN;
    };

    const miniSectors = [];
    const miniNext = [];
    const entries = names.map((name) => {
        const bytes = streams[name];
        if ( bytes.length >= MINI_CUTOFF ) return { name, size: bytes.length, start: allocate(bytes) };
        const whole = padded(bytes, MINI_SECTOR_BYTES);
        const start = miniSectors.length;
        for ( let at = 0; at < whole.length; at += MINI_SECTOR_BYTES ) {
            miniSectors.push(whole.subarray(at, at + MINI_SECTOR_BYTES));
            miniNext.push(at + MINI_SECTOR_BYTES < whole.length ? miniSectors.length : END_OF_CHAIN);
        }
        return { name, size: bytes.length, start };
    });
    const miniStream = new Uint8Array(miniSectors.length * MINI_SECTOR_BYTES);
    miniSectors.forEach((sector, index) => miniStream.set(sector, index * MINI_SECTOR_BYTES));
    const miniStreamStart = allocate(miniStream);
    const miniTable = new Uint8Array(padded(new Uint8Array(miniNext.length * 4), SECTOR_BYTES).length).fill(255);
    miniNext.forEach((value, index) => new DataView(miniTable.buffer).setUint32(index * 4, value, true));
    const miniTableStart = allocate(miniTable);

    const directory = new Uint8Array(padded(new Uint8Array((entries.length + 1) * 128), SECTOR_BYTES).length);
    const writeEntry = (index, name, type, fields) => {
        const view = new DataView(directory.buffer, index * 128, 128);
        [...name].forEach((character, at) => view.setUint16(at * 2, character.charCodeAt(0), true));
        view.setUint16(64, (name.length + 1) * 2, true);
        view.setUint8(66, type);
        view.setUint8(67, 1);
        view.setUint32(68, FREE, true);
        view.setUint32(72, fields.right ?? FREE, true);
        view.setUint32(76, fields.child ?? FREE, true);
        view.setUint32(116, fields.start, true);
        view.setUint32(120, fields.size, true);
    };
    writeEntry(0, 'Root Entry', 5, { child: entries.length ? 1 : FREE, start: miniStreamStart, size: miniStream.length });
    entries.forEach((entry, index) => writeEntry(index + 1, entry.name, 2, {
        ...entry,
        right: index + 1 < entries.length ? index + 2 : FREE,
    }));
    // Unused entries are marked free on every link.
    for ( let index = entries.length + 1; index * 128 < directory.length; index++ ) {
        new Uint8Array(directory.buffer, index * 128 + 68, 12).fill(255);
    }
    const directoryStart = allocate(directory);

    // The allocation table covers its own sectors, and past the header's 109 slots, the sectors that list them.
    const perSector = SECTOR_BYTES / 4;
    let tableCount = 0;
    let listCount = 0;
    for ( ;; ) {
        const needed = Math.ceil((sectors.length + tableCount + listCount) / perSector);
        const lists = Math.ceil(Math.max(0, needed - HEADER_TABLE_SECTORS) / (perSector - 1));
        if ( needed === tableCount && lists === listCount ) break;
        tableCount = needed;
        listCount = lists;
    }
    const tableStart = sectors.length;
    const listStart = tableStart + tableCount;
    const table = new Uint8Array(tableCount * SECTOR_BYTES).fill(255);
    const tableView = new DataView(table.buffer);
    next.forEach((value, index) => tableView.setUint32(index * 4, value, true));
    for ( let index = 0; index < tableCount; index++ ) tableView.setUint32((tableStart + index) * 4, TABLE_SECTOR, true);
    for ( let index = 0; index < listCount; index++ ) tableView.setUint32((listStart + index) * 4, LIST_SECTOR, true);
    const lists = new Uint8Array(listCount * SECTOR_BYTES).fill(255);
    const listView = new DataView(lists.buffer);
    for ( let index = HEADER_TABLE_SECTORS; index < tableCount; index++ ) {
        const slot = index - HEADER_TABLE_SECTORS;
        const list = Math.floor(slot / (perSector - 1));
        listView.setUint32(list * SECTOR_BYTES + slot % (perSector - 1) * 4, tableStart + index, true);
    }
    for ( let list = 0; list < listCount; list++ ) {
        listView.setUint32((list + 1) * SECTOR_BYTES - 4, list + 1 < listCount ? listStart + list + 1 : END_OF_CHAIN, true);
    }

    const header = new Uint8Array(SECTOR_BYTES).fill(255, 76);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0xd0cf11e0);
    view.setUint32(4, 0xa1b11ae1);
    view.setUint16(24, 0x3e, true);
    view.setUint16(26, 3, true);
    view.setUint16(28, 0xfffe, true);
    view.setUint16(30, 9, true);
    view.setUint16(32, 6, true);
    view.setUint32(44, tableCount, true);
    view.setUint32(48, directoryStart, true);
    view.setUint32(56, MINI_CUTOFF, true);
    view.setUint32(60, miniTableStart, true);
    view.setUint32(64, miniTable.length / SECTOR_BYTES, true);
    view.setUint32(68, listCount ? listStart : END_OF_CHAIN, true);
    view.setUint32(72, listCount, true);
    for ( let index = 0; index < Math.min(tableCount, HEADER_TABLE_SECTORS); index++ ) {
        view.setUint32(76 + index * 4, tableStart + index, true);
    }

    const file = new Uint8Array(SECTOR_BYTES * (1 + sectors.length + tableCount + listCount));
    file.set(header);
    sectors.forEach((sector, index) => file.set(sector, (index + 1) * SECTOR_BYTES));
    file.set(table, (tableStart + 1) * SECTOR_BYTES);
    file.set(lists, (listStart + 1) * SECTOR_BYTES);
    return file;
};

/**
 * A Word document whose text is `pieces`, each `{ text, compressed }`: a compressed piece is stored one byte per
 * character, the others as UTF-16. `small` keeps both streams under 4096 bytes, `flags` are added to the header's,
 * `formatting` puts that many bytes of formatting ahead of the piece table, and `extra` adds more streams.
 */
export const createDoc = ({
    pieces = [{ text: 'Hello\r', compressed: true }],
    small = false,
    flags = 0,
    formatting = 0,
    extra = {},
} = {}) => {
    const textStart = 1024;
    const encoded = pieces.map(({ text, compressed }) => (compressed
        ? Uint8Array.from(text, character => character.charCodeAt(0))
        : new Uint8Array(Uint16Array.from(text, character => character.charCodeAt(0)).buffer)));
    const textBytes = encoded.reduce((total, bytes) => total + bytes.length, 0);
    const main = new Uint8Array(Math.max(textStart + textBytes, small ? 0 : MINI_CUTOFF));
    const pieceTableStart = 16;
    // Formatting blocks, then the piece table: character positions followed by where each piece's text is.
    const pieceTable = new Uint8Array((formatting ? 3 + formatting : 0) + 5 + pieces.length * 12 + 4);
    const tableView = new DataView(pieceTable.buffer);
    let at = 0;
    if ( formatting ) {
        tableView.setUint8(at, 1);
        tableView.setUint16(at + 1, formatting, true);
        at += 3 + formatting;
    }
    tableView.setUint8(at, 2);
    tableView.setUint32(at + 1, pieces.length * 12 + 4, true);
    at += 5;
    let position = 0;
    let offset = textStart;
    pieces.forEach(({ text, compressed }, index) => {
        tableView.setUint32(at + index * 4, position, true);
        position += text.length;
        tableView.setUint32(at + (index + 1) * 4, position, true);
        tableView.setUint32(at + (pieces.length + 1) * 4 + index * 8 + 2, compressed ? offset * 2 | 0x40000000 : offset, true);
        main.set(encoded[index], offset);
        offset += encoded[index].length;
    });

    const view = new DataView(main.buffer);
    view.setUint16(0, 0xa5ec, true);
    view.setUint16(2, 0xc1, true);
    // The second table stream is the one in use.
    view.setUint16(10, 0x0200 | flags, true);
    view.setUint32(76, position, true);
    view.setUint32(418, pieceTableStart, true);
    view.setUint32(422, pieceTable.length, true);
    const table = new Uint8Array(Math.max(pieceTableStart + pieceTable.length, small ? 0 : MINI_CUTOFF));
    table.set(pieceTable, pieceTableStart);
    return createCompoundFile({ WordDocument: main, '1Table': table, ...extra });
};
