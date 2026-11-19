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
    const text = await readLeadingText(file);
    if ( ! text ) return undefined;
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
