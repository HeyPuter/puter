import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRecordingCanvas, linesOf } from '../../../tests/fixtures/canvas.js';
import { createDocx, createZip, paragraph, picture, pngHeader } from '../../../tests/fixtures/docx.js';
import {
    WORD_MAX_PICTURES,
    WORD_PICTURE_MAX_BYTES,
    WORD_PICTURE_MAX_PIXELS,
    WORD_TEXT_MAX_CHARACTERS,
    OFFICE_THUMBNAIL_MAX_BYTES,
    OFFICE_XML_MAX_BYTES,
} from './config.js';
import { readDocxPreview } from './docx.js';

const docxFile = options => new File([createDocx(options)], 'report.docx');
const bytesOf = async blob => new Uint8Array(await blob.arrayBuffer());
const run = (text, properties = '') => `<w:r><w:rPr>${properties}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
const cell = (content, width) => `<w:tc><w:tcPr>${width ? `<w:tcW w:w="${width}" w:type="dxa"/>` : ''}</w:tcPr>${content}</w:tc>`;
let drawn;
/** Draw a document's first page and return its lines of text. */
const draw = async (options) => {
    const preview = await readDocxPreview(docxFile(options));
    expect(preview).toBeInstanceOf(File);
    expect(preview.type).toBe('image/png');
    return linesOf(drawn);
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

describe('readDocxPreview with a stored thumbnail', () => {
    const jpeg = Uint8Array.from({ length: 3000 }, (_, index) => index * 7 % 256);

    it.each([[], ['docProps/thumbnail.jpeg']])('returns the thumbnail the editor stored (stored entries: %j)', async (...stored) => {
        const preview = await readDocxPreview(docxFile({ thumbnail: jpeg, stored }));
        expect(preview).toBeInstanceOf(File);
        expect(preview.type).toBe('image/jpeg');
        expect(await bytesOf(preview)).toEqual(jpeg);
        expect(drawn.text).toEqual([]);
    });

    it('draws the page instead of using a thumbnail over the size limit', async () => {
        const preview = await readDocxPreview(docxFile({ thumbnail: new Uint8Array(OFFICE_THUMBNAIL_MAX_BYTES + 1) }));
        expect(preview.type).toBe('image/png');
        expect(linesOf(drawn).map(line => line.text)).toEqual(['Hello']);
    });
});

describe('readDocxPreview drawing the first page', () => {
    it('draws paragraphs top to bottom inside the page margins', async () => {
        const lines = await draw({ body: paragraph('First') + paragraph('Second') + paragraph('Third') });
        expect(lines.map(line => line.text)).toEqual(['First', 'Second', 'Third']);
        expect(lines.every(line => line.x === 72 && line.y > 72)).toBe(true);
        // US Letter, with the longer side at the page dimension.
        expect(drawn).toMatchObject({ width: 198, height: 256 });
    });

    it('uses the page size and margins of the first section, wherever it comes', async () => {
        const lines = await draw({
            // The first section ends in the second paragraph; the last one's properties close the body.
            body: paragraph('Wide') + paragraph('Next', '<w:sectPr><w:pgSz w:w="20000" w:h="10000" w:orient="landscape"/>' +
                '<w:pgMar w:top="400" w:right="600" w:bottom="-800" w:left="1000"/></w:sectPr>'),
        });
        expect(drawn).toMatchObject({ width: 256, height: 128 });
        expect(lines[0].x).toBe(50);
        expect(lines[0].y).toBeLessThan(40);
    });

    it('keeps the default page for a document that states no usable size', async () => {
        await draw({ section: '<w:pgSz w:w="none" w:h="0"/>' });
        expect(drawn).toMatchObject({ width: 198, height: 256 });
        await draw({ section: '' });
        expect(drawn).toMatchObject({ width: 198, height: 256 });
    });

    it('applies the document defaults, then styles and the styles they build on, then direct formatting', async () => {
        const lines = await draw({
            styles: '<w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="22"/></w:rPr></w:rPrDefault>' +
                '<w:pPrDefault><w:pPr><w:spacing w:after="200" w:line="480" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
                '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:rPr><w:color w:val="333333"/></w:rPr></w:style>' +
                '<w:style w:type="paragraph" w:styleId="Heading"><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/></w:pPr>' +
                '<w:rPr><w:b/><w:sz w:val="40"/></w:rPr></w:style>' +
                '<w:style w:type="paragraph" w:styleId="Title"><w:basedOn w:val="Heading"/><w:rPr><w:i/><w:color w:val="auto"/></w:rPr></w:style>' +
                // Formatting for parts of a table belongs to no paragraph.
                '<w:style w:type="table" w:styleId="Grid"><w:tblStylePr w:type="firstRow"><w:rPr><w:sz w:val="96"/></w:rPr></w:tblStylePr></w:style>',
            body: paragraph('Body') + paragraph('Head', '<w:pStyle w:val="Heading"/>') + paragraph('Name', '<w:pStyle w:val="Title"/>') +
                `<w:p><w:pPr><w:jc w:val="right"/><w:rPr><w:sz w:val="144"/></w:rPr></w:pPr>${
                    run('Direct', '<w:sz w:val="16"/><w:b w:val="0"/><w:color w:val="FF0000"/>')}</w:p>`,
        });
        expect(lines.map(({ text, font, color }) => ({ text, font, color }))).toEqual([
            { text: 'Body', font: '11px sans-serif', color: '#333333' },
            { text: 'Head', font: 'bold 20px sans-serif', color: '#333333' },
            { text: 'Name', font: 'italic bold 20px sans-serif', color: '#000' },
            { text: 'Direct', font: '8px sans-serif', color: '#FF0000' },
        ]);
        // 'Head' is 40 wide, centered in the 468 between the margins; 'Direct' is 24 wide and ends at the right margin.
        expect(lines[1].x).toBe(72 + (468 - 40) / 2);
        expect(lines[3].x).toBe(540 - 24);
        // Double spacing and 10 points after each paragraph.
        expect(lines[1].y - lines[0].y).toBeCloseTo(20 * 1.2 * 2 + 10 + (11 - 20) * 0.25 + 0, 0);
    });

    it('reads a paragraph\'s default size from a document without a styles part', async () => {
        const lines = await draw({ styles: undefined });
        expect(lines[0].font).toBe('10px sans-serif');
    });

    it('indents paragraphs, and list items that state no indent of their own', async () => {
        const lines = await draw({
            body: paragraph('Indented', '<w:ind w:left="720"/>') +
                paragraph('Item', '<w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr>') +
                paragraph('Own', '<w:numPr><w:ilvl w:val="2"/><w:numId w:val="1"/></w:numPr><w:ind w:start="200"/>'),
        });
        expect(lines.map(line => line.x)).toEqual([72 + 36, 72 + 72, 72 + 10]);
    });

    it('wraps text to the page width and breaks words longer than a line', async () => {
        // At 10 points a character is 5 wide, so the 468 between the margins fits 93 characters.
        const lines = await draw({ body: paragraph(`${'word '.repeat(30)}${'x'.repeat(200)}`) });
        // 18 words fit the first line. The long word starts after the other 12 and fills each line it reaches.
        expect(lines.map(line => line.text.replaceAll(' ', '').length)).toEqual([72, 48 + 33, 93, 74]);
        expect(lines.every(line => line.x === 72)).toBe(true);
    });

    it('measures each word in its own run\'s font after a line ends in another run\'s', async () => {
        // A title and a subtitle in one paragraph, and a small note before large text.
        await draw({
            body: `<w:p>${run('Title', '<w:b/><w:sz w:val="48"/>')}<w:r><w:rPr><w:sz w:val="24"/></w:rPr><w:br/><w:t>aaa bbb ccc</w:t></w:r></w:p>` +
                `<w:p>${run('note', '<w:sz w:val="16"/>')}<w:r><w:rPr><w:sz w:val="48"/></w:rPr><w:br/><w:t>ddd eee fff</w:t></w:r></w:p>`,
        });
        const xOf = Object.fromEntries(drawn.text.map(word => [word.text, word.x]));
        // At 12 points a three-letter word and its space are 24 wide, and at 24 points they are 48.
        expect([xOf.aaa, xOf.bbb, xOf.ccc]).toEqual([72, 96, 120]);
        expect([xOf.ddd, xOf.eee, xOf.fff]).toEqual([72, 120, 168]);
    });

    it('starts a new line at a line break and moves to the next tab stop at a tab', async () => {
        const lines = await draw({ body: '<w:p><w:r><w:t>ab</w:t><w:tab/><w:t>cd</w:t><w:br/><w:t>ef</w:t><w:cr/><w:t>gh</w:t></w:r></w:p>' });
        expect(lines.map(line => line.text)).toEqual(['ab cd', 'ef', 'gh']);
        expect(drawn.text[1].x).toBe(72 + 36);
    });

    it('lays out right-to-left paragraphs from the right margin', async () => {
        const lines = await draw({ body: paragraph('سلام دنیا') + paragraph('שלום', '<w:jc w:val="center"/>') });
        // Each word is 20 wide; the first one ends at the right margin and the second sits to its left.
        expect(drawn.text.slice(0, 2).map(word => word.x)).toEqual([540 - 20, 540 - 20 - 5 - 20]);
        expect(lines[1].x).toBe(72 + (468 - 20) / 2);
    });

    it('decodes character references', async () => {
        const lines = await draw({ body: paragraph('a &amp; b &lt;c&gt; &#233;&#x4E2D; &quot;&apos; &unknown; &#x110000;') });
        expect(lines[0].text).toBe('a & b <c> é中 "\' &unknown; &#x110000;');
    });

    it.each([
        ['a page break', `<w:p>${run('Shown')}<w:r><w:br w:type="page"/></w:r>${run('Hidden')}</w:p>${paragraph('Later')}`],
        ['the place Word last broke the page', `${paragraph('Shown')}<w:p><w:r><w:lastRenderedPageBreak/><w:t>Hidden</w:t></w:r></w:p>`],
        ['a paragraph that starts a page', paragraph('Shown') + paragraph('Hidden', '<w:pageBreakBefore/>')],
        ['a paragraph whose style starts a page', paragraph('Shown') + paragraph('Hidden', '<w:pStyle w:val="Chapter"/>')],
        // A section's own properties say how it starts, and they come at its end.
        ['the end of a section, when the next one starts a page', paragraph('Shown', '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>') +
            paragraph('Hidden') + paragraph('Later', '<w:sectPr><w:type w:val="nextPage"/></w:sectPr>')],
        ['the end of a section, when the next one states no type', paragraph('Shown', '<w:sectPr/>') + paragraph('Hidden')],
    ])('stops at %s', async (_label, body) => {
        const styles = '<w:style w:type="paragraph" w:styleId="Chapter"><w:pPr><w:pageBreakBefore/></w:pPr></w:style>';
        expect((await draw({ body, styles })).map(line => line.text)).toEqual(['Shown']);
    });

    it('goes on past the end of a section when the next one continues on the same page', async () => {
        const lines = await draw({
            body: paragraph('One', '<w:sectPr><w:type w:val="nextPage"/></w:sectPr>') +
                paragraph('Two', '<w:sectPr><w:type w:val="continuous"/></w:sectPr>') + paragraph('Three'),
            section: '<w:type w:val="continuous"/><w:pgSz w:w="12240" w:h="15840"/>',
        });
        expect(lines.map(line => line.text)).toEqual(['One', 'Two', 'Three']);
    });

    it('lets a paragraph turn off the page break its style asks for', async () => {
        const lines = await draw({
            styles: '<w:style w:type="paragraph" w:styleId="Chapter"><w:pPr><w:pageBreakBefore/></w:pPr></w:style>',
            body: paragraph('One') + paragraph('Two', '<w:pStyle w:val="Chapter"/><w:pageBreakBefore w:val="0"/>'),
        });
        expect(lines.map(line => line.text)).toEqual(['One', 'Two']);
    });

    it('does not stop at a page break that comes before any content', async () => {
        const body = `<w:p><w:r><w:br w:type="page"/></w:r></w:p>${paragraph('Shown', '<w:pageBreakBefore/>')}`;
        expect((await draw({ body })).map(line => line.text)).toEqual(['Shown']);
    });

    it('stops drawing at the bottom margin', async () => {
        const lines = await draw({ body: Array.from({ length: 200 }, (_, index) => paragraph(`Line ${index}`)).join('') });
        // 648 points between the top and bottom margins hold 54 lines of 12 points.
        expect(lines).toHaveLength(54);
        expect(lines.at(-1).y).toBeLessThanOrEqual(792 - 72);
    });

    it('lays table cells side by side and continues below the tallest one', async () => {
        const lines = await draw({
            styles: '<w:docDefaults><w:pPrDefault><w:pPr><w:spacing w:after="200"/></w:pPr></w:pPrDefault></w:docDefaults>' +
                '<w:style w:type="table" w:styleId="Grid"><w:pPr><w:spacing w:after="0"/></w:pPr></w:style>',
            body: `<w:tbl><w:tblPr><w:tblStyle w:val="Grid"/></w:tblPr><w:tr>${cell(paragraph('A1') + paragraph('A2'), 2000)}${
                cell(paragraph('B1'), 4000)}</w:tr><w:tr>${cell(paragraph('C1'))}${cell(paragraph('D1'))}${cell(paragraph('E1'))}</w:tr></w:tbl>${
                paragraph('After')}`,
        });
        const byText = Object.fromEntries(drawn.text.map(word => [word.text, word]));
        expect(byText.A1.y).toBe(byText.B1.y);
        // Cells are as wide as they state, with 5 points of padding; cells that state no width share the row.
        expect([byText.A1.x, byText.B1.x]).toEqual([72 + 5, 72 + 100 + 5]);
        expect([byText.C1.x, byText.D1.x, byText.E1.x]).toEqual([72 + 5, 72 + 156 + 5, 72 + 312 + 5]);
        // The table's style removes the space after its paragraphs, so rows are a line apart.
        expect(byText.A2.y - byText.A1.y).toBe(12);
        expect(byText.C1.y - byText.A2.y).toBe(12);
        expect(lines.at(-1).text).toBe('After');
        expect(byText.After.y - byText.C1.y).toBe(12);
    });

    it('shrinks a table wider than the page to fit', async () => {
        await draw({ body: `<w:tbl><w:tr>${cell(paragraph('A'), 9360)}${cell(paragraph('B'), 9360)}</w:tr></w:tbl>` });
        expect(drawn.text.map(word => word.x)).toEqual([72 + 5, 72 + 234 + 5]);
    });

    it('draws the paragraphs of a text box, and one version of content stored twice', async () => {
        const lines = await draw({
            body: `<w:p>${run('Outer')}<w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><w:txbxContent>${
                paragraph('Boxed')}</w:txbxContent></w:drawing></mc:Choice><mc:Fallback><w:pict><w:txbxContent>${
                paragraph('Boxed')}</w:txbxContent></w:pict></mc:Fallback></mc:AlternateContent></w:r></w:p>` +
                `<w:p><w:pPr><w:pPrChange><w:pPr><w:jc w:val="right"/></w:pPr></w:pPrChange></w:pPr><w:moveFrom>${run('Moved away')}</w:moveFrom>${
                    run('Kept')}<w:r><w:instrText>PAGE</w:instrText><w:delText>Deleted</w:delText></w:r></w:p>`,
        });
        expect(lines.map(line => line.text).sort()).toEqual(['Boxed', 'Kept', 'Outer']);
        expect(lines.find(line => line.text === 'Kept').x).toBe(72);
    });

    it('returns nothing for a document with a blank first page', async () => {
        expect(await readDocxPreview(docxFile({ body: '<w:p/><w:p><w:r><w:t xml:space="preserve">   </w:t></w:r></w:p>' }))).toBeUndefined();
    });

    it('finds the main part under another name', async () => {
        expect((await draw({ main: 'word/document2.xml' })).map(line => line.text)).toEqual(['Hello']);
    });
});

describe('readDocxPreview pictures', () => {
    const png = pngHeader(200, 100);
    let bitmaps;

    beforeEach(() => {
        bitmaps = [];
        vi.stubGlobal('createImageBitmap', vi.fn(async (blob, options) => {
            if ( (await blob.arrayBuffer()).byteLength === pngHeader(1, 1).length + 1 ) throw new Error('not an image');
            const bitmap = { type: blob.type, bytes: await bytesOf(blob), options, close: vi.fn() };
            bitmaps.push(bitmap);
            return bitmap;
        }));
    });

    it('draws a picture at its size, aligned like its paragraph, with text continuing below it', async () => {
        const lines = await draw({
            body: `<w:p><w:pPr><w:jc w:val="center"/></w:pPr>${picture('rId1', 100, 50)}</w:p>${paragraph('Caption')}`,
            media: { 'image1.png': png },
            stored: ['word/media/image1.png'],
        });
        expect(drawn.images).toEqual([{ image: bitmaps[0], x: 72 + (468 - 100) / 2, y: 72, width: 100, height: 50 }]);
        expect(bitmaps[0]).toMatchObject({ type: 'image/png', bytes: png });
        expect(lines.at(-1).text).toBe('Caption');
        expect(lines.at(-1).y).toBeGreaterThan(72 + 50);
        expect(bitmaps[0].close).toHaveBeenCalledOnce();
    });

    it('scales a picture wider than the text area to fit', async () => {
        await draw({ body: `<w:p>${picture('rId1', 936, 400)}</w:p>`, media: { 'photo.JPG': png } });
        expect(drawn.images).toEqual([{ image: bitmaps[0], x: 72, y: 72, width: 468, height: 200 }]);
        expect(bitmaps[0].type).toBe('image/jpeg');
    });

    it('leaves the space of a picture it cannot show empty', async () => {
        const lines = await draw({
            body: `<w:p>${picture('rId1', 100, 50)}</w:p><w:p>${picture('rId2', 100, 60)}</w:p><w:p>${picture('rId3', 100, 70)}</w:p>` +
                `<w:p>${picture('rId9', 100, 80)}</w:p>${paragraph('After')}`,
            media: {
                'drawing.emf': png,
                'broken.png': new Uint8Array([...pngHeader(10, 10), 0]),
                'huge.png': new Uint8Array(WORD_PICTURE_MAX_BYTES + 1),
            },
        });
        expect(drawn.images).toEqual([]);
        expect(lines[0].y).toBeGreaterThan(72 + 50 + 60 + 70 + 80);
    });

    it(`draws at most ${WORD_MAX_PICTURES} pictures`, async () => {
        await draw({
            body: paragraph('Text') + `<w:p>${picture('rId1', 10, 10)}</w:p>`.repeat(WORD_MAX_PICTURES + 2),
            media: { 'image1.png': png },
        });
        expect(drawn.images).toHaveLength(WORD_MAX_PICTURES);
        expect(bitmaps.every(bitmap => bitmap.close.mock.calls.length === 1)).toBe(true);
    });

    it('reads a picture of the largest size whole, though deflate could only make it larger', async () => {
        const noise = randomBytes(WORD_PICTURE_MAX_BYTES);
        noise.set(pngHeader(64, 64));
        await draw({ body: `<w:p>${picture('rId1', 100, 50)}</w:p>`, media: { 'image1.png': noise } });
        expect(bitmaps[0].bytes).toHaveLength(WORD_PICTURE_MAX_BYTES);
        expect(bitmaps[0].bytes.subarray(-64)).toEqual(new Uint8Array(noise.subarray(-64)));
    });

    it('decodes a large picture at the size the page needs', async () => {
        await draw({
            body: `<w:p>${picture('rId1', 100, 50)}</w:p><w:p>${picture('rId2', 100, 50)}</w:p><w:p>${picture('rId3', 100, 50)}</w:p>`,
            media: { 'wide.png': pngHeader(4096, 1024), 'tall.png': pngHeader(300, 3000), 'small.png': pngHeader(256, 100) },
        });
        expect(bitmaps.map(bitmap => bitmap.options)).toEqual([
            { resizeWidth: 256, resizeHeight: 64, resizeQuality: 'medium' },
            { resizeWidth: 26, resizeHeight: 256, resizeQuality: 'medium' },
            undefined,
        ]);
    });

    it('does not decode a picture of more pixels than the limit, or of a size it cannot tell', async () => {
        const side = Math.sqrt(WORD_PICTURE_MAX_PIXELS);
        const lines = await draw({
            body: `<w:p>${picture('rId1', 100, 50)}</w:p><w:p>${picture('rId2', 100, 50)}</w:p><w:p>${picture('rId3', 100, 50)}</w:p>` +
                `<w:p>${picture('rId4', 100, 50)}</w:p>${paragraph('After')}`,
            media: {
                'most.png': pngHeader(side, side),
                'over.png': pngHeader(side + 1, side),
                'empty.png': pngHeader(0, 50),
                'unknown.png': new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28]),
            },
        });
        expect(bitmaps).toHaveLength(1);
        expect(drawn.images).toHaveLength(1);
        // Each one still takes its space on the page.
        expect(lines[0].y).toBeGreaterThan(72 + 4 * 50);
    });

    it.each([
        ['a GIF', [...Buffer.from('GIF89a'), 0x2c, 0x01, 0x64, 0x00, 0, 0, 0], 'image.gif'],
        ['a BMP stored top to bottom', (() => {
            const bmp = new Uint8Array(30);
            const view = new DataView(bmp.buffer);
            bmp.set([0x42, 0x4d]);
            view.setInt32(18, 300, true);
            view.setInt32(22, -100, true);
            return bmp;
        })(), 'image.bmp'],
        // Start of image, an application segment to step over, then the frame header that holds the size.
        ['a JPEG', [0xff, 0xd8, 0xff, 0xe0, 0, 4, 1, 2, 0xff, 0xc2, 0, 11, 8, 0, 100, 0x01, 0x2c, 3, 0, 0, 0, 0, 0], 'image.jpg'],
    ])('reads the pixel size of %s', async (_label, bytes, name) => {
        // 300 x 100 pixels: over the page dimension, so the size shows in how the picture is decoded.
        await draw({ body: `<w:p>${picture('rId1', 100, 50)}</w:p>`, media: { [name]: new Uint8Array(bytes) } });
        expect(bitmaps[0].options).toEqual({ resizeWidth: 256, resizeHeight: 85, resizeQuality: 'medium' });
    });

    it('shows a document that holds only a picture', async () => {
        await draw({ body: `<w:p>${picture('rId1', 100, 50)}</w:p>`, media: { 'image1.png': png } });
        expect(drawn.images).toHaveLength(1);
    });
});

describe('readDocxPreview budgets', () => {
    // An element with nothing to draw, to place text at a chosen distance into the part.
    const filler = bytes => `<w:bookmarkStart w:name="${'a'.repeat(bytes)}"/>`;

    it('reads the main part up to the XML budget', async () => {
        const within = await draw({ body: filler(OFFICE_XML_MAX_BYTES - 2000) + paragraph('Early') });
        expect(within.map(line => line.text)).toEqual(['Early']);
        expect(await readDocxPreview(docxFile({ body: filler(OFFICE_XML_MAX_BYTES) + paragraph('Late') }))).toBeUndefined();
    });

    it('stops inflating an entry that holds more than it states', async () => {
        const file = docxFile({ body: paragraph('Early') + filler(64 * 1024 * 1024), sizes: { 'word/document.xml': 100 } });
        const text = vi.spyOn(Blob.prototype, 'text');
        expect(await readDocxPreview(file)).toBeInstanceOf(File);
        expect(Math.max(...text.mock.contexts.map(blob => blob.size))).toBe(OFFICE_XML_MAX_BYTES);
    });

    it.each([
        ['an unclosed tag', `<${'a'.repeat(900_000)}`],
        ['a tag with a long name and no value', `<w:p><w:pPr><w:jc ${'a'.repeat(900_000)} w:val="center"/></w:pPr></w:p>`],
        ['a long unterminated character reference', paragraph(`&${'a'.repeat(900_000)}`)],
    ])('reads %s without slowing down', async (_label, markup) => {
        const started = performance.now();
        const lines = await draw({ body: paragraph('Shown') + markup });
        expect(lines[0].text).toBe('Shown');
        // A scan that looked at each character once per character would take minutes.
        expect(performance.now() - started).toBeLessThan(2000);
    });

    it('stops reading an entry whose data inflates to nothing', async () => {
        // The main part's own data comes after 8 MiB that an inflater must work through for no output.
        const file = docxFile({ padding: { 'word/document.xml': 8 * 1024 * 1024 } });
        const slice = vi.spyOn(file, 'slice');
        expect(await readDocxPreview(file)).toBeUndefined();
        const largest = Math.max(...slice.mock.calls.map(([start, end]) => end - start));
        expect(largest).toBeLessThan(OFFICE_XML_MAX_BYTES * 1.1);
    });

    it.each(['w:pgSz', 'w:pgMar'])('looks for the page setup in section properties that never end without slowing down: %s', async (name) => {
        // No tag after the section properties open is ever closed.
        const main = `<w:document><w:body>${paragraph('Shown')}<w:sectPr ${`<${name} `.repeat(40_000)}`;
        const started = performance.now();
        const preview = await readDocxPreview(new File([createZip({ 'word/document.xml': main })], 'report.docx'));
        expect(preview).toBeInstanceOf(File);
        expect(linesOf(drawn).map(line => line.text)).toEqual(['Shown']);
        expect(performance.now() - started).toBeLessThan(1000);
    });

    it('looks past each section\'s end once, however many sections there are', async () => {
        // Every paragraph ends a section that continues on the same page, and the last one has nothing after it.
        const sections = '<w:p><w:pPr><w:sectPr><w:type w:val="continuous"/></w:sectPr></w:pPr></w:p>'.repeat(4000) +
            '<w:p><w:pPr><w:sectPr/></w:pPr></w:p>'.repeat(20_000);
        const started = performance.now();
        const preview = await readDocxPreview(new File([createZip({ 'word/document.xml': `<w:document><w:body>${paragraph('Shown')}${sections}` })], 'report.docx'));
        expect(preview).toBeInstanceOf(File);
        expect(performance.now() - started).toBeLessThan(1500);
    });

    it('lays out text up to the character budget', async () => {
        // At 1 point a page holds half a million characters, so only the budget stops the text.
        const tiny = text => `<w:p><w:r><w:rPr><w:sz w:val="2"/></w:rPr><w:t>${text}</w:t></w:r></w:p>`;
        await draw({ body: tiny('x '.repeat(WORD_TEXT_MAX_CHARACTERS / 2)) + tiny('y') });
        expect(drawn.text.filter(word => word.text === 'x')).toHaveLength(WORD_TEXT_MAX_CHARACTERS / 2);
        expect(drawn.text.some(word => word.text === 'y')).toBe(false);
    });

    it('applies the character budget inside a single piece of text', async () => {
        await draw({ body: `<w:p><w:r><w:rPr><w:sz w:val="2"/></w:rPr><w:t>${'x'.repeat(900_000)}</w:t></w:r></w:p>` });
        // An unbroken word is measured whole and then a character at a time.
        expect(drawn.measured).toBeLessThanOrEqual(2 * WORD_TEXT_MAX_CHARACTERS);
        expect(drawn.text.reduce((total, word) => total + word.text.length, 0)).toBe(WORD_TEXT_MAX_CHARACTERS);
    });

    it('stops measuring a long word once the page is full', async () => {
        // At 72 points a line holds 13 characters and the page 7 lines.
        await draw({ body: `<w:p><w:r><w:rPr><w:sz w:val="144"/></w:rPr><w:t>${'x'.repeat(WORD_TEXT_MAX_CHARACTERS)}</w:t></w:r></w:p>` });
        expect(drawn.text.length).toBeLessThan(200);
        // The word is measured whole, then a character at a time for the lines that fit.
        expect(drawn.measured).toBeLessThan(WORD_TEXT_MAX_CHARACTERS + 200);
    });

    it('finds its parts in a large archive without reading the rest of it', async () => {
        const read = vi.spyOn(Blob.prototype, 'arrayBuffer');
        const lines = await draw({ media: { 'video.bin': new Uint8Array(3_000_000) }, stored: ['word/media/video.bin'], comment: 'made by a test' });
        expect(lines.map(line => line.text)).toEqual(['Hello']);
        expect(read.mock.contexts.reduce((total, blob) => total + blob.size, 0)).toBeLessThan(200_000);
    });

    it('stops when the upload is cancelled', async () => {
        const controller = new AbortController();
        controller.abort();
        expect(await readDocxPreview(docxFile(), controller.signal)).toBeUndefined();
    });
});

describe('readDocxPreview with files it cannot read', () => {
    it.each([
        ['an empty file', new Uint8Array(0)],
        ['a file that is not a ZIP archive', new TextEncoder().encode('not a document, only named like one')],
        ['an archive without a main part', createZip({ 'word/other.xml': '<w:document/>' })],
        ['an archive with an encrypted main part', createDocx({ flags: 1 })],
        ['a spreadsheet', createZip({ 'xl/workbook.xml': '<workbook/>' })],
    ])('returns nothing for %s', async (_label, bytes) => {
        expect(await readDocxPreview(new File([bytes], 'report.docx'))).toBeUndefined();
    });

    it('returns nothing for a document cut off anywhere', async () => {
        const docx = createDocx();
        for ( let length = 0; length < docx.length; length++ ) {
            expect(await readDocxPreview(new File([docx.subarray(0, length)], 'report.docx'))).toBeUndefined();
        }
    });
});
