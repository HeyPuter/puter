import { SHEET_CELL_MAX_CHARACTERS, SHEET_MAX_COLUMNS, SHEET_MAX_ROWS } from './config.js';
import { readLeadingText } from './text.js';
import { DEFAULT_FONT, createSheet, drawSheet } from './xlsx.js';

// What separates the fields of a CSV, in the order a tie is settled. Locales that write a decimal comma use `;`.
const DELIMITERS = [',', ';', '\t', '|'];
// What a spreadsheet reads as a number, and so aligns right: amounts, with either mark between thousands or before the
// decimals, since a file separated by `;` writes its decimals after a comma, and dates and times.
const AMOUNT = String.raw`[-+]?(?:[$€£¥]\s?)?(?:(?:\d{1,3}(?:[.,]\d{3})+|\d+)(?:[.,]\d*)?|[.,]\d+)(?:[eE][-+]?\d+)?%?(?:\s?[$€£¥])?`;
const TIME = String.raw`\d{1,2}:\d{2}(?::\d{2}(?:[.,]\d+)?)?(?:\s?[AaPp][Mm])?`;
const DATE = String.raw`(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}(?<mark>[/.])\d{1,2}\k<mark>\d{2,4})(?:[T ]${TIME}(?:Z|[-+]\d{2}:?\d{2})?)?`;
const NUMBER = new RegExp(`^(?:${AMOUNT}|${DATE}|${TIME})$`);

/**
 * The delimiter a CSV's first line holds the most of, outside quotes.
 *
 * @param {string} text
 * @returns {string}
 */
const delimiterOf = (text) => {
    const counts = new Map(DELIMITERS.map(delimiter => [delimiter, 0]));
    let quoted = false;
    // As in the parser, a quote opens only at the start of a field, and one inside a field is part of its text. A quote
    // right after a closing one is a quote written twice, so it reopens.
    let fieldStart = true;
    for ( const char of text ) {
        if ( char === '"' && (quoted || fieldStart) ) {
            quoted = !quoted;
            fieldStart = !quoted;
        } else if ( quoted ) {
            continue;
        } else if ( char === '\n' ) {
            break;
        } else {
            fieldStart = counts.has(char);
            if ( fieldStart ) counts.set(char, counts.get(char) + 1);
        }
    }
    return DELIMITERS.reduce((most, delimiter) => (counts.get(delimiter) > counts.get(most) ? delimiter : most));
};

/**
 * Split CSV into rows of fields, as RFC 4180 describes: a field in double quotes may hold the delimiter, line breaks,
 * and a quote written twice. Only the rows, columns and characters a sheet's thumbnail can show are kept.
 *
 * @param {string} text With each line ending in `\n`.
 * @returns {string[][]}
 */
export const parseCsv = (text) => {
    const delimiter = delimiterOf(text);
    const rows = [];
    let fields = [];
    let field = '';
    let quoted = false;
    const endField = () => {
        if ( fields.length < SHEET_MAX_COLUMNS ) fields.push(field);
        field = '';
    };
    const add = (char) => {
        if ( field.length < SHEET_CELL_MAX_CHARACTERS ) field += char;
    };
    for ( let at = 0; at < text.length; at++ ) {
        const char = text[at];
        if ( quoted ) {
            if ( char !== '"' ) add(char);
            else if ( text[at + 1] === '"' ) {
                add('"');
                at++;
            } else quoted = false;
        } else if ( char === '"' && !field ) {
            quoted = true;
        } else if ( char === delimiter ) {
            endField();
        } else if ( char === '\n' ) {
            endField();
            rows.push(fields);
            fields = [];
            if ( rows.length >= SHEET_MAX_ROWS ) return rows;
        } else {
            add(char);
        }
    }
    // The last line may have no line break after it, or may be where the read stopped.
    if ( field || fields.length ) {
        endField();
        rows.push(fields);
    }
    return rows;
};

/**
 * Get a small image of the start of a CSV file, drawn as a spreadsheet shows it: in cells of the default size, with
 * numbers aligned right and other text left.
 *
 * @param {File} file
 * @returns {Promise<File | undefined>} An image file browsers can decode, or `undefined` for a file with no text.
 */
export const readCsvPreview = async (file) => {
    const text = await readLeadingText(file);
    if ( ! text ) return undefined;
    const sheet = createSheet();
    sheet.rows = parseCsv(text).map(fields => ({
        cells: fields.map(field => {
            // A line break inside a field would be drawn as nothing.
            const value = field.replace(/\n/g, ' ');
            if ( ! value.trim() ) return undefined;
            return { ...DEFAULT_FONT, text: value, align: NUMBER.test(value.trim()) ? 'right' : 'left' };
        }),
    }));
    return drawSheet(sheet);
};
