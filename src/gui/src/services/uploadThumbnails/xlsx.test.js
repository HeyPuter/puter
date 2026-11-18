import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRecordingCanvas } from '../../../tests/fixtures/canvas.js';
import { createZip } from '../../../tests/fixtures/docx.js';
import { cell, createXlsx, row, styles } from '../../../tests/fixtures/xlsx.js';
import {
    OFFICE_XML_MAX_BYTES,
    SHEET_CELL_MAX_CHARACTERS,
    SHEET_MAX_COLUMNS,
    SHEET_MAX_ROWS,
} from './config.js';
import { readXlsxPreview } from './xlsx.js';

const xlsxFile = options => new File([createXlsx(options)], 'budget.xlsx');
const text = (reference, value, options) => cell(reference, value, { type: 'str', ...options });
const sheetOf = (rows, before = '') => `${before}<sheetData>${rows}</sheetData>`;
// A default column holds 8.43 characters, which is about 48 points, and a default row is 15 points tall.
const COLUMN = (8.43 * 7 + 5) * 0.75;
const ROW = 15;
const texts = () => drawn.text.map(word => word.text);
// Positions add up widths that are not whole numbers.
const rounded = values => values.map(value => Math.round(value * 100) / 100);
let drawn;
/** Draw a workbook's first sheet and return the text drawn, by what it says. */
const draw = async (options) => {
    const preview = await readXlsxPreview(xlsxFile(options));
    expect(preview).toBeInstanceOf(File);
    expect(preview.type).toBe('image/png');
    return Object.fromEntries(drawn.text.map(word => [word.text, word]));
};
// The fills of cells: every fill but the white background.
const cellFills = () => drawn.fills.slice(1).map(({ color, ...box }) => ({
    color,
    ...Object.fromEntries(Object.entries(box).map(([side, value]) => [side, Math.round(value * 100) / 100])),
}));

beforeEach(() => {
    const canvas = createRecordingCanvas();
    drawn = canvas.drawn;
    vi.stubGlobal('OffscreenCanvas', canvas.Canvas);
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('readXlsxPreview', () => {
    it('returns the thumbnail the editor stored', async () => {
        const jpeg = Uint8Array.from({ length: 3000 }, (_, index) => index * 7 % 256);
        const preview = await readXlsxPreview(xlsxFile({ thumbnail: jpeg }));
        expect(preview.type).toBe('image/jpeg');
        expect(new Uint8Array(await preview.arrayBuffer())).toEqual(jpeg);
        expect(drawn.text).toEqual([]);
    });

    it('draws each cell\'s text in its column and row, on a square canvas', async () => {
        const cells = await draw({
            sheet: sheetOf(row(1, text('A1', 'Name') + text('C1', 'Total')) + row(3, text('B3', 'Below'))),
        });
        expect(drawn).toMatchObject({ width: 256, height: 256 });
        expect(cells.Name).toMatchObject({ x: 2, font: '11px sans-serif', color: '#000' });
        expect(cells.Total.x).toBeCloseTo(2 * COLUMN + 2);
        expect(cells.Below.x).toBeCloseTo(COLUMN + 2);
        expect(cells.Name.y).toBe(cells.Total.y);
        expect(cells.Below.y - cells.Name.y).toBeCloseTo(2 * ROW);
        expect(cells.Name.y).toBeLessThan(ROW);
    });

    it('reads shared strings, strings kept in the cell, numbers, booleans and errors', async () => {
        await draw({
            strings: ['Plain &amp; simple', '<si><r><t>Rich </t></r><r><t>text</t></r><rPh><t>phonetic</t></rPh></si>', '<si/>'],
            sheet: sheetOf(
                row(1, cell('A1', 0, { type: 's' }) + cell('B1', 1, { type: 's' }) + cell('C1', 2, { type: 's' }) + cell('D1', 9, { type: 's' })) +
                row(2, cell('A2', 'Kept &lt;here&gt;', { type: 'inlineStr' }) + cell('B2', '0.30000000000000004') + cell('C2', '1E+21') + cell('D2', '-12.50')) +
                row(3, cell('A3', 1, { type: 'b' }) + cell('B3', 0, { type: 'b' }) + cell('C3', '#DIV/0!', { type: 'e' }) + cell('D3', 'result', { type: 'str' })) +
                row(4, '<c r="A4"><f>SUM(B2:D2)</f><v>7</v></c>'),
            ),
        });
        expect(texts()).toEqual([
            'Plain & simple', 'Rich text',
            'Kept <here>', '0.3', '1e+21', '-12.5',
            'TRUE', 'FALSE', '#DIV/0!', 'result',
            '7',
        ]);
    });

    it('aligns numbers right, booleans and errors in the middle, and text left, unless the cell says otherwise', async () => {
        const cells = await draw({
            styles: styles({ formats: '<xf/><xf><alignment horizontal="center"/></xf><xf><alignment horizontal="right"/></xf><xf><alignment horizontal="left"/></xf>' }),
            sheet: sheetOf(
                row(1, text('A1', 'ab') + cell('B1', '1234') + cell('C1', 1, { type: 'b' })) +
                row(2, text('A2', 'cd', { style: 1 }) + text('B2', 'ef', { style: 2 }) + cell('C2', '56', { style: 3 })),
            ),
        });
        // At 11 points a character is 5.5 wide.
        expect(rounded(['ab', '1234', 'TRUE', 'cd', 'ef', '56'].map(name => cells[name].x))).toEqual(rounded([
            2,
            2 * COLUMN - 2 - 22,
            2 * COLUMN + (COLUMN - 22) / 2,
            (COLUMN - 11) / 2,
            2 * COLUMN - 2 - 11,
            2 * COLUMN + 2,
        ]));
    });

    it('uses the sheet\'s column widths and row heights, and skips hidden ones', async () => {
        const cells = await draw({
            sheet: sheetOf(
                row(1, text('A1', 'a') + text('B1', 'b') + text('C1', 'hidden') + text('D1', 'd'), ' ht="30" customHeight="1"') +
                row(2, text('A2', 'gone'), ' hidden="1"') + row(3, text('A3', 'e')),
                '<sheetFormatPr defaultRowHeight="20" defaultColWidth="10"/><cols><col min="1" max="1" width="20"/><col min="3" max="3" width="9" hidden="1"/></cols>',
            ),
        });
        // A column of 20 characters is (20 * 7 + 5) * 0.75 points wide, and a default one here 56.25.
        expect(cells.b.x).toBeCloseTo(108.75 + 2);
        expect(cells.d.x).toBeCloseTo(108.75 + 56.25 + 2);
        expect(cells.hidden).toBeUndefined();
        expect(cells.gone).toBeUndefined();
        expect(cells.e.y - cells.a.y).toBeCloseTo(20);
        expect(cells.a.y).toBeGreaterThan(20);
    });

    it('gives a column that states a style and no width the default width', async () => {
        const cells = await draw({
            sheet: sheetOf(row(1, text('A1', 'a') + text('B1', 'b') + text('C1', 'c')), '<cols><col min="1" max="2" style="1"/></cols>'),
        });
        expect(rounded([cells.a.x, cells.b.x, cells.c.x])).toEqual(rounded([2, COLUMN + 2, 2 * COLUMN + 2]));
    });

    it('leaves a shared-string cell with no value empty', async () => {
        await draw({ strings: ['first string'], sheet: sheetOf(row(1, '<c r="A1" t="s"/><c r="B1" t="s"><v></v></c>' + text('C1', 'c'))) });
        expect(texts()).toEqual(['c']);
    });

    it('places cells that state no reference after the one before', async () => {
        const cells = await draw({ sheet: sheetOf(row('', text('', 'a') + text('', 'b')) + row('', text('', 'c'))) });
        expect(rounded([cells.a.x, cells.b.x, cells.c.x])).toEqual(rounded([2, COLUMN + 2, 2]));
        expect(cells.c.y - cells.a.y).toBeCloseTo(ROW);
    });

    it('applies each cell\'s font and fill, with colors given directly or taken from the theme', async () => {
        const cells = await draw({
            // Dark 1, light 1, dark 2, light 2, then the accents.
            theme: ['111111', 'FAFAFA', '222222', 'EEEEEE', '4F81BD', 'C0504D'],
            styles: styles({
                // A conditional format's font and fill are no cell's.
                before: '<dxfs><dxf><font><b/><color rgb="FF00FF00"/></font><fill><patternFill patternType="solid"><fgColor rgb="FF00FF00"/></patternFill></fill></dxf></dxfs>',
                fonts: '<font><sz val="11"/><color theme="1"/></font><font><b/><sz val="14"/><color rgb="FFFF0000"/></font><font><b val="0"/><color theme="0"/></font>',
                fills: '<fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
                    '<fill><patternFill patternType="solid"><fgColor theme="4"/><bgColor indexed="64"/></patternFill></fill>' +
                    '<fill><patternFill patternType="solid"><fgColor theme="4" tint="0.5"/></patternFill></fill>' +
                    '<fill><patternFill patternType="solid"><fgColor rgb="FF102030" tint="-0.5"/></patternFill></fill>',
                formats: '<xf fontId="0" fillId="0"/><xf fontId="1" fillId="2"/><xf fontId="2" fillId="3"/><xf fontId="0" fillId="4"/><xf fontId="0" fillId="1"/>',
            }),
            sheet: sheetOf(row(1, text('A1', 'plain') + text('B1', 'head', { style: 1 }) + text('C1', 'tinted', { style: 2 }) +
                cell('D1', '', { style: 3 }) + text('E1', 'gray', { style: 4 }) + text('F1', 'unknown', { style: 40 }))),
        });
        expect(cells.plain).toMatchObject({ font: '11px sans-serif', color: 'rgb(17, 17, 17)' });
        expect(cells.head).toMatchObject({ font: 'bold 14px sans-serif', color: 'rgb(255, 0, 0)' });
        expect(cells.tinted).toMatchObject({ font: '11px sans-serif', color: 'rgb(250, 250, 250)' });
        expect(cells.unknown).toMatchObject({ font: '11px sans-serif', color: 'rgb(17, 17, 17)' });
        // A cell with a fill and no text is drawn too. The gray pattern is not a solid fill.
        expect(cellFills()).toEqual([1, 2, 3].map((column, index) => ({
            color: ['rgb(79, 129, 189)', 'rgb(167, 192, 222)', 'rgb(8, 16, 24)'][index],
            ...Object.fromEntries(Object.entries({ x: column * COLUMN, y: 0, width: COLUMN, height: ROW })
                .map(([side, value]) => [side, Math.round(value * 100) / 100])),
        })));
    });

    it('resolves colors given as positions in the standard palette', async () => {
        // Workbooks converted from the older format use these in place of theme colors.
        const cells = await draw({
            styles: styles({
                fonts: '<font/><font><color indexed="10"/></font><font><color indexed="64"/></font><font><color indexed="99"/></font>',
                fills: '<fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
                    '<fill><patternFill patternType="solid"><fgColor indexed="13"/><bgColor indexed="64"/></patternFill></fill>' +
                    '<fill><patternFill patternType="solid"><fgColor indexed="22" tint="-0.5"/></patternFill></fill>' +
                    '<fill><patternFill patternType="solid"><fgColor indexed="64"/></patternFill></fill>',
                formats: '<xf/><xf fontId="1" fillId="2"/><xf fontId="2" fillId="3"/><xf fontId="3" fillId="4"/>',
            }),
            sheet: sheetOf(row(1, text('A1', 'red', { style: 1 }) + text('B1', 'system', { style: 2 }) + text('C1', 'unknown', { style: 3 }))),
        });
        expect(cells.red.color).toBe('rgb(255, 0, 0)');
        // Positions 64 and up are the system's colors, which are left at the default.
        expect(cells.system.color).toBe('#000');
        expect(cells.unknown.color).toBe('#000');
        expect(cellFills().map(fill => fill.color)).toEqual(['rgb(255, 255, 0)', 'rgb(96, 96, 96)']);
    });

    it('lets text aligned left run on over empty cells, and cuts other text off at its cell', async () => {
        const cells = await draw({
            // At 11 points, 30 characters are 165 wide: more than three columns.
            sheet: sheetOf(
                row(1, text('A1', 'a'.repeat(30))) +
                row(2, text('A2', 'b'.repeat(30)) + text('C2', 'next')) +
                row(3, cell('A3', '123456789012345')) +
                row(4, text('A4', 'short')),
            ),
        });
        const clipped = ['a'.repeat(30), 'b'.repeat(30), '123456789012345', 'short'].map(name => cells[name].clip.width);
        expect(rounded(clipped)).toEqual(rounded([4 * COLUMN, 2 * COLUMN, COLUMN, COLUMN]));
    });

    it('draws gridlines around the columns and rows in view, unless the sheet hides them', async () => {
        await draw({});
        // 480 points hold 10 columns and 32 rows, so 11 and 33 lines.
        expect(drawn.lines).toHaveLength(11 + 33);
        expect(drawn.lines[1]).toEqual({ from: { x: COLUMN, y: 0 }, to: { x: COLUMN, y: 480 } });
        drawn.lines.length = 0;
        await draw({ sheet: sheetOf(row(1, text('A1', 'Hello')), '<sheetViews><sheetView showGridLines="0" workbookViewId="0"/></sheetViews>') });
        expect(drawn.lines).toHaveLength(0);
    });

    it('draws only the rows and columns that reach into view', async () => {
        const rows = Array.from({ length: 50 }, (_, index) => row(index + 1, text(`A${index + 1}`, `r${index + 1}`) + text(`L${index + 1}`, 'far'))).join('');
        await draw({ sheet: sheetOf(rows) });
        expect(texts()).toEqual(Array.from({ length: 32 }, (_, index) => `r${index + 1}`));
    });

    it('reads a workbook whose elements carry a namespace prefix', async () => {
        // Writers built on the Open XML SDK put every element under `x:`, and some give the relationship id a
        // prefix of their own.
        const main = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
        const relationships = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
        const preview = await readXlsxPreview(new File([createZip({
            'xl/workbook.xml': `<x:workbook xmlns:x="${main}"><x:sheets>` +
                `<x:sheet name="Data" sheetId="1" d3p1:id="rId1" xmlns:d3p1="${relationships}"/></x:sheets></x:workbook>`,
            'xl/_rels/workbook.xml.rels': `<Relationships><Relationship Id="rId1" Type="${relationships}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
            'xl/worksheets/sheet1.xml': `<x:worksheet xmlns:x="${main}"><x:sheetFormatPr defaultRowHeight="20"/><x:cols><x:col min="1" max="1" width="20"/></x:cols>` +
                '<x:sheetData><x:row r="1"><x:c r="A1" t="s" s="1"><x:v>0</x:v></x:c><x:c r="B1"><x:v>5</x:v></x:c></x:row>' +
                '<x:row r="2"><x:c r="A2" t="inlineStr"><x:is><x:t>kept</x:t></x:is></x:c></x:row></x:sheetData></x:worksheet>',
            'xl/sharedStrings.xml': `<x:sst xmlns:x="${main}"><x:si><x:t>Prefixed</x:t></x:si></x:sst>`,
            'xl/styles.xml': `<x:styleSheet xmlns:x="${main}"><x:fonts><x:font/><x:font><x:b/></x:font></x:fonts>` +
                '<x:fills><x:fill><x:patternFill patternType="none"/></x:fill>' +
                '<x:fill><x:patternFill patternType="solid"><x:fgColor rgb="FF00FF00"/></x:patternFill></x:fill></x:fills>' +
                '<x:cellXfs><x:xf/><x:xf fontId="1" fillId="1"/></x:cellXfs></x:styleSheet>',
        })], 'budget.xlsx'));
        expect(preview).toBeInstanceOf(File);
        expect(drawn.text.map(({ text: value, font }) => [value, font])).toEqual([
            ['Prefixed', 'bold 11px sans-serif'], ['5', '11px sans-serif'], ['kept', '11px sans-serif'],
        ]);
        expect(cellFills()).toEqual([{ color: 'rgb(0, 255, 0)', x: 0, y: 0, width: 108.75, height: 20 }]);
    });

    it('finds the strings, styles and theme through the workbook\'s relationships', async () => {
        // Some writers name these parts differently, such as `SharedStrings.xml` with a capital.
        const type = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
        const relationship = (id, kind, target) => `<Relationship Id="${id}" Type="${type}/${kind}" Target="${target}"/>`;
        const preview = await readXlsxPreview(new File([createZip({
            'xl/workbook.xml': `<workbook xmlns:r="${type}"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>`,
            'xl/_rels/workbook.xml.rels': `<Relationships>${relationship('rId1', 'worksheet', 'worksheets/sheet1.xml')}${
                relationship('rId2', 'sharedStrings', 'SharedStrings.xml')}${relationship('rId3', 'styles', '/xl/look/Styles.xml')}${
                relationship('rId4', 'theme', 'theme/colors.xml')}</Relationships>`,
            'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s" s="1"><v>0</v></c></row></sheetData></worksheet>',
            'xl/SharedStrings.xml': '<sst><si><t>Invoice</t></si></sst>',
            'xl/look/Styles.xml': '<styleSheet><fonts><font/><font><b/><color theme="4"/></font></fonts><cellXfs><xf/><xf fontId="1"/></cellXfs></styleSheet>',
            'xl/theme/colors.xml': `<a:theme><a:clrScheme>${['000000', 'FFFFFF', '111111', 'EEEEEE', '336699'].map(color =>
                `<a:c><a:srgbClr val="${color}"/></a:c>`).join('')}</a:clrScheme></a:theme>`,
        })], 'budget.xlsx'));
        expect(preview).toBeInstanceOf(File);
        expect(drawn.text.map(({ text: value, font, color }) => [value, font, color])).toEqual([
            ['Invoice', 'bold 11px sans-serif', 'rgb(51, 102, 153)'],
        ]);
    });

    it('shows the first visible worksheet', async () => {
        const cells = await draw({
            sheets: [
                { content: sheetOf(row(1, text('A1', 'hidden'))), state: 'hidden' },
                { content: '<drawing r:id="rId1"/>', chart: true },
                { content: sheetOf(row(1, text('A1', 'shown'))) },
                { content: sheetOf(row(1, text('A1', 'later'))) },
            ],
        });
        expect(Object.keys(cells)).toEqual(['shown']);
    });

    it.each([
        ['a sheet with no cells', {}, { sheet: sheetOf('') }],
        ['a workbook whose only sheet is a chart', {}, { sheets: [{ content: '', chart: true }] }],
        ['a sheet whose cells are out of view', {}, { sheet: sheetOf(row(900, text('A900', 'far'))) }],
    ])('returns nothing for %s', async (_label, _unused, options) => {
        expect(await readXlsxPreview(xlsxFile(options))).toBeUndefined();
    });
});

describe('readXlsxPreview budgets', () => {
    it(`reads at most ${SHEET_MAX_ROWS} rows and ${SHEET_MAX_COLUMNS} columns`, async () => {
        // Rows and columns too small to fill the view, so only the limits stop the reader.
        const cells = Array.from({ length: SHEET_MAX_COLUMNS + 10 }, (_, index) => text('', `c${index}`)).join('');
        const rows = Array.from({ length: SHEET_MAX_ROWS + 10 }, (_, index) => row(index + 1, index ? text('', `r${index}`) : cells, ' ht="1"')).join('');
        const drawnCells = await draw({ sheet: sheetOf(rows, '<cols><col min="1" max="16384" width="0.1"/></cols>') });
        expect(Object.keys(drawnCells).filter(name => name.startsWith('c'))).toHaveLength(SHEET_MAX_COLUMNS);
        expect(Object.keys(drawnCells).filter(name => name.startsWith('r'))).toHaveLength(SHEET_MAX_ROWS - 1);
    });

    it('draws the start of a long cell', async () => {
        const cells = await draw({ sheet: sheetOf(row(1, text('A1', 'x'.repeat(5000)))) });
        expect(Object.keys(cells)).toEqual(['x'.repeat(SHEET_CELL_MAX_CHARACTERS)]);
    });

    it('reads each part up to the XML budget', async () => {
        const filler = `<si><t>${'a'.repeat(OFFICE_XML_MAX_BYTES)}</t></si>`;
        await draw({
            strings: ['early', filler, 'late'],
            sheet: sheetOf(row(1, cell('A1', 0, { type: 's' }) + cell('B1', 2, { type: 's' }) + cell('C1', 5))),
        });
        // A string past the budget is missing, and its cell is left empty.
        expect(texts()).toEqual(['early', '5']);
    });

    it('stops when the upload is cancelled', async () => {
        const controller = new AbortController();
        controller.abort();
        expect(await readXlsxPreview(xlsxFile(), controller.signal)).toBeUndefined();
    });

    it.each([
        ['an empty file', new Uint8Array(0)],
        ['a file that is not a ZIP archive', new TextEncoder().encode('not a spreadsheet, only named like one')],
        ['an archive without a workbook', createZip({ 'word/document.xml': '<w:document/>' })],
        ['an archive with an encrypted workbook', createXlsx({ flags: 1 })],
    ])('returns nothing for %s', async (_label, bytes) => {
        expect(await readXlsxPreview(new File([bytes], 'budget.xlsx'))).toBeUndefined();
    });

    it('returns nothing for a workbook cut off anywhere', async () => {
        const xlsx = createXlsx();
        for ( let length = 0; length < xlsx.length; length += 3 ) {
            expect(await readXlsxPreview(new File([xlsx.subarray(0, length)], 'budget.xlsx'))).toBeUndefined();
        }
    });
});
