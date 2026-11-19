import { SHEET_CELL_MAX_CHARACTERS, SHEET_MAX_COLUMNS, SHEET_MAX_ROWS } from './config.js';
import { readLeadingText } from './text.js';
import { DEFAULT_FONT, createSheet, drawSheet } from './xlsx.js';

// What separates the fields of a CSV, in the order a tie is settled. Locales that write a decimal comma use `;`.
const DELIMITERS = [',', ';', '\t', '|'];
// A file separated by `;` writes its decimals after a comma.
const NUMBER = /^[-+]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:[eE][-+]?\d+)?%?$/;

/**
 * The delimiter a CSV's first line holds the most of, outside quotes.
 *
 * @param {string} text
 * @returns {string}
 */
const delimiterOf = (text) => {
    const counts = new Map(DELIMITERS.map(delimiter => [delimiter, 0]));
    let quoted = false;
    for ( const char of text ) {
        if ( char === '"' ) quoted = !quoted;
        else if ( char === '\n' && !quoted ) break;
        else if ( !quoted && counts.has(char) ) counts.set(char, counts.get(char) + 1);
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
