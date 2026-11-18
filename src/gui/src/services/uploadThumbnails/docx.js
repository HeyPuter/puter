import {
    OFFICE_XML_MAX_BYTES,
    WORD_MAX_PICTURES,
    WORD_PICTURE_MAX_BYTES,
    WORD_TEXT_MAX_CHARACTERS,
} from './config.js';
import { TOKEN, attributesOf, decodeEntities, openArchive, readRelationships, readStoredThumbnail } from './ooxml.js';
import { createPage, renderPage } from './page.js';

const TWIPS_PER_POINT = 20;
const EMUS_PER_POINT = 12700;
const LIST_INDENT = 36;
const PICTURE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp' };
// Formatting a document applies when neither it nor its styles say otherwise.
const BASE_FORMAT = {
    size: 10,
    bold: false,
    italic: false,
    color: '#000',
    align: 'start',
    indent: 0,
    spaceBefore: 0,
    spaceAfter: 0,
    lineSpacing: 1,
};

// An on/off property is on when it is present, unless its value says otherwise.
const isOn = ({ 'w:val': value }) => value !== '0' && value !== 'false' && value !== 'off';

const clamped = (value, divisor, least, most) => {
    const number = Number(value) / divisor;
    return Number.isFinite(number) ? Math.min(most, Math.max(least, number)) : undefined;
};

/**
 * Record what one formatting element says, given the element that holds it. Styles and paragraphs use the same ones.
 *
 * @param {Partial<typeof BASE_FORMAT>} format
 * @param {string} name
 * @param {string} parent
 * @param {Record<string, string>} attributes
 */
const readFormat = (format, name, parent, attributes) => {
    const value = attributes['w:val'];
    const set = (key, next) => {
        if ( next !== undefined ) format[key] = next;
    };
    if ( parent === 'w:rPr' ) {
        if ( name === 'w:b' ) format.bold = isOn(attributes);
        else if ( name === 'w:i' ) format.italic = isOn(attributes);
        // Sizes are in half-points.
        else if ( name === 'w:sz' ) set('size', clamped(value, 2, 1, 400));
        else if ( name === 'w:color' ) format.color = /^[0-9a-f]{6}$/i.test(value) ? `#${value}` : BASE_FORMAT.color;
    } else if ( parent === 'w:pPr' ) {
        if ( name === 'w:jc' ) {
            format.align = value === 'center' ? 'center' : value === 'right' || value === 'end' ? 'end' : 'start';
        } else if ( name === 'w:ind' ) {
            set('indent', clamped(attributes['w:left'] ?? attributes['w:start'], TWIPS_PER_POINT, 0, 400));
        } else if ( name === 'w:spacing' ) {
            set('spaceBefore', clamped(attributes['w:before'], TWIPS_PER_POINT, 0, 400));
            set('spaceAfter', clamped(attributes['w:after'], TWIPS_PER_POINT, 0, 400));
            // In the default rule, `line` counts 240ths of a line.
            if ( (attributes['w:lineRule'] ?? 'auto') === 'auto' ) {
                set('lineSpacing', clamped(attributes['w:line'], 240, 0.5, 5));
            }
        }
    }
};

/**
 * Read the document's defaults and its styles, each of which can build on another.
 *
 * @param {string} xml The styles part, or an empty string for a document without one.
 * @returns {(paragraphStyle?: string, tableStyle?: string) => typeof BASE_FORMAT} The formatting of a paragraph.
 */
const readStyles = (xml) => {
    const defaults = { ...BASE_FORMAT };
    const styles = new Map();
    const path = [];
    let style;
    let defaultStyle;
    for ( const [, closing, name, source, empty] of xml.matchAll(TOKEN) ) {
        if ( ! name ) continue;
        if ( closing ) {
            path.pop();
            if ( name === 'w:style' ) style = undefined;
            continue;
        }
        const holder = path.at(-2);
        if ( name === 'w:style' ) {
            const attributes = attributesOf(source);
            style = { format: {} };
            styles.set(attributes['w:styleId'], style);
            if ( attributes['w:type'] === 'paragraph' && ['1', 'true', 'on'].includes(attributes['w:default']) ) {
                defaultStyle = attributes['w:styleId'];
            }
        } else if ( style && name === 'w:basedOn' ) {
            style.basedOn = attributesOf(source)['w:val'];
        } else if ( style && holder === 'w:style' ) {
            readFormat(style.format, name, path.at(-1), attributesOf(source));
        } else if ( holder === 'w:rPrDefault' || holder === 'w:pPrDefault' ) {
            readFormat(defaults, name, path.at(-1), attributesOf(source));
        }
        if ( ! empty ) path.push(name);
    }
    const formatOf = (id, depth = 0) => {
        const found = depth < 16 && styles.get(id);
        return found ? { ...formatOf(found.basedOn, depth + 1), ...found.format } : {};
    };
    // A table's style sits between the document's defaults and the paragraph's own style.
    return (paragraphStyle, tableStyle) => ({
        ...defaults,
        ...formatOf(tableStyle),
        ...formatOf(paragraphStyle ?? defaultStyle),
    });
};

/**
 * Collect the first page of the document's main part: its paragraphs, table rows and pictures, in reading order.
 *
 * @param {string} xml
 * @param {ReturnType<typeof readStyles>} formatOf
 * @returns {{
 *     page: import('./page.js').Page,
 *     pictures: Array<{ block: import('./page.js').PagePicture, id: string }>,
 * }}
 */
const readBody = (xml, formatOf) => {
    const page = createPage();
    const pictures = [];
    const path = [];
    // Where a finished block goes: the body, or the innermost open table cell.
    const containers = [page.blocks];
    const rows = [];
    const tableStyles = [];
    // A text box puts paragraphs inside a paragraph.
    const paragraphs = [];
    let run;
    let drawing;
    let skipped;
    let skipDepth = 0;
    let characters = 0;
    let hasContent = false;
    let ended = false;

    const formatOfParagraph = paragraph => paragraph.format ??= {
        ...formatOf(paragraph.style, tableStyles.at(-1)),
        ...paragraph.own,
    };
    const closeRun = () => {
        if ( run?.text ) {
            const { size, bold, italic, color } = { ...formatOfParagraph(run.paragraph), ...run.format };
            run.paragraph.runs.push({ text: run.text, size, bold, italic, color });
        }
        run = undefined;
    };
    const closeParagraph = () => {
        const paragraph = paragraphs.pop();
        if ( ! paragraph ) return;
        const { size, align, indent, spaceBefore, spaceAfter, lineSpacing } = formatOfParagraph(paragraph);
        containers.at(-1).push({
            runs: paragraph.runs,
            size,
            align,
            // A list item whose indent comes from the list's own definition gets a standard one.
            indent: indent || (paragraph.level === undefined ? 0 : LIST_INDENT * (paragraph.level + 1)),
            spaceBefore,
            spaceAfter,
            lineSpacing,
        });
    };
    const closeRow = () => {
        const row = rows.pop();
        if ( row ) row.container.push({ cells: row.cells });
    };
    // A break before any content doesn't end the page.
    const endPage = () => {
        ended = hasContent;
    };

    for ( const [, closing, name, source, empty, text] of xml.matchAll(TOKEN) ) {
        if ( ended ) break;
        if ( skipped ) {
            if ( name === skipped && !empty ) skipDepth += closing ? -1 : 1;
            if ( ! skipDepth ) skipped = undefined;
            continue;
        }
        if ( ! name ) {
            if ( run && path.at(-1) === 'w:t' ) {
                run.text += decodeEntities(text);
                hasContent = true;
                characters += text.length;
                if ( characters >= WORD_TEXT_MAX_CHARACTERS ) endPage();
            }
            continue;
        }
        if ( closing ) {
            path.pop();
            if ( name === 'w:r' ) closeRun();
            else if ( name === 'w:p' ) closeParagraph();
            else if ( name === 'w:tc' && containers.length > 1 ) containers.pop();
            else if ( name === 'w:tr' ) closeRow();
            else if ( name === 'w:tbl' ) tableStyles.pop();
            else if ( name === 'w:drawing' && drawing ) {
                if ( drawing.id && drawing.width && drawing.height ) {
                    const paragraph = paragraphs.at(-1);
                    const block = {
                        width: drawing.width,
                        height: drawing.height,
                        align: paragraph ? formatOfParagraph(paragraph).align : BASE_FORMAT.align,
                    };
                    containers.at(-1).push(block);
                    pictures.push({ block, id: drawing.id });
                    hasContent = true;
                }
                drawing = undefined;
            }
            continue;
        }
        // The earlier of two versions of some content: a fallback for older readers, moved-away text, old formatting.
        if ( !empty && (name === 'mc:Fallback' || name === 'w:moveFrom' || name.endsWith('Change')) ) {
            skipped = name;
            skipDepth = 1;
            continue;
        }

        const parent = path.at(-1);
        const holder = path.at(-2);
        if ( ! empty ) path.push(name);
        const paragraph = paragraphs.at(-1);
        if ( name === 'w:p' ) {
            paragraphs.push({ own: {}, runs: [] });
            if ( empty ) closeParagraph();
        } else if ( name === 'w:r' ) {
            // A run inside a text box starts before the run that holds the text box ends.
            closeRun();
            if ( paragraph ) run = { text: '', format: {}, paragraph };
        } else if ( name === 'w:drawing' ) {
            drawing = {};
        } else if ( parent === 'w:r' && run ) {
            if ( name === 'w:tab' ) run.text += '\t';
            else if ( name === 'w:cr' ) run.text += '\n';
            else if ( name === 'w:noBreakHyphen' ) run.text += '-';
            else if ( name === 'w:lastRenderedPageBreak' ) endPage();
            else if ( name === 'w:br' ) {
                const type = attributesOf(source)['w:type'];
                if ( type === 'page' ) endPage();
                else if ( type !== 'column' ) run.text += '\n';
            }
        } else if ( parent === 'w:rPr' && holder === 'w:r' && run ) {
            readFormat(run.format, name, parent, attributesOf(source));
        } else if ( parent === 'w:pPr' && holder === 'w:p' && paragraph ) {
            const attributes = attributesOf(source);
            if ( name === 'w:pStyle' ) paragraph.style = attributes['w:val'];
            else if ( name === 'w:numPr' ) paragraph.level ??= 0;
            else if ( name === 'w:pageBreakBefore' && isOn(attributes) ) endPage();
            else readFormat(paragraph.own, name, parent, attributes);
        } else if ( name === 'w:ilvl' && parent === 'w:numPr' && paragraph ) {
            paragraph.level = clamped(attributesOf(source)['w:val'], 1, 0, 8) ?? 0;
        } else if ( name === 'w:tbl' ) {
            tableStyles.push(undefined);
        } else if ( name === 'w:tblStyle' && parent === 'w:tblPr' && tableStyles.length ) {
            tableStyles[tableStyles.length - 1] = attributesOf(source)['w:val'];
        } else if ( name === 'w:tr' && !empty ) {
            rows.push({ cells: [], container: containers.at(-1) });
        } else if ( name === 'w:tc' && !empty && rows.length ) {
            const cell = { width: 0, blocks: [] };
            rows.at(-1).cells.push(cell);
            containers.push(cell.blocks);
        } else if ( name === 'w:tcW' && parent === 'w:tcPr' && rows.at(-1)?.cells.length ) {
            const attributes = attributesOf(source);
            if ( (attributes['w:type'] ?? 'dxa') === 'dxa' ) {
                rows.at(-1).cells.at(-1).width = clamped(attributes['w:w'], TWIPS_PER_POINT, 0, 4000) ?? 0;
            }
        } else if ( name === 'wp:extent' && drawing && !drawing.width ) {
            const attributes = attributesOf(source);
            drawing.width = clamped(attributes.cx, EMUS_PER_POINT, 0, 4000);
            drawing.height = clamped(attributes.cy, EMUS_PER_POINT, 0, 4000);
        } else if ( name === 'a:blip' && drawing ) {
            drawing.id ??= attributesOf(source)['r:embed'];
        }
    }
    // The page can end, or the XML run out, inside a paragraph or a table.
    closeRun();
    while ( paragraphs.length ) closeParagraph();
    while ( rows.length ) closeRow();

    // The first section's properties give the first page its size. They can come long after the page's content.
    const section = xml.match(/<w:sectPr[\s>][^]*?(?:<\/w:sectPr>|<w:sectPrChange|$)/)?.[0] ?? '';
    const size = attributesOf(section.match(/<w:pgSz\s[^>]*>/)?.[0] ?? '');
    const margins = attributesOf(section.match(/<w:pgMar\s[^>]*>/)?.[0] ?? '');
    for ( const [side, attribute] of [['width', 'w:w'], ['height', 'w:h']] ) {
        const length = Number(size[attribute]) / TWIPS_PER_POINT;
        if ( length >= 72 && length <= 4000 ) page[side] = length;
    }
    for ( const side of ['top', 'right', 'bottom', 'left'] ) {
        const across = side === 'top' || side === 'bottom' ? page.height : page.width;
        // A negative margin is a fixed one of the same size.
        const margin = clamped(margins[`w:${side}`]?.replace('-', ''), TWIPS_PER_POINT, 0, across / 3);
        page.margins[side] = margin ?? Math.min(page.margins[side], across / 3);
    }
    return { page, pictures };
};

/**
 * Get a small image of a DOCX's first page: the thumbnail its editor stored in it, or else a drawing of the page's
 * text, tables and pictures in the document's own sizes, spacing and alignment.
 *
 * @param {File} file
 * @param {AbortSignal} [signal]
 * @returns {Promise<File | undefined>} An image file browsers can decode, or `undefined` when there is no page to show.
 */
export const readDocxPreview = async (file, signal) => {
    const archive = await openArchive(file);
    if ( ! archive ) return undefined;
    const { entries, contentOf } = archive;

    const thumbnail = await readStoredThumbnail(archive);
    if ( thumbnail ) return thumbnail;

    const textOf = async name => (await contentOf(entries.get(name), OFFICE_XML_MAX_BYTES))?.text();
    const main = [...entries.keys()].find(name => /^word\/document\d*\.xml$/.test(name));
    const body = main && await textOf(main);
    if ( !body || signal?.aborted ) return undefined;
    const { page, pictures } = readBody(body, readStyles(await textOf('word/styles.xml') ?? ''));

    const bitmaps = [];
    try {
        // The main part's relationships map each picture's id to the entry that holds it.
        const relationships = readRelationships(
            pictures.length ? await textOf(main.replace('word/', 'word/_rels/') + '.rels') : '',
            'word',
        );
        for ( const { block, id } of pictures.slice(0, WORD_MAX_PICTURES) ) {
            if ( signal?.aborted ) return undefined;
            const target = relationships.get(id)?.target ?? '';
            const entry = entries.get(target);
            const type = PICTURE_TYPES[target.split('.').pop().toLowerCase()];
            if ( !type || !entry || entry.size > WORD_PICTURE_MAX_BYTES ) continue;
            try {
                const content = await contentOf(entry, WORD_PICTURE_MAX_BYTES);
                block.image = await createImageBitmap(new Blob([content], { type }));
                bitmaps.push(block.image);
            } catch {
                // A picture that can't be decoded leaves its space empty.
            }
        }
        return await renderPage(page);
    } finally {
        for ( const bitmap of bitmaps ) bitmap.close();
    }
};
