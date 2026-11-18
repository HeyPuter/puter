// Which files are documents, by name. A document's thumbnail is a picture of its first page.
export const PDF_NAME = /\.pdf$/i;
// Illustrator saves a PDF of the artwork inside its files, unless told not to. Such a file is artwork, not a page.
export const ILLUSTRATOR_NAME = /\.ai$/i;
export const WORD_NAME = /\.do[ct][xm]?$/i;
export const SPREADSHEET_NAME = /\.xl[st][xm]$/i;

/**
 * Whether a file's thumbnail, if it has one, shows a page. A page reads well in a grid, but at the size of a list row
 * it is a blank square.
 *
 * @param {string} [name]
 * @returns {boolean}
 */
export const isPageDocument = (name = '') => PDF_NAME.test(name) || WORD_NAME.test(name) || SPREADSHEET_NAME.test(name);
