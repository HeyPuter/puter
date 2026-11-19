import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRecordingCanvas } from '../../../tests/fixtures/canvas.js';
import { SHEET_CELL_MAX_CHARACTERS, SHEET_MAX_COLUMNS, SHEET_MAX_ROWS, TEXT_MAX_READ_BYTES } from './config.js';
import { parseCsv, readCsvPreview } from './csv.js';

// A default column holds 8.43 characters, which is about 48 points, and a default row is 15 points tall.
const COLUMN = (8.43 * 7 + 5) * 0.75;
const ROW = 15;
let drawn;
/** Draw a CSV and return the text drawn, by what it says. */
const draw = async (content) => {
    const preview = await readCsvPreview(new File([content], 'data.csv'));
    expect(preview).toBeInstanceOf(File);
    expect(preview.type).toBe('image/png');
    return Object.fromEntries(drawn.text.map(word => [word.text, word]));
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

describe('parseCsv', () => {
    it('splits lines into fields at commas', () => {
        expect(parseCsv('name,age\nAda,36\n')).toEqual([['name', 'age'], ['Ada', '36']]);
    });

    it('reads quoted fields that hold commas, line breaks and quotes written twice', () => {
        expect(parseCsv('"a,b","line\nbreak","say ""hi"""\nnext')).toEqual([['a,b', 'line\nbreak', 'say "hi"'], ['next']]);
    });

    it('keeps a quote inside a field that does not start with one', () => {
        expect(parseCsv('5" pipe,x\n')).toEqual([['5" pipe', 'x']]);
    });

    it('keeps empty fields in their place', () => {
        expect(parseCsv(',b,,\n')).toEqual([['', 'b', '', '']]);
    });

    it.each([
        ['semicolons', 'a;b;1,5\nc;d;2,5', [['a', 'b', '1,5'], ['c', 'd', '2,5']]],
        ['tabs', 'a\tb\tc, d\n', [['a', 'b', 'c, d']]],
        ['bars', 'a|b|c\n', [['a', 'b', 'c']]],
        ['commas, when a quoted header holds semicolons', '"a;b",c\n', [['a;b', 'c']]],
    ])('finds a file separated by %s', (_label, content, expected) => {
        expect(parseCsv(content)).toEqual(expected);
    });

    it('reads a line the read cut off in the middle of a quoted field', () => {
        expect(parseCsv('a,"open')).toEqual([['a', 'open']]);
    });

    it(`keeps at most ${SHEET_MAX_ROWS} rows, ${SHEET_MAX_COLUMNS} columns and ${SHEET_CELL_MAX_CHARACTERS} characters a field`, () => {
        const wide = Array.from({ length: SHEET_MAX_COLUMNS + 10 }, (_, index) => index).join(',');
        const rows = parseCsv(`${'x'.repeat(SHEET_CELL_MAX_CHARACTERS * 2)}\n${wide}\n${'r\n'.repeat(SHEET_MAX_ROWS * 2)}`);
        expect(rows).toHaveLength(SHEET_MAX_ROWS);
        expect(rows[0][0]).toHaveLength(SHEET_CELL_MAX_CHARACTERS);
        expect(rows[1]).toHaveLength(SHEET_MAX_COLUMNS);
        expect(rows[1].at(-1)).toBe(String(SHEET_MAX_COLUMNS - 1));
    });
});

describe('readCsvPreview', () => {
    it('draws each field in its column and row, on a square canvas with gridlines', async () => {
        const cells = await draw('Name,,Total\n\nx,Below\n');
        expect(drawn).toMatchObject({ width: 256, height: 256 });
        expect(Object.keys(cells)).toEqual(['Name', 'Total', 'x', 'Below']);
        expect(cells.Name).toMatchObject({ x: 2, font: '11px sans-serif', color: '#000' });
        expect(cells.Total.x).toBeCloseTo(2 * COLUMN + 2);
        expect(cells.Below.x).toBeCloseTo(COLUMN + 2);
        expect(cells.Below.y - cells.Name.y).toBeCloseTo(2 * ROW);
        expect(drawn.lines.length).toBeGreaterThan(0);
    });

    it('aligns numbers right and other text left, as a spreadsheet does', async () => {
        const cells = await draw('label,12,-3.5e2,40%,1.2.3\n');
        // The recording canvas measures a character as half its font size, so a cell's text ends 2 points from its right.
        const rightOf = (word, column) => (column + 1) * COLUMN - 2 - word.length * 5.5;
        expect(cells.label.x).toBe(2);
        expect(cells['12'].x).toBeCloseTo(rightOf('12', 1));
        expect(cells['-3.5e2'].x).toBeCloseTo(rightOf('-3.5e2', 2));
        expect(cells['40%'].x).toBeCloseTo(rightOf('40%', 3));
        expect(cells['1.2.3'].x).toBeCloseTo(4 * COLUMN + 2);
    });

    it('aligns a number written with a decimal comma right', async () => {
        const cells = await draw('Name;Price\nApple;1,50\n');
        expect(cells['1,50'].x).toBeCloseTo(2 * COLUMN - 2 - 4 * 5.5);
    });

    it('draws a formula as the text it is', async () => {
        const cells = await draw('=SUM(A1:A2),=1+1\n');
        expect(Object.keys(cells)).toEqual(['=SUM(A1:A2)', '=1+1']);
    });

    it('draws a field that holds a line break on one line', async () => {
        const cells = await draw('"first\nsecond",x\n');
        expect(Object.keys(cells)).toEqual(['first second', 'x']);
    });

    it('reads only the start of a large file', async () => {
        const read = vi.spyOn(Blob.prototype, 'text');
        const cells = await draw(`first,row\n${'1,2\n'.repeat(TEXT_MAX_READ_BYTES)}`);
        expect(cells.first).toBeDefined();
        expect(read.mock.contexts.map(blob => blob.size)).toEqual([TEXT_MAX_READ_BYTES]);
    });

    it.each([
        ['an empty file', ''],
        ['a file of blank lines', '\n\n'],
        ['a file of empty fields', ',,,\n, ,\n'],
        ['a file that is not text', 'PK\x03\x04\0\0a,b'],
    ])('makes nothing of %s', async (_label, content) => {
        expect(await readCsvPreview(new File([content], 'data.csv'))).toBeUndefined();
    });
});
