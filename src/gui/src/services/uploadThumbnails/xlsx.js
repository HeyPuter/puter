import {
    OFFICE_PAGE_DIMENSION,
    OFFICE_XML_MAX_BYTES,
    SHEET_CELL_MAX_CHARACTERS,
    SHEET_MAX_COLUMNS,
    SHEET_MAX_ROWS,
    SHEET_VIEW_POINTS,
} from './config.js';
import { TOKEN, attributesOf, decodeEntities, openArchive, readRelationships, readStoredThumbnail } from './ooxml.js';

const DEFAULT_ROW_HEIGHT = 15;
const DEFAULT_COLUMN_CHARACTERS = 8.43;
const DEFAULT_FONT = { size: 11, bold: false, color: '#000' };
const CELL_PADDING = 2;
const GRID_COLOR = '#d4d4d4';

/**
 * @typedef {Object} SheetCell
 * @property {string} text
 * @property {number} size Font size, in points.
 * @property {boolean} bold
 * @property {string} color A CSS color.
 * @property {string} [fill] A CSS color for the cell's background.
 * @property {'left' | 'center' | 'right'} align
 */

/**
 * @typedef {Object} Sheet The top-left of a worksheet. Lengths are in points.
 * @property {boolean} gridlines
 * @property {number} rowHeight Height of a row that states none.
 * @property {number} columnWidth Width of a column that states none.
 * @property {number[]} widths Stated column widths, by column. May have holes.
 * @property {Array<{ height?: number, cells: SheetCell[] }>} rows By row, each with its cells by column. May have holes.
 */

// An element's name without its namespace prefix. Most writers use none here, but some put every element under one.
const localName = name => name?.slice(name.indexOf(':') + 1);

// A column's width counts characters of the default font, about 7 pixels each, plus 5 pixels of padding.
const columnPoints = characters => (characters * 7 + 5) * 0.75;

const within = (value, least, most) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(most, Math.max(least, number)) : undefined;
};

// The zero-based column of a reference such as `AB12`.
const columnOf = (reference) => {
    let column = 0;
    for ( const letter of reference ) {
        const digit = letter.charCodeAt(0) - 64;
        if ( digit < 1 || digit > 26 ) break;
        column = column * 26 + digit;
    }
    return column - 1;
};

// A color as a style states it: ARGB, or one of the theme's colors, lightened or darkened by a tint.
const colorOf = ({ rgb, theme, tint }, themeColors) => {
    const hex = /^(?:[0-9a-f]{2})?[0-9a-f]{6}$/i.test(rgb) ? rgb.slice(-6) : themeColors[theme];
    if ( ! hex ) return undefined;
    const amount = within(tint, -1, 1) ?? 0;
    const channels = [0, 2, 4].map((at) => {
        const value = parseInt(hex.slice(at, at + 2), 16);
        return Math.round(amount < 0 ? value * (1 + amount) : value + (255 - value) * amount);
    });
    return `rgb(${channels.join(', ')})`;
};

/**
 * @param {string} xml The theme part, or an empty string.
 * @returns {string[]} The theme's colors as six hex digits, in the order styles number them.
 */
const readThemeColors = (xml) => {
    const colors = [];
    let inScheme = false;
    for ( const [, closing, tag, source] of xml.matchAll(TOKEN) ) {
        const name = localName(tag);
        if ( name === 'clrScheme' ) {
            if ( closing ) break;
            inScheme = true;
        } else if ( inScheme && !closing && (name === 'srgbClr' || name === 'sysClr') ) {
            const { val, lastClr } = attributesOf(source);
            const hex = name === 'srgbClr' ? val : lastClr;
            colors.push(/^[0-9a-f]{6}$/i.test(hex) ? hex : undefined);
        }
    }
    // The theme lists dark before light; styles number light first.
    [colors[0], colors[1], colors[2], colors[3]] = [colors[1], colors[0], colors[3], colors[2]];
    return colors;
};

/**
 * Read the fonts, fills and cell formats a cell's style number selects from.
 *
 * @param {string} xml The styles part, or an empty string.
 * @param {string[]} themeColors
 * @returns {(style: number) => Omit<SheetCell, 'text' | 'align'> & { align?: string }}
 */
const readStyles = (xml, themeColors) => {
    const fonts = [];
    const fills = [];
    const formats = [];
    const path = [];
    let solid = false;
    for ( const [, closing, tag, source, empty] of xml.matchAll(TOKEN) ) {
        const name = localName(tag);
        if ( ! name ) continue;
        if ( closing ) {
            path.pop();
            continue;
        }
        const parent = path.at(-1);
        const holder = path.at(-2);
        const list = path.at(-3);
        if ( ! empty ) path.push(name);
        // Each list is checked by name, because conditional formats hold fonts and fills of their own.
        if ( name === 'font' && parent === 'fonts' ) {
            fonts.push({ ...DEFAULT_FONT });
        } else if ( parent === 'font' && holder === 'fonts' ) {
            const attributes = attributesOf(source);
            const font = fonts.at(-1);
            if ( name === 'b' ) font.bold = attributes.val !== '0' && attributes.val !== 'false';
            else if ( name === 'sz' ) font.size = within(attributes.val, 1, 400) ?? font.size;
            else if ( name === 'color' ) font.color = colorOf(attributes, themeColors) ?? font.color;
        } else if ( name === 'fill' && parent === 'fills' ) {
            fills.push(undefined);
        } else if ( name === 'patternFill' && parent === 'fill' && holder === 'fills' ) {
            solid = attributesOf(source).patternType === 'solid';
        } else if ( name === 'fgColor' && parent === 'patternFill' && list === 'fills' && solid ) {
            fills[fills.length - 1] = colorOf(attributesOf(source), themeColors);
        } else if ( name === 'xf' && parent === 'cellXfs' ) {
            const { fontId, fillId } = attributesOf(source);
            formats.push({ font: Number(fontId) || 0, fill: Number(fillId) || 0 });
        } else if ( name === 'alignment' && parent === 'xf' && holder === 'cellXfs' ) {
            formats.at(-1).align = attributesOf(source).horizontal;
        }
    }
    return (style) => {
        const format = formats[style];
        return { ...(fonts[format?.font] ?? fonts[0] ?? DEFAULT_FONT), fill: fills[format?.fill], align: format?.align };
    };
};

/**
 * @param {string} xml The shared strings part, or an empty string.
 * @returns {string[]} The text cells refer to by position.
 */
const readStrings = (xml) => {
    const strings = [];
    const path = [];
    let current;
    for ( const [, closing, tag, , empty, text] of xml.matchAll(TOKEN) ) {
        const name = localName(tag);
        if ( ! name ) {
            // A string can come in several runs; its phonetic guide is not part of it.
            if ( current !== undefined && path.at(-1) === 't' && path.at(-2) !== 'rPh' ) current += decodeEntities(text);
            continue;
        }
        if ( closing ) path.pop();
        else if ( ! empty ) path.push(name);
        if ( name !== 'si' ) continue;
        if ( ! closing ) current = '';
        if ( closing || empty ) {
            strings.push(current ?? '');
            current = undefined;
        }
    }
    return strings;
};

/**
 * Read the rows and columns at the top-left of a worksheet.
 *
 * @param {string} xml
 * @param {string[]} strings
 * @param {ReturnType<typeof readStyles>} styleOf
 * @returns {Sheet}
 */
const readSheet = (xml, strings, styleOf) => {
    const sheet = {
        gridlines: true,
        rowHeight: DEFAULT_ROW_HEIGHT,
        columnWidth: columnPoints(DEFAULT_COLUMN_CHARACTERS),
        widths: [],
        rows: [],
    };
    const path = [];
    let row;
    let cell;
    let rowIndex = -1;
    let columnIndex = -1;
    const closeCell = () => {
        const { type } = cell;
        const value = decodeEntities(cell.value);
        const number = Number(value);
        const numeric = !type || type === 'n';
        let text = value;
        if ( type === 's' ) text = strings[number] ?? '';
        else if ( type === 'b' ) text = value === '1' ? 'TRUE' : 'FALSE';
        // A number is shown to the 15 digits a spreadsheet keeps, which drops the noise of its binary form. Its number
        // format is not applied.
        else if ( numeric && value && Number.isFinite(number) ) text = String(Number(number.toPrecision(15)));
        const style = styleOf(cell.style);
        const align = ['left', 'center', 'right'].includes(style.align)
            ? style.align
            : numeric ? 'right' : type === 'b' || type === 'e' ? 'center' : 'left';
        if ( text || style.fill ) {
            row.cells[cell.column] = { ...style, text: text.slice(0, SHEET_CELL_MAX_CHARACTERS), align };
        }
        cell = undefined;
    };

    for ( const [, closing, tag, source, empty, text] of xml.matchAll(TOKEN) ) {
        const name = localName(tag);
        if ( ! name ) {
            const inside = path.at(-1);
            // `v` holds a cell's value, `t` the text of a string stored in the cell itself.
            if ( cell && (inside === 'v' || (inside === 't' && path.at(-2) !== 'rPh')) ) cell.value += text;
            continue;
        }
        if ( closing ) {
            path.pop();
            if ( name === 'c' && cell ) closeCell();
            else if ( name === 'sheetData' ) break;
            continue;
        }
        if ( ! empty ) path.push(name);
        if ( name === 'sheetView' ) {
            const { showGridLines } = attributesOf(source);
            if ( showGridLines === '0' || showGridLines === 'false' ) sheet.gridlines = false;
        } else if ( name === 'sheetFormatPr' ) {
            const attributes = attributesOf(source);
            sheet.rowHeight = within(attributes.defaultRowHeight, 1, 409) ?? sheet.rowHeight;
            const characters = within(attributes.defaultColWidth, 1, 255);
            if ( characters ) sheet.columnWidth = columnPoints(characters);
        } else if ( name === 'col' ) {
            const { min, max, width, hidden } = attributesOf(source);
            const characters = within(width, 0, 255);
            // A definition can give its columns a style and leave their width alone.
            const points = hidden === '1' || hidden === 'true' ? 0 : characters === undefined ? undefined : columnPoints(characters);
            const last = Math.min(Number(max) || 0, SHEET_MAX_COLUMNS);
            for ( let column = Math.max(1, Number(min) || 1); column <= last; column++ ) sheet.widths[column - 1] = points;
        } else if ( name === 'row' ) {
            const { r, ht, hidden } = attributesOf(source);
            rowIndex = r === undefined ? rowIndex + 1 : Number(r) - 1;
            // Rows come in order, so the first one past the limit ends the part worth reading.
            if ( !(rowIndex >= 0 && rowIndex < SHEET_MAX_ROWS) ) break;
            columnIndex = -1;
            row = sheet.rows[rowIndex] = {
                height: hidden === '1' || hidden === 'true' ? 0 : within(ht, 0, 409),
                cells: [],
            };
        } else if ( name === 'c' && row ) {
            const { r, t, s } = attributesOf(source);
            columnIndex = r === undefined ? columnIndex + 1 : columnOf(r);
            if ( columnIndex >= 0 && columnIndex < SHEET_MAX_COLUMNS ) {
                cell = { column: columnIndex, type: t, style: Number(s) || 0, value: '' };
                if ( empty ) closeCell();
            }
        }
    }
    return sheet;
};

/**
 * Draw a sheet's gridlines, cell fills and cell text, as far as the view reaches.
 *
 * @param {Sheet} sheet
 * @returns {Promise<File | undefined>} A square PNG `OFFICE_PAGE_DIMENSION` pixels a side, or `undefined` for a sheet
 *     with nothing in view.
 */
const drawSheet = async (sheet) => {
    const canvas = new OffscreenCanvas(OFFICE_PAGE_DIMENSION, OFFICE_PAGE_DIMENSION);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const scale = OFFICE_PAGE_DIMENSION / SHEET_VIEW_POINTS;
    ctx.scale(scale, scale);
    ctx.textAlign = 'left';

    // Where each column, or each row, starts, up to the first one that starts past the view.
    const edgesOf = (sizeOf, most) => {
        const edges = [0];
        while ( edges.at(-1) < SHEET_VIEW_POINTS && edges.length <= most ) edges.push(edges.at(-1) + sizeOf(edges.length - 1));
        return edges;
    };
    const xs = edgesOf(column => sheet.widths[column] ?? sheet.columnWidth, SHEET_MAX_COLUMNS);
    const ys = edgesOf(row => sheet.rows[row]?.height ?? sheet.rowHeight, SHEET_MAX_ROWS);
    if ( sheet.gridlines ) {
        ctx.strokeStyle = GRID_COLOR;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for ( const x of xs ) {
            ctx.moveTo(x, 0);
            ctx.lineTo(x, ys.at(-1));
        }
        for ( const y of ys ) {
            ctx.moveTo(0, y);
            ctx.lineTo(xs.at(-1), y);
        }
        ctx.stroke();
    }

    // Fills go over the gridlines and under all text, which can run on from one cell into the next.
    let drawn = false;
    const eachCell = (draw) => {
        for ( let row = 0; row < ys.length - 1; row++ ) {
            const cells = sheet.rows[row]?.cells ?? [];
            for ( let column = 0; column < xs.length - 1; column++ ) {
                const width = xs[column + 1] - xs[column];
                const height = ys[row + 1] - ys[row];
                if ( cells[column] && width && height ) draw(cells[column], cells, column, row, width, height);
            }
        }
    };
    eachCell((cell, _cells, column, row, width, height) => {
        if ( ! cell.fill ) return;
        ctx.fillStyle = cell.fill;
        ctx.fillRect(xs[column], ys[row], width, height);
        drawn = true;
    });
    eachCell((cell, cells, column, row, width, height) => {
        if ( ! cell.text ) return;
        ctx.font = `${cell.bold ? 'bold ' : ''}${cell.size}px sans-serif`;
        const textWidth = ctx.measureText(cell.text).width;
        // Text aligned left runs on over the empty cells to its right; other text is cut off at its cell.
        let end = column + 1;
        while ( cell.align === 'left' && end < xs.length - 1 && !cells[end]?.text &&
            xs[end] - xs[column] < textWidth + 2 * CELL_PADDING ) {
            end++;
        }
        const x = cell.align === 'right'
            ? xs[column + 1] - CELL_PADDING - textWidth
            : cell.align === 'center' ? xs[column] + (width - textWidth) / 2 : xs[column] + CELL_PADDING;
        ctx.save();
        ctx.beginPath();
        ctx.rect(xs[column], ys[row], xs[end] - xs[column], height);
        ctx.clip();
        ctx.fillStyle = cell.color;
        ctx.fillText(cell.text, x, ys[row + 1] - CELL_PADDING - cell.size * 0.2);
        ctx.restore();
        drawn = true;
    });
    if ( ! drawn ) return undefined;
    return new File([await canvas.convertToBlob({ type: 'image/png' })], 'preview.png', { type: 'image/png' });
};

/**
 * Get a small image of an XLSX: the thumbnail its editor stored in it, or else a drawing of the top-left of its
 * first worksheet, with the sheet's column widths, row heights, cell fills and fonts.
 *
 * @param {File} file
 * @param {AbortSignal} [signal]
 * @returns {Promise<File | undefined>} An image file browsers can decode, or `undefined` when there is nothing to show.
 */
export const readXlsxPreview = async (file, signal) => {
    const archive = await openArchive(file);
    if ( ! archive ) return undefined;
    const thumbnail = await readStoredThumbnail(archive);
    if ( thumbnail ) return thumbnail;

    const { entries, contentOf } = archive;
    const textOf = async name => (await contentOf(entries.get(name), OFFICE_XML_MAX_BYTES))?.text();
    const workbook = await textOf('xl/workbook.xml');
    if ( !workbook || signal?.aborted ) return undefined;
    // The workbook lists its sheets in tab order, and its relationships say which part holds each one.
    const relationships = readRelationships(await textOf('xl/_rels/workbook.xml.rels'), 'xl');
    let sheetName;
    for ( const [, closing, tag, source] of workbook.matchAll(TOKEN) ) {
        if ( localName(tag) !== 'sheet' || closing ) continue;
        const { state = 'visible', ...attributes } = attributesOf(source);
        // The relationship id is the one attribute in a namespace, under whatever prefix the writer gave it.
        const relationship = relationships.get(Object.entries(attributes).find(([key]) => key.endsWith(':id'))?.[1]);
        // Chart sheets have no cells.
        if ( state === 'visible' && relationship?.type.endsWith('/worksheet') ) {
            sheetName = relationship.target;
            break;
        }
    }
    const sheet = await textOf(sheetName);
    if ( !sheet || signal?.aborted ) return undefined;
    const styleOf = readStyles(await textOf('xl/styles.xml') ?? '', readThemeColors(await textOf('xl/theme/theme1.xml') ?? ''));
    const strings = readStrings(await textOf('xl/sharedStrings.xml') ?? '');
    return drawSheet(readSheet(sheet, strings, styleOf));
};
