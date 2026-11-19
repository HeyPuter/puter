import { renderPage } from './page.js';
import { createTextPage, readLeadingText } from './text.js';

const BODY_SIZE = 11;
const CODE_SIZE = 9.5;
const HEADING_SIZES = [22, 18, 15, 13, 12, 11];
const TEXT_COLOR = '#1f2328';
const QUOTE_COLOR = '#59636e';
const LINK_COLOR = '#0969da';
// A page has room for no more columns than this.
const TABLE_MAX_COLUMNS = 6;
// No page shows this much of one line, and reading a line takes time by the square of its length at worst.
const LINE_MAX_CHARACTERS = 2000;
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', nbsp: ' ', '#39': '\'' };

// What can stand in a line of text, one alternative each. A match with no group set is something not drawn: a
// picture, a badge or an HTML tag. The last alternative takes a whole word, so that an underscore inside one starts
// nothing. Every repeat is bounded, so text full of unclosed marks is still read in time by its length.
const INLINE = new RegExp([
    /`(?<code>[^`]{1,300})`/,
    /\[!\[[^\]]{0,300}\]\([^)]{0,300}\)\]\([^)]{0,300}\)/,
    /!\[[^\]]{0,300}\](?:\([^)]{0,300}\)|\[[^\]]{0,300}\])?/,
    /\[(?<link>[^\]]{1,300})\](?:\([^)]{0,300}\)|\[[^\]]{0,300}\])/,
    /<(?<address>https?:\/\/[^>\s]{1,300})>/,
    /<\/?[A-Za-z][^>]{0,300}>/,
    /(?<bothMark>\*\*\*|___)(?=\S)(?<both>.{0,300}?\S)\k<bothMark>/,
    /(?<strongMark>\*\*|__)(?=\S)(?<strong>.{0,300}?\S)\k<strongMark>/,
    /(?<emphasisMark>[*_])(?=\S)(?<emphasis>.{0,300}?\S)\k<emphasisMark>/,
    /~~(?=\S)(?<strike>.{0,300}?\S)~~/,
    /\\(?<escaped>[!-/:-@[-`{-~])/,
    /&(?<entity>amp|lt|gt|quot|nbsp|#39);/,
    /(?<word>[^\W_]\w*)/,
].map(pattern => pattern.source).join('|'), 'g');

/**
 * @typedef {Object} TextStyle What a run of text is drawn in, apart from its text.
 * @property {number} size
 * @property {boolean} bold
 * @property {boolean} italic
 * @property {string} color
 */

/**
 * Split a line of Markdown into runs, each in the style its marks give it.
 *
 * @param {string} text
 * @param {TextStyle} style The style of text with no marks.
 * @returns {import('./page.js').PageRun[]}
 */
const inlineRuns = (text, style) => {
    const runs = [];
    let at = 0;
    const add = (part, extra) => {
        if ( part ) runs.push({ ...style, ...extra, text: part });
    };
    for ( const match of text.matchAll(INLINE) ) {
        const { code, link, address, both, strong, emphasis, strike, escaped, entity, word } = match.groups;
        if ( word !== undefined ) continue;
        add(text.slice(at, match.index));
        at = match.index + match[0].length;
        if ( code !== undefined ) add(code.trim(), { family: 'monospace' });
        else if ( link !== undefined ) runs.push(...inlineRuns(link, { ...style, color: LINK_COLOR }));
        else if ( address !== undefined ) add(address, { color: LINK_COLOR });
        else if ( both !== undefined ) runs.push(...inlineRuns(both, { ...style, bold: true, italic: true }));
        else if ( strong !== undefined ) runs.push(...inlineRuns(strong, { ...style, bold: true }));
        else if ( emphasis !== undefined ) runs.push(...inlineRuns(emphasis, { ...style, italic: true }));
        else if ( strike !== undefined ) runs.push(...inlineRuns(strike, style));
        else add(escaped ?? ENTITIES[entity]);
    }
    add(text.slice(at));
    return runs;
};

/**
 * The runs of a block's text. What a picture or a tag leaves behind at the start is dropped, since space there would
 * be drawn as an indent.
 *
 * @param {string} text
 * @param {TextStyle} style
 * @returns {import('./page.js').PageRun[]}
 */
const blockRuns = (text, style) => {
    const runs = inlineRuns(text, style);
    while ( runs.length && !runs[0].text.trim() ) runs.shift();
    if ( runs.length ) runs[0].text = runs[0].text.trimStart();
    return runs;
};

/**
 * @param {import('./page.js').PageRun[]} runs
 * @param {Partial<import('./page.js').PageParagraph>} [layout]
 * @returns {import('./page.js').PageParagraph}
 */
const paragraph = (runs, layout) => ({
    runs,
    size: BODY_SIZE,
    align: 'start',
    indent: 0,
    spaceBefore: 0,
    spaceAfter: 8,
    lineSpacing: 1,
    ...layout,
});

const bodyStyle = { size: BODY_SIZE, bold: false, italic: false, color: TEXT_COLOR };
const headingStyle = level => ({ ...bodyStyle, size: HEADING_SIZES[level - 1], bold: true });
const splitRow = line => line.trim().replace(/^\||\|$/g, '').split('|').slice(0, TABLE_MAX_COLUMNS);

/**
 * Turn Markdown into the blocks of a page: headings, paragraphs, lists, quotes, code and tables. Front matter,
 * comments, pictures and HTML tags are left out, and so are rules.
 *
 * @param {string} text Markdown whose lines end in `\n`.
 * @returns {import('./page.js').PageBlock[]}
 */
export const parseMarkdown = (text) => {
    const lines = text
        .replace(/^---\n[^]*?\n(?:---|\.\.\.)[ \t]*(?:\n|$)/, '')
        .replace(/<!--[^]*?(?:-->|$)/g, '')
        .split('\n')
        .map(line => line.slice(0, LINE_MAX_CHARACTERS));
    /** @type {import('./page.js').PageBlock[]} */
    const blocks = [];
    // The lines of the paragraph, quote or list item being gathered, and how it is laid out.
    let gathered = [];
    let layout;
    let style = bodyStyle;
    let quoted = false;
    const push = (runs, blockLayout) => {
        // Text that was all pictures or tags leaves nothing to draw, and takes no line.
        if ( runs.some(run => run.text.trim()) ) blocks.push(paragraph(runs, blockLayout));
    };
    const flush = () => {
        if ( gathered.length ) push(blockRuns(gathered.join(' '), style), layout);
        gathered = [];
        layout = undefined;
        style = bodyStyle;
        quoted = false;
    };
    const heading = (level, content) => push(blockRuns(content, headingStyle(level)), {
        size: HEADING_SIZES[level - 1],
        spaceBefore: blocks.length ? 6 : 0,
        spaceAfter: 6,
    });

    for ( let at = 0; at < lines.length; at++ ) {
        const line = lines[at];
        let match;
        if ( ! line.trim() ) {
            flush();
        } else if ( (match = /^ {0,3}(`{3,}|~{3,})/.exec(line)) ) {
            flush();
            const code = [];
            while ( ++at < lines.length && !lines[at].trim().startsWith(match[1]) ) code.push(lines[at]);
            push([{ ...bodyStyle, size: CODE_SIZE, family: 'monospace', text: code.join('\n').replace(/\t/g, '    ') }], {
                size: CODE_SIZE,
                indent: 6,
                wrap: false,
            });
        } else if ( (match = /^ {0,3}(#{1,6})[ \t]+(.*)$/.exec(line)) ) {
            flush();
            heading(match[1].length, match[2].trim().replace(/[ \t]#+$/, ''));
        } else if ( gathered.length && !layout && (match = /^ {0,3}(=+|-+)[ \t]*$/.exec(line)) ) {
            // A paragraph underlined with `=` or `-` is a heading.
            const content = gathered.join(' ');
            gathered = [];
            heading(match[1][0] === '=' ? 1 : 2, content);
        } else if ( /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/.test(line) || /^ {0,3}\[[^\]]{1,300}\]:\s/.test(line) ) {
            // A rule, or the address a link refers to by name. Neither is drawn.
            flush();
        } else if ( (match = /^ {0,3}>[ \t]?(.*)$/.exec(line)) ) {
            if ( ! quoted ) flush();
            quoted = true;
            layout = { indent: 12 };
            style = { ...bodyStyle, color: QUOTE_COLOR };
            gathered.push(match[1].trim());
        } else if ( (match = /^([ \t]*)([-*+]|\d{1,9}[.)])[ \t]+(.*)$/.exec(line)) ) {
            flush();
            const level = Math.min(3, Math.floor(match[1].replace(/\t/g, '    ').length / 2));
            const marker = /\d/.test(match[2]) ? match[2] : '•';
            layout = {
                indent: 14 + level * 12,
                spaceAfter: 3,
                // The marker hangs before the text, about its own width away.
                marker: { text: marker, offset: -(marker.length * BODY_SIZE / 2 + 4), size: BODY_SIZE, color: TEXT_COLOR },
            };
            gathered.push(match[3].trim());
        } else if ( line.includes('|') && /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/.test(lines[at + 1] ?? '') &&
            lines[at + 1].includes('|') ) {
            flush();
            const rows = [splitRow(line)];
            for ( at += 2; at < lines.length && lines[at].includes('|'); at++ ) rows.push(splitRow(lines[at]));
            at--;
            const tableStyle = { ...bodyStyle, size: BODY_SIZE - 1 };
            for ( const [index, row] of rows.entries() ) {
                blocks.push({
                    cells: row.map(cell => ({
                        // Columns share the page's width evenly.
                        width: 0,
                        blocks: [paragraph(blockRuns(cell.trim(), { ...tableStyle, bold: !index }), { size: BODY_SIZE - 1, spaceAfter: 4 })],
                    })),
                });
            }
        } else {
            // An HTML heading, as a README often opens with, is the only tag that changes how its text is drawn.
            if ( !gathered.length && (match = /^\s*<h([1-6])[\s>]/i.exec(line)) ) {
                style = headingStyle(Number(match[1]));
                layout = { size: style.size, spaceBefore: blocks.length ? 6 : 0, spaceAfter: 6 };
            }
            gathered.push(line.trim());
        }
    }
    flush();
    return blocks;
};

/**
 * Get a small image of the start of a Markdown file, laid out as the page it describes.
 *
 * @param {File} file
 * @returns {Promise<File | undefined>} An image file browsers can decode, or `undefined` when there is no text to show.
 */
export const readMarkdownPreview = async (file) => {
    const text = await readLeadingText(file);
    if ( ! text ) return undefined;
    const page = createTextPage();
    page.blocks = parseMarkdown(text);
    return renderPage(page);
};
