import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRecordingCanvas, linesOf } from '../../../tests/fixtures/canvas.js';
import { createCompoundFile, createDoc } from '../../../tests/fixtures/doc.js';
import { WORD_TEXT_MAX_CHARACTERS } from './config.js';
import { readDocPreview } from './doc.js';

const docFile = options => new File([createDoc(options)], 'letter.doc');
const compressed = text => ({ text, compressed: true });
let drawn;
/** Draw a document's first page and return the text of its lines. */
const draw = async (options) => {
    const preview = await readDocPreview(docFile(options));
    expect(preview).toBeInstanceOf(File);
    expect(preview.type).toBe('image/png');
    return linesOf(drawn).map(line => line.text);
};
// Every read the parser makes goes through a slice's arrayBuffer().
const trackReads = () => {
    const read = vi.spyOn(Blob.prototype, 'arrayBuffer');
    return () => read.mock.contexts.reduce((total, blob) => total + blob.size, 0);
};

beforeEach(() => {
    const canvas = createRecordingCanvas();
    drawn = canvas.drawn;
    vi.stubGlobal('OffscreenCanvas', canvas.Canvas);
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('readDocPreview', () => {
    it('draws the document\'s paragraphs top to bottom on a default page', async () => {
        expect(await draw({ pieces: [compressed('First\rSecond line\r\rFourth\r')] })).toEqual(['First', 'Second line', 'Fourth']);
        expect(drawn).toMatchObject({ width: 198, height: 256 });
        expect(drawn.text.every(word => word.font === '12px sans-serif' && word.color === '#000')).toBe(true);
        expect(drawn.text[0]).toMatchObject({ x: 72 });
        // The empty third paragraph still takes a line.
        const lines = linesOf(drawn);
        expect(lines[2].y - lines[1].y).toBeCloseTo(2 * (lines[1].y - lines[0].y));
    });

    it('joins pieces stored one byte per character with pieces stored as UTF-16', async () => {
        const lines = await draw({ pieces: [compressed('It\x92s caf\xe9 \x80'), { text: '5 中文\rسلام\r' }, compressed('End\r')] });
        expect(lines).toEqual(['It’s café €5 中文', 'سلام', 'End']);
    });

    it('reads streams kept in the mini stream', async () => {
        expect(await draw({ small: true, pieces: [compressed('Short note\r'), { text: 'Second\r' }] })).toEqual(['Short note', 'Second']);
    });

    it('follows the allocation table past the sectors the header lists', async () => {
        // More than 109 table sectors are needed once the file passes about 7 MiB.
        const file = docFile({ extra: { Data: new Uint8Array(7.5 * 1024 * 1024) } });
        const bytesRead = trackReads();
        expect(await readDocPreview(file)).toBeInstanceOf(File);
        expect(linesOf(drawn).map(line => line.text)).toEqual(['Hello']);
        expect(bytesRead()).toBeLessThan(300_000);
    });

    it('skips the formatting stored ahead of the piece table', async () => {
        expect(await draw({ formatting: 37 })).toEqual(['Hello']);
    });

    it('shows what a field displays and not its instruction', async () => {
        const lines = await draw({ pieces: [compressed('Page \x13 PAGE \\* MERGEFORMAT \x141\x15 of \x13 NUMPAGES \x15\rNext\r')] });
        expect(lines).toEqual(['Page 1 of', 'Next']);
    });

    it('splits table cells and line breaks into lines, and drops the marks of things it does not draw', async () => {
        const lines = await draw({ pieces: [compressed('Cell A\x07Cell B\x07\x07Line one\x0bLine two\rPicture \x01\x08here\x02, non\x1ebreaking\r')] });
        expect(lines).toEqual(['Cell A', 'Cell B', 'Line one', 'Line two', 'Picture here, non-breaking']);
    });

    it.each(['Shown\r\x0cHidden\r', '\x0c\rShown\r\x0cHidden\r'])('stops at a page break that has content before it: %j', async (text) => {
        expect(await draw({ pieces: [compressed(text)] })).toEqual(['Shown']);
    });

    it('reads text up to the character budget', async () => {
        const file = docFile({ pieces: [{ text: `${'word '.repeat(WORD_TEXT_MAX_CHARACTERS / 5)}\r` }, { text: 'x'.repeat(8_000_000) }] });
        const bytesRead = trackReads();
        expect(await readDocPreview(file)).toBeInstanceOf(File);
        expect(drawn.text.every(word => word.text === 'word')).toBe(true);
        expect(bytesRead()).toBeLessThan(300_000);
    });

    it('ends on a chain that loops back on itself', async () => {
        const bytes = createDoc({ pieces: [compressed('x'.repeat(3000))] });
        const view = new DataView(bytes.buffer);
        // Make every sector follow itself.
        const tableSector = view.getUint32(76, true);
        for ( let sector = 0; sector < 128; sector++ ) {
            const at = (tableSector + 1) * 512 + sector * 4;
            if ( view.getUint32(at, true) < 0xfffffffa ) view.setUint32(at, sector, true);
        }
        const preview = await readDocPreview(new File([bytes], 'letter.doc'));
        expect(preview === undefined || preview instanceof File).toBe(true);
    });

    it.each([
        ['an empty file', new Uint8Array(0)],
        ['a file that is not a compound file', new TextEncoder().encode('not a document, only named like one'.repeat(40))],
        ['a compound file without a Word stream', createCompoundFile({ Workbook: new Uint8Array(5000) })],
        ['a Word stream with another signature', createCompoundFile({ WordDocument: new Uint8Array(5000), '1Table': new Uint8Array(5000) })],
        ['a document without its table stream', createCompoundFile({ WordDocument: createDocStream() })],
        ['an encrypted document', createDoc({ flags: 0x0100 })],
        ['a document with no text', createDoc({ pieces: [compressed('\r \r\x01\r')] })],
    ])('returns nothing for %s', async (_label, bytes) => {
        expect(await readDocPreview(new File([bytes], 'letter.doc'))).toBeUndefined();
    });

    it('returns nothing for a document cut off anywhere', async () => {
        // The directory and the allocation table are the last sectors of this file.
        const doc = createDoc();
        for ( let length = 0; length < doc.length; length += 64 ) {
            expect(await readDocPreview(new File([doc.subarray(0, length)], 'letter.doc'))).toBeUndefined();
        }
    });

    it('stops when the upload is cancelled', async () => {
        const controller = new AbortController();
        controller.abort();
        expect(await readDocPreview(docFile(), controller.signal)).toBeUndefined();
    });
});

// A main stream with a valid header, taken from a whole document.
function createDocStream () {
    const stream = new Uint8Array(4096);
    const view = new DataView(stream.buffer);
    view.setUint16(0, 0xa5ec, true);
    view.setUint16(10, 0x0200, true);
    view.setUint32(76, 5, true);
    view.setUint32(418, 16, true);
    view.setUint32(422, 21, true);
    return stream;
}
