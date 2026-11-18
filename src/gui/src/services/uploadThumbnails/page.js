import { OFFICE_PAGE_DIMENSION } from './config.js';

/**
 * @typedef {Object} PageRun
 * @property {string} text May hold tabs, and newlines for line breaks.
 * @property {number} size Font size, in points.
 * @property {boolean} bold
 * @property {boolean} italic
 * @property {string} color A CSS color.
 */

/**
 * @typedef {Object} PageParagraph
 * @property {PageRun[]} runs
 * @property {number} size Font size of a line with no text on it, in points.
 * @property {'start' | 'center' | 'end'} align
 * @property {number} indent Distance from the edge the text starts at, in points.
 * @property {number} spaceBefore In points.
 * @property {number} spaceAfter In points.
 * @property {number} lineSpacing Line height as a multiple of single spacing.
 */

/**
 * @typedef {Object} PagePicture
 * @property {ImageBitmap} [image] Absent when the picture could not be decoded; its space is left empty.
 * @property {number} width In points.
 * @property {number} height In points.
 * @property {'start' | 'center' | 'end'} align
 */

/**
 * @typedef {Object} PageRow A table row.
 * @property {Array<{ width: number, blocks: PageBlock[] }>} cells `width` is in points, or 0 to share the row evenly.
 */

/** @typedef {PageParagraph | PagePicture | PageRow} PageBlock */

/**
 * @typedef {Object} Page The first page of a document. Lengths are in points.
 * @property {number} width
 * @property {number} height
 * @property {{ top: number, right: number, bottom: number, left: number }} margins
 * @property {PageBlock[]} blocks
 */

// A line is this much taller than its font size, about what text fonts ask for.
const LINE_HEIGHT = 1.2;
const TAB_WIDTH = 36;
const CELL_PADDING = 5;
const RTL_LETTER = /[֐-ࣿיִ-ﻼ]/;

/** @returns {Page} An empty US Letter page with one-inch margins, for a document that doesn't state its own. */
export const createPage = () => ({
    width: 612,
    height: 792,
    margins: { top: 72, right: 72, bottom: 72, left: 72 },
    blocks: [],
});

/**
 * Draw a page's blocks top to bottom, wrapping text to the page, until the page is full.
 *
 * @param {Page} page
 * @returns {Promise<File | undefined>} A PNG at most `OFFICE_PAGE_DIMENSION` pixels a side, or `undefined` for a blank page.
 */
export const renderPage = async (page) => {
    const scale = OFFICE_PAGE_DIMENSION / Math.max(page.width, page.height);
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(page.width * scale)),
                    Math.max(1, Math.round(page.height * scale)));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // Drawing in points keeps font sizes as the document states them.
    ctx.scale(scale, scale);
    const bottom = page.height - page.margins.bottom;
    ctx.rect(0, 0, page.width, bottom);
    ctx.clip();
    ctx.textAlign = 'left';
    let drawn = false;

    const drawParagraph = (paragraph, left, width, top) => {
        // A paragraph runs right to left when its first letter does.
        const firstLetter = paragraph.runs.map(run => run.text).join('').match(/\p{L}/u)?.[0] ?? '';
        const rtl = RTL_LETTER.test(firstLetter);
        const indent = Math.min(paragraph.indent, width / 2);
        const available = width - indent;
        let y = top + paragraph.spaceBefore;
        let line = [];
        let lineWidth = 0;
        const endLine = () => {
            const size = line.reduce((largest, word) => Math.max(largest, word.size), 0) || paragraph.size;
            const height = size * LINE_HEIGHT * paragraph.lineSpacing;
            const baseline = y + height - size * 0.25;
            // Spaces at the end of a line take no part in aligning it.
            while ( line.length && !line.at(-1).text.trim() ) lineWidth -= line.pop().width;
            const free = Math.max(0, available - lineWidth);
            let x = indent + (paragraph.align === 'center' ? free / 2 : paragraph.align === 'end' ? free : 0);
            for ( const word of line ) {
                if ( baseline <= bottom && word.text.trim() ) {
                    ctx.font = word.font;
                    ctx.fillStyle = word.color;
                    ctx.fillText(word.text, rtl ? left + width - x - word.width : left + x, baseline);
                    drawn = true;
                }
                x += word.width;
            }
            y += height;
            line = [];
            lineWidth = 0;
        };

        for ( const run of paragraph.runs ) {
            const font = `${run.italic ? 'italic ' : ''}${run.bold ? 'bold ' : ''}${run.size}px sans-serif`;
            ctx.font = font;
            for ( const part of run.text.match(/\n|\t|[^\S\n\t]+|\S+/g) ?? [] ) {
                if ( y >= bottom ) return y;
                if ( part === '\n' ) {
                    endLine();
                    continue;
                }
                const partWidth = part === '\t' ? TAB_WIDTH - lineWidth % TAB_WIDTH : ctx.measureText(part).width;
                // A word wider than the line, as in text written without spaces, breaks between characters.
                const words = part.trim() && partWidth > available
                    ? [...part].map(text => ({ text, width: ctx.measureText(text).width }))
                    : [{ text: part, width: partWidth }];
                for ( const { text, width: wordWidth } of words ) {
                    if ( line.length && text.trim() && lineWidth + wordWidth > available ) endLine();
                    line.push({ text, width: wordWidth, font, color: run.color, size: run.size });
                    lineWidth += wordWidth;
                }
            }
        }
        // A paragraph with no text still takes a line.
        endLine();
        return y + paragraph.spaceAfter;
    };

    const drawPicture = (picture, left, width, top) => {
        const fit = Math.min(1, width / picture.width);
        const free = width - picture.width * fit;
        const x = left + (picture.align === 'center' ? free / 2 : picture.align === 'end' ? free : 0);
        if ( picture.image ) {
            ctx.drawImage(picture.image, x, top, picture.width * fit, picture.height * fit);
            drawn = true;
        }
        return top + picture.height * fit;
    };

    const drawRow = (row, left, width, top) => {
        const stated = row.cells.reduce((total, cell) => total + cell.width, 0);
        const even = row.cells.some(cell => !cell.width);
        const fit = Math.min(1, width / stated);
        let x = left;
        let rowBottom = top;
        for ( const cell of row.cells ) {
            const cellWidth = even ? width / row.cells.length : cell.width * fit;
            const inner = Math.max(1, cellWidth - 2 * CELL_PADDING);
            rowBottom = Math.max(rowBottom, drawBlocks(cell.blocks, x + CELL_PADDING, inner, top));
            x += cellWidth;
        }
        return rowBottom;
    };

    const drawBlocks = (blocks, left, width, top) => {
        let y = top;
        for ( const block of blocks ) {
            if ( y >= bottom ) break;
            const draw = block.cells ? drawRow : block.runs ? drawParagraph : drawPicture;
            y = draw(block, left, width, y);
        }
        return y;
    };

    drawBlocks(page.blocks, page.margins.left, page.width - page.margins.left - page.margins.right, page.margins.top);
    // A page with nothing on it keeps the file icon.
    if ( ! drawn ) return undefined;
    return new File([await canvas.convertToBlob({ type: 'image/png' })], 'preview.png', { type: 'image/png' });
};
