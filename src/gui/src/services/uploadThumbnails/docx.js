import {
    OFFICE_XML_MAX_BYTES,
    WORD_MAX_PICTURES,
    WORD_TEXT_MAX_CHARACTERS,
} from './config.js';
import {
    TOKEN,
    attributesOf,
    decodeEntities,
    openArchive,
    readPicture,
    readRelationships,
    readStoredThumbnail,
} from './ooxml.js';
import { createPage, renderPage } from './page.js';

const TWIPS_PER_POINT = 20;
const EMUS_PER_POINT = 12700;
const LIST_INDENT = 36;
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
    pageBreakBefore: false,
    hidden: false,
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
        else if ( name === 'w:vanish' ) format.hidden = isOn(attributes);
        else if ( name === 'w:i' ) format.italic = isOn(attributes);
        // Sizes are in half-points.
        else if ( name === 'w:sz' ) set('size', clamped(value, 2, 1, 400));
        else if ( name === 'w:color' ) format.color = /^[0-9a-f]{6}$/i.test(value) ? `#${value}` : BASE_FORMAT.color;
    } else if ( parent === 'w:pPr' ) {
        if ( name === 'w:pageBreakBefore' ) {
            format.pageBreakBefore = isOn(attributes);
        } else if ( name === 'w:jc' ) {
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
 * Get the section properties that start at or after `from`, up to their end or to their record of an earlier version.
 * Each lookup is one pass: a pattern that could fail late would start over at every tag in unclosed markup.
 *
 * @param {string} xml
 * @param {number} from
 * @returns {string | undefined}
 */
const sectionFrom = (xml, from) => {
    const opening = /<w:sectPr[\s/>]/g;
    opening.lastIndex = from;
    const start = opening.exec(xml)?.index;
    if ( start === undefined ) return undefined;
    // Section properties with nothing in them are a single tag.
    const tagEnd = xml.indexOf('>', start);
    if ( xml[tagEnd - 1] === '/' ) return xml.slice(start, tagEnd + 1);
    const ends = ['</w:sectPr>', '<w:sectPrChange'].map(mark => xml.indexOf(mark, start)).filter(at => at >= 0);
    return xml.slice(start, Math.min(xml.length, ...ends));
};

// The attributes of the first `name` tag in a stretch of markup.
const attributesIn = (markup, name) => {
    const at = markup.search(new RegExp(`<${name}\\s`));
    const end = markup.indexOf('>', at);
    return attributesOf(at < 0 || end < 0 ? '' : markup.slice(at, end));
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
    // A text box puts runs inside a run too. The runs around the current one wait here.
    const outerRuns = [];
    let drawing;
    let skipped;
    let skipDepth = 0;
    let characters = 0;
    let hasContent = false;
    let ended = false;
    let lastSection = false;

    const formatOfParagraph = paragraph => paragraph.format ??= {
        ...formatOf(paragraph.style, tableStyles.at(-1)),
        ...paragraph.own,
    };
    const closeRun = () => {
        if ( run?.text ) {
            const { size, bold, italic, color, hidden } = { ...formatOfParagraph(run.paragraph), ...run.format };
            if ( ! hidden ) run.paragraph.runs.push({ text: run.text, size, bold, italic, color });
        }
        run = outerRuns.pop();
    };
    // A break before any content doesn't end the page.
    const endPage = () => {
        ended = hasContent;
    };
    // A paragraph can be set, by itself or by its style, to start a page. Its formatting is known once its text starts.
    const startParagraph = (paragraph) => {
        if ( paragraph.started ) return;
        paragraph.started = true;
        if ( formatOfParagraph(paragraph).pageBreakBefore ) endPage();
    };
    const closeParagraph = () => {
        const paragraph = paragraphs.pop();
        if ( ! paragraph ) return;
        startParagraph(paragraph);
        const { size, align, indent, spaceBefore, spaceAfter, lineSpacing } = formatOfParagraph(paragraph);
        containers.at(-1).push({
            runs: paragraph.runs,
            size,
            align,
            // A list item whose indent comes from the list's own definition gets a standard one.
            indent: indent || (paragraph.level === undefined || paragraph.listed === false
                ? 0
                : LIST_INDENT * (paragraph.level + 1)),
            spaceBefore,
            spaceAfter,
            lineSpacing,
        });
        // A paragraph that holds section properties is the last of its section. How the next section starts is in
        // that section's own properties: on a new page, unless they say otherwise.
        if ( paragraph.sectionEnd === undefined || lastSection ) return;
        const next = sectionFrom(xml, paragraph.sectionEnd);
        // With no section after this one, there is none after any later paragraph either.
        lastSection = next === undefined;
        if ( next !== undefined && !['continuous', 'nextColumn'].includes(attributesIn(next, 'w:type')['w:val']) ) endPage();
    };
    const closeRow = () => {
        const row = rows.pop();
        if ( row ) row.container.push({ cells: row.cells });
    };

    for ( const match of xml.matchAll(TOKEN) ) {
        const [, closing, name, source, empty, text] = match;
        if ( ended ) break;
        if ( skipped ) {
            if ( name === skipped && !empty ) skipDepth += closing ? -1 : 1;
            if ( ! skipDepth ) skipped = undefined;
            continue;
        }
        if ( ! name ) {
            if ( run && path.at(-1) === 'w:t' ) {
                // One piece of text can be as long as the whole part, so the budget cuts it too.
                const shown = decodeEntities(text).slice(0, WORD_TEXT_MAX_CHARACTERS - characters);
                run.text += shown;
                hasContent = true;
                characters += shown.length;
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
            if ( paragraph ) startParagraph(paragraph);
            outerRuns.push(run);
            run = paragraph && !ended ? { text: '', format: {}, paragraph } : undefined;
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
            else if ( name === 'w:sectPr' ) paragraph.sectionEnd = match.index + match[0].length;
            else readFormat(paragraph.own, name, parent, attributes);
        } else if ( name === 'w:ilvl' && parent === 'w:numPr' && paragraph ) {
            paragraph.level = clamped(attributesOf(source)['w:val'], 1, 0, 8) ?? 0;
        } else if ( name === 'w:numId' && parent === 'w:numPr' && paragraph ) {
            // List number zero takes a paragraph out of the list its style would put it in.
            paragraph.listed = attributesOf(source)['w:val'] !== '0';
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
    while ( run || outerRuns.length ) closeRun();
    while ( paragraphs.length ) closeParagraph();
    while ( rows.length ) closeRow();

    // The first section's properties give the first page its size. They can come long after the page's content.
    const section = sectionFrom(xml, 0) ?? '';
    const size = attributesIn(section, 'w:pgSz');
    const margins = attributesIn(section, 'w:pgMar');
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
            block.image = await readPicture(archive, relationships.get(id)?.target ?? '');
            if ( block.image ) bitmaps.push(block.image);
        }
        return await renderPage(page);
    } finally {
        for ( const bitmap of bitmaps ) bitmap.close();
    }
};
