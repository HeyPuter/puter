import { renderPage } from './page.js';
import { createTextPage, readLeadingText } from './text.js';

const FONT_SIZE = 10;
// What a group of a language's pattern is drawn in. Text that no group matches is drawn in `plain`.
const COLORS = {
    plain: '#24292f',
    comment: '#6e7781',
    string: '#0a3069',
    keyword: '#cf222e',
    number: '#0550ae',
    property: '#0550ae',
    name: '#8250df',
};

// One pattern per language, with a group for each kind of token that has a color. The alternative with no group takes
// a whole word, so that no token starts in the middle of one. Nothing here backtracks over more than a few hundred
// characters, since a minified file is one long line.
const TOKENS = {
    javascript: new RegExp([
        /(?<comment>\/\/[^\n]*|\/\*[^]*?(?:\*\/|$))/,
        /(?<string>"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?|`(?:\\[^]|[^`\\])*`?)/,
        /(?<keyword>\b(?:async|await|break|case|catch|class|const|continue|default|delete|do|else|export|extends|finally|for|from|function|if|import|in|instanceof|let|new|of|return|static|super|switch|this|throw|try|typeof|var|void|while|yield)\b)/,
        /(?<number>\b(?:0[xXoObB][\da-fA-F_]+|\d[\d_]*(?:\.[\d_]*)?(?:[eE][+-]?\d+)?)n?|\b(?:true|false|null|undefined|NaN|Infinity)\b)/,
        // A function being called or declared.
        /(?<name>[A-Za-z_$][\w$]*(?=\s{0,8}\())/,
        /[A-Za-z_$][\w$]*/,
    ].map(pattern => pattern.source).join('|'), 'g'),
    css: new RegExp([
        /(?<comment>\/\*[^]*?(?:\*\/|$))/,
        /(?<string>"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?)/,
        /(?<keyword>@[\w-]+|!important\b)/,
        // A color or a quantity, then a class or an id.
        /(?<number>#[\da-fA-F]{3,8}(?![\w-])|-?(?:\d+\.?\d*|\.\d+)(?:%|[A-Za-z]+)?)/,
        /(?<name>[.#]-?[A-Za-z_][\w-]*)/,
        // A name before a colon is a property when its declaration ends before a block opens. Otherwise it is part of
        // a selector, such as the `a` of `a:hover`.
        /(?<property>(?:--|-?[A-Za-z_])[\w-]*(?=\s{0,8}:[^{};]{0,200}(?:[;}]|$)))/,
        /(?:--|-?[A-Za-z_])[\w-]*/,
    ].map(pattern => pattern.source).join('|'), 'g'),
    // Comments aren't JSON, but settings files such as `tsconfig.json` hold them.
    json: new RegExp([
        /(?<comment>\/\/[^\n]*|\/\*[^]*?(?:\*\/|$))/,
        // A string before a colon is a key.
        /(?<property>"(?:\\.|[^"\\\n])*"(?=\s{0,8}:))/,
        /(?<string>"(?:\\.|[^"\\\n])*"?)/,
        /(?<number>-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b|\b(?:true|false|null)\b)/,
        /[A-Za-z_$][\w$]*/,
    ].map(pattern => pattern.source).join('|'), 'g'),
};

// A token of JSON, a comment, or a run of anything else. A string or comment the read cut off ends the text.
const JSON_TOKEN = /"(?:\\.|[^"\\\n])*"?|\/\/[^\n]*|\/\*[^]*?(?:\*\/|$)|[{}[\],:]|[^\s{}[\],:"/]+|\//g;
// More lines than a page shows, so that indenting stops well before the text runs out on a minified file.
const JSON_MAX_LINES = 64;
// Lines nested deeper than this start no further right, since nothing past the page's edge is seen.
const JSON_MAX_INDENT = 16;

/**
 * Lay out JSON written on one line the way an editor's formatter would: one member or element to a line, indented by
 * two spaces a level. Text that isn't JSON is laid out as far as its brackets and commas go.
 *
 * @param {string} text
 * @returns {string} The first `JSON_MAX_LINES` lines of the result.
 */
export const indentJson = (text) => {
    const lines = [];
    let line = '';
    let depth = 0;
    // A bracket just opened waits for what comes next, so that an empty object or array stays on its line.
    let opened = false;
    // A top-level object or array has closed, so the next one, as in JSON Lines, starts a line of its own.
    let ended = false;
    const newLine = () => {
        if ( line.trim() ) lines.push(line);
        line = '  '.repeat(Math.min(depth, JSON_MAX_INDENT));
    };
    for ( const [token] of text.matchAll(JSON_TOKEN) ) {
        if ( lines.length >= JSON_MAX_LINES ) break;
        const closes = token === '}' || token === ']';
        if ( closes ) depth = Math.max(0, depth - 1);
        if ( closes ? !opened : opened || ended && token !== ',' ) newLine();
        opened = token === '{' || token === '[';
        ended = closes && depth === 0;
        if ( opened ) depth++;
        line += token === ':' ? ': ' : token;
        // A line comment runs to the end of its line.
        if ( token === ',' || token.startsWith('//') ) newLine();
    }
    newLine();
    return lines.slice(0, JSON_MAX_LINES).join('\n');
};

/**
 * Split source code into runs of one color each.
 *
 * @param {string} text
 * @param {string} language A key of `TOKENS`.
 * @returns {import('./page.js').PageRun[]}
 */
export const colorCode = (text, language) => {
    const runs = [];
    const add = (part, color) => {
        if ( part ) runs.push({ text: part, size: FONT_SIZE, bold: false, italic: false, color, family: 'monospace' });
    };
    let at = 0;
    for ( const match of text.matchAll(TOKENS[language]) ) {
        const kind = Object.keys(match.groups).find(group => match.groups[group] !== undefined);
        if ( ! kind ) continue;
        add(text.slice(at, match.index), COLORS.plain);
        add(match[0], COLORS[kind]);
        at = match.index + match[0].length;
    }
    add(text.slice(at), COLORS.plain);
    return runs;
};

/**
 * Get a small image of the start of a source file, colored as an editor would color it.
 *
 * @param {File} file
 * @param {string} language A key of `CODE_NAMES` in `kinds.js`.
 * @returns {Promise<File | undefined>} An image file browsers can decode, or `undefined` for a file with no text.
 */
export const readCodePreview = async (file, language) => {
    let text = await readLeadingText(file);
    if ( ! text ) return undefined;
    // A first line that holds a comma holds more than one value, as JSON written without line breaks does.
    if ( language === 'json' && text.split('\n', 1)[0].includes(',') ) text = indentJson(text);
    const page = createTextPage();
    page.blocks = [{
        runs: colorCode(text.replace(/\t/g, '    '), language),
        size: FONT_SIZE,
        align: 'start',
        indent: 0,
        spaceBefore: 0,
        spaceAfter: 0,
        lineSpacing: 1,
        wrap: false,
    }];
    return renderPage(page);
};
