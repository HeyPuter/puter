import { OFFICE_MAX_READ_BYTES, WORD_TEXT_MAX_CHARACTERS } from './config.js';
import { createPage, renderPage } from './page.js';
import { createReader } from './reader.js';

// Sector numbers above this one are markers: the end of a chain, a free sector, a sector of the tables themselves.
const MAX_SECTOR = 0xfffffffa;
const DIRECTORY_ENTRY_BYTES = 128;
const MAX_DIRECTORY_SECTORS = 4096;
const MAX_DIRECTORY_ENTRIES = 256;
const MINI_SECTOR_BYTES = 64;
// Streams shorter than this are kept in the mini stream. The format fixes the value, so the header's copy is not used.
const MINI_CUTOFF_BYTES = 4096;
const ENTRY_TYPE_STREAM = 2;
const WORD_SIGNATURE = 0xa5ec;
const FLAG_ENCRYPTED = 0x0100;
const FLAG_SECOND_TABLE = 0x0200;
const PIECE_TABLE_MAX_BYTES = 256 * 1024;
const PIECE_COMPRESSED = 0x40000000;
// The font size Word gave a new document in this format.
const FONT_SIZE = 12;

/**
 * Open an OLE compound file: a small filesystem of named streams, each a chain of sectors scattered through the file.
 *
 * @param {File} file
 * @returns {Promise<{
 *     streams: Record<string, { start: number, size: number }>,
 *     read: (stream: { start: number, size: number }, offset: number, length: number) => Promise<DataView | undefined>,
 * } | undefined>} The streams at the top level, and a way to read part of one.
 */
const openCompoundFile = async (file) => {
    // The allocation tables and the data they describe are far apart, so each gets a read window and half the budget.
    const readTable = createReader(file, OFFICE_MAX_READ_BYTES / 2);
    const readData = createReader(file, OFFICE_MAX_READ_BYTES / 2);
    const header = await readTable(0, 512, 512);
    if ( !header || header.getUint32(0) !== 0xd0cf11e0 || header.getUint32(4) !== 0xa1b11ae1 ) return undefined;
    const sectorBytes = 1 << header.getUint16(30, true);
    if ( sectorBytes !== 512 && sectorBytes !== 4096 ) return undefined;
    const perSector = sectorBytes / 4;
    const sectorCount = Math.ceil(file.size / sectorBytes);
    const positionOf = sector => (sector + 1) * sectorBytes;

    // The header lists the first 109 sectors of the allocation table; a chain of further sectors lists the rest.
    const tableSectors = [];
    for ( let at = 76; at < 512; at += 4 ) tableSectors.push(header.getUint32(at, true));
    for ( let sector = header.getUint32(68, true);
        sector <= MAX_SECTOR && tableSectors.length < 109 + sectorCount / perSector; ) {
        const list = await readTable(positionOf(sector), sectorBytes, sectorBytes);
        if ( ! list ) return undefined;
        for ( let at = 0; at < sectorBytes - 4; at += 4 ) tableSectors.push(list.getUint32(at, true));
        sector = list.getUint32(sectorBytes - 4, true);
    }

    // The first `count` sectors of a chain. The allocation table holds, for each sector, the one that follows it.
    const chainOf = async (first, count) => {
        const sectors = [];
        for ( let sector = first; sectors.length < Math.min(count, sectorCount) && sector <= MAX_SECTOR; ) {
            sectors.push(sector);
            const tableSector = tableSectors[Math.floor(sector / perSector)];
            const table = tableSector <= MAX_SECTOR && await readTable(positionOf(tableSector), sectorBytes, sectorBytes);
            if ( ! table ) return undefined;
            sector = table.getUint32(sector % perSector * 4, true);
        }
        return sectors;
    };

    const readChain = async (first, offset, length) => {
        const sectors = await chainOf(first, Math.ceil((offset + length) / sectorBytes));
        if ( !sectors || sectors.length * sectorBytes < offset + length ) return undefined;
        const bytes = new Uint8Array(length);
        for ( let written = 0; written < length; ) {
            const at = offset + written;
            const take = Math.min(length - written, sectorBytes - at % sectorBytes);
            const part = await readData(positionOf(sectors[Math.floor(at / sectorBytes)]) + at % sectorBytes, take);
            if ( ! part ) return undefined;
            bytes.set(new Uint8Array(part.buffer, part.byteOffset, take), written);
            written += take;
        }
        return bytes;
    };

    // Entries form a tree. The root's children are the top-level streams, linked to each other as siblings.
    const directory = await chainOf(header.getUint32(48, true), MAX_DIRECTORY_SECTORS);
    const entryAt = async (id) => {
        const sector = directory?.[Math.floor(id * DIRECTORY_ENTRY_BYTES / sectorBytes)];
        return sector === undefined
            ? undefined
            : readData(positionOf(sector) + id * DIRECTORY_ENTRY_BYTES % sectorBytes, DIRECTORY_ENTRY_BYTES);
    };
    const root = await entryAt(0);
    if ( ! root ) return undefined;
    const streams = {};
    const pending = [root.getUint32(76, true)];
    for ( let visited = 0; pending.length && visited < MAX_DIRECTORY_ENTRIES; visited++ ) {
        const entry = await entryAt(pending.pop());
        if ( ! entry ) continue;
        pending.push(entry.getUint32(68, true), entry.getUint32(72, true));
        if ( entry.getUint8(66) !== ENTRY_TYPE_STREAM ) continue;
        // The name is UTF-16 and its length counts the terminator.
        const nameBytes = Math.min(64, Math.max(2, entry.getUint16(64, true))) - 2;
        const name = new TextDecoder('utf-16le').decode(new Uint8Array(entry.buffer, entry.byteOffset, nameBytes));
        streams[name] = { start: entry.getUint32(116, true), size: entry.getUint32(120, true) };
    }

    // A stream under the cutoff is kept in 64-byte sectors inside the root entry's stream, with a table of their own.
    const readSmallStream = async (stream) => {
        const miniTableBytes = Math.min(header.getUint32(64, true) * sectorBytes, OFFICE_MAX_READ_BYTES / 2);
        const miniTable = await readChain(header.getUint32(60, true), 0, miniTableBytes);
        if ( ! miniTable ) return undefined;
        const next = new DataView(miniTable.buffer);
        const bytes = new Uint8Array(Math.ceil(stream.size / MINI_SECTOR_BYTES) * MINI_SECTOR_BYTES);
        for ( let sector = stream.start, written = 0; written < bytes.length; written += MINI_SECTOR_BYTES ) {
            if ( sector * 4 + 4 > miniTable.length ) return undefined;
            const part = await readChain(root.getUint32(116, true), sector * MINI_SECTOR_BYTES, MINI_SECTOR_BYTES);
            if ( ! part ) return undefined;
            bytes.set(part, written);
            sector = next.getUint32(sector * 4, true);
        }
        return bytes;
    };

    const read = async (stream, offset, length) => {
        if ( offset + length > stream.size ) return undefined;
        const bytes = stream.size < MINI_CUTOFF_BYTES
            ? (stream.bytes ??= await readSmallStream(stream))?.subarray(offset, offset + length)
            : await readChain(stream.start, offset, length);
        return bytes && new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
    };
    return { streams, read };
};

/**
 * Get a small image of the first page of a Word 97-2003 document, drawn from its text alone.
 * Its formatting is not read.
 *
 * @param {File} file
 * @param {AbortSignal} [signal]
 * @returns {Promise<File | undefined>} An image file browsers can decode, or `undefined` when there is no text to show.
 */
export const readDocPreview = async (file, signal) => {
    const compound = await openCompoundFile(file);
    const main = compound?.streams.WordDocument;
    // The start of the main stream says where everything else is.
    const start = main && await compound.read(main, 0, 426);
    if ( !start || start.getUint16(0, true) !== WORD_SIGNATURE || signal?.aborted ) return undefined;
    const flags = start.getUint16(10, true);
    const table = compound.streams[flags & FLAG_SECOND_TABLE ? '1Table' : '0Table'];
    const textLength = Math.min(start.getUint32(76, true), WORD_TEXT_MAX_CHARACTERS);
    const piecesLength = start.getUint32(422, true);
    if ( flags & FLAG_ENCRYPTED || !table || !piecesLength || piecesLength > PIECE_TABLE_MAX_BYTES ) return undefined;
    const pieces = await compound.read(table, start.getUint32(418, true), piecesLength);
    if ( ! pieces ) return undefined;

    // Formatting blocks (type 1) come before the piece table (type 2).
    let at = 0;
    while ( at + 3 <= pieces.byteLength && pieces.getUint8(at) === 1 ) at += 3 + pieces.getUint16(at + 1, true);
    if ( at + 5 > pieces.byteLength || pieces.getUint8(at) !== 2 ) return undefined;
    // The table is n + 1 character positions, then n 8-byte descriptions of where each piece's text is.
    const pieceCount = Math.floor((pieces.getUint32(at + 1, true) - 4) / 12);
    at += 5;
    if ( pieceCount < 1 || at + pieceCount * 12 + 4 > pieces.byteLength ) return undefined;
    let text = '';
    for ( let piece = 0; piece < pieceCount && text.length < textLength; piece++ ) {
        if ( signal?.aborted ) return undefined;
        const characters = Math.min(
            pieces.getUint32(at + (piece + 1) * 4, true) - pieces.getUint32(at + piece * 4, true),
            textLength - text.length,
        );
        const location = pieces.getUint32(at + (pieceCount + 1) * 4 + piece * 8 + 2, true);
        // A compressed piece stores one byte per character, at half the offset it states.
        const compressed = !!(location & PIECE_COMPRESSED);
        const offset = (location & (PIECE_COMPRESSED - 1)) / (compressed ? 2 : 1);
        const bytes = characters > 0 && await compound.read(main, offset, compressed ? characters : characters * 2);
        if ( ! bytes ) break;
        text += new TextDecoder(compressed ? 'windows-1252' : 'utf-16le').decode(bytes);
    }

    // A form feed ends the page, unless nothing comes before it.
    const firstCharacter = text.search(/\S/);
    const pageEnd = firstCharacter < 0 ? -1 : text.indexOf('\x0c', firstCharacter);
    // A field keeps its instruction between 0x13 and 0x14 and what it displays between 0x14 and 0x15, and either part
    // can hold more fields. Text is shown when it is in no field's instruction.
    let shown = '';
    let hidden = 0;
    const inInstruction = [];
    for ( const part of (pageEnd < 0 ? text : text.slice(0, pageEnd)).split(/([\x13-\x15])/) ) {
        if ( part === '\x13' ) {
            inInstruction.push(true);
            hidden++;
        } else if ( part === '\x14' ) {
            if ( inInstruction.at(-1) ) {
                inInstruction[inInstruction.length - 1] = false;
                hidden--;
            }
        } else if ( part === '\x15' ) {
            if ( inInstruction.pop() ) hidden--;
        } else if ( ! hidden ) {
            shown += part;
        }
    }
    const paragraphs = shown
        .replace(/\x0b/g, '\n')
        .replace(/\x1e/g, '-')
        // Paragraphs end with a carriage return, table cells and rows with 0x07.
        .split(/[\r\x07]/)
        // What is left of the control characters marks pictures, footnotes and other things not drawn.
        .map(paragraph => paragraph.replace(/[\x00-\x08\x0c\x0e-\x1f]/g, ''));
    const page = createPage();
    page.blocks = paragraphs.map(paragraph => ({
        runs: [{ text: paragraph, size: FONT_SIZE, bold: false, italic: false, color: '#000' }],
        size: FONT_SIZE,
        align: 'start',
        indent: 0,
        spaceBefore: 0,
        spaceAfter: 0,
        lineSpacing: 1,
    }));
    return renderPage(page);
};
