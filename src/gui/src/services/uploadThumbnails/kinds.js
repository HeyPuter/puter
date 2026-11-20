import { TEXT_MAX_READ_BYTES } from './config.js';

// Which files are documents, by name. A document's thumbnail is a picture of its first page.
export const PDF_NAME = /\.pdf$/i;
// Illustrator saves a PDF of the artwork inside its files, unless told not to. Such a file is artwork, not a page.
export const ILLUSTRATOR_NAME = /\.ai$/i;
export const WORD_NAME = /\.do[ct][xm]?$/i;
export const SPREADSHEET_NAME = /\.xl[st][xm]$/i;
// Presentations, slide shows and templates, with or without macros.
export const PRESENTATION_NAME = /\.p(pt|ps|ot)[xm]$/i;
// Pages, Numbers and Keynote files, and OpenDocument text, spreadsheets and presentations. Each carries a picture of
// its first page, sheet or slide.
export const IWORK_NAME = /\.(pages|numbers|key)$/i;
export const OPEN_DOCUMENT_NAME = /\.od[tsp]$/i;
// A Sketch file carries a picture of its artwork and an EPUB its cover, so neither of those is a page.
export const ARTWORK_PACKAGE_NAME = /\.(sketch|epub)$/i;
export const PSD_NAME = /\.ps[db]$/i;
export const HEIF_NAME = /\.(heic|heif|hif)$/i;
export const AUDIO_NAME = /\.(mp3|m4a|m4b|flac)$/i;
export const VIDEO_NAME = /\.(mp4|m4v|mov|webm)$/i;
// Source code, by language. `code.js` holds how each language is colored.
export const CODE_NAMES = { javascript: /\.[cm]?js$/i, css: /\.css$/i, json: /\.json$/i };
export const MARKDOWN_NAME = /\.(md|markdown)$/i;
export const CSV_NAME = /\.csv$/i;

export const PSD_TYPE = 'image/vnd.adobe.photoshop';
export const WORD_TYPE = /^application\/(msword$|vnd\.ms-word\.|vnd\.openxmlformats-officedocument\.wordprocessingml\.)/;
export const SPREADSHEET_TYPE = /^application\/vnd\.(ms-excel\.(sheet|template)\.|openxmlformats-officedocument\.spreadsheetml\.)/;
export const PRESENTATION_TYPE = /^application\/vnd\.(ms-powerpoint\.|openxmlformats-officedocument\.presentationml\.)/;
// Pages, Numbers and Keynote under either of the names their types go by, OpenDocument files and EPUBs.
export const PACKAGE_TYPE = /^application\/(vnd\.apple\.(pages|numbers|keynote)|x-iwork-|vnd\.oasis\.opendocument\.(text|spreadsheet|presentation)$|epub\+zip$)/;
export const HEIF_TYPE = /^image\/hei[cf]$/;
export const AUDIO_TYPE = /^audio\/(mpeg|mp3|mp4|m4a|x-m4a|flac|x-flac)$/;
// The containers browsers play. Other `video/` types are left alone: a `.ts` source file is reported as one.
export const VIDEO_TYPE = /^video\/(mp4|quicktime|webm|x-m4v)$/;
export const CODE_TYPES = {
    javascript: /^(text|application)\/(x-)?javascript$/,
    css: /^text\/css$/,
    json: /^application\/json$/,
};
export const MARKDOWN_TYPE = /^text\/(x-)?markdown$/;
// With Excel installed, Windows types a CSV as `application/vnd.ms-excel`, an old workbook's type, so its name decides.
export const CSV_TYPE = /^text\/csv$/;
// The pictures browsers decode. Many other files are typed `image/` (TIFF scans, CAD drawings, DjVu books) and none of
// them can be drawn, so a file is only worth downloading for a thumbnail when it's one of these.
export const DECODABLE_IMAGE_TYPE = /^image\/(png|apng|jpeg|gif|webp|bmp|avif|svg\+xml|x-icon|vnd\.microsoft\.icon)$/;
// Only the names the image generator goes by when a file has no type.
export const DECODABLE_IMAGE_NAME = /\.(png|jpe?g|jfif|gif|webp|bmp|avif)$/i;

/**
 * Whether a file's thumbnail, if it has one, shows a page. A page reads well in a grid, but at the size of a list row
 * it is a blank square.
 *
 * @param {string} [name]
 * @returns {boolean}
 */
export const isPageDocument = (name = '') =>
    [
        PDF_NAME, WORD_NAME, SPREADSHEET_NAME, PRESENTATION_NAME, IWORK_NAME, OPEN_DOCUMENT_NAME, CSV_NAME, MARKDOWN_NAME,
        ...Object.values(CODE_NAMES),
    ].some(pattern => pattern.test(name));

/**
 * Whether a file is one of the packages that carry a picture of themselves, made by the editor that saved them.
 *
 * @param {string} [name]
 * @param {string} [type]
 * @returns {boolean}
 */
export const isPreviewPackage = (name = '', type = '') => PACKAGE_TYPE.test(type) ||
    [IWORK_NAME, OPEN_DOCUMENT_NAME, ARTWORK_PACKAGE_NAME].some(pattern => pattern.test(name));

/**
 * The language of a source file the generator draws.
 *
 * @param {string} [name]
 * @param {string} [type]
 * @returns {string | undefined} A key of `CODE_NAMES`, or `undefined` for any other file.
 */
export const codeLanguage = (name = '', type = '') => Object.keys(CODE_NAMES)
    .find(language => CODE_TYPES[language].test(type) || CODE_NAMES[language].test(name));

/**
 * How much of a file the generator reads, when it reads only the start. A file that has to be downloaded for a
 * thumbnail is downloaded only this far.
 *
 * @param {string} [name]
 * @param {string} [type]
 * @returns {number | undefined} A number of bytes, or `undefined` for a file read past its start.
 */
export const leadingBytesRead = (name = '', type = '') =>
    codeLanguage(name, type) || MARKDOWN_TYPE.test(type) || MARKDOWN_NAME.test(name) ||
    CSV_TYPE.test(type) || CSV_NAME.test(name) ? TEXT_MAX_READ_BYTES : undefined;

/**
 * Whether the thumbnail generator has a reader for a file of this name and type that works in every browser. It may
 * still make none, for a file that's damaged, over a budget, or blank. The generator itself tries any `image/` file,
 * which costs nothing for a file being uploaded; this is for a file that has to be downloaded first.
 *
 * @param {string} [name]
 * @param {string} [type]
 * @returns {boolean}
 */
export const canMakeThumbnail = (name = '', type = '') =>
    type === 'application/pdf' || PDF_NAME.test(name) || ILLUSTRATOR_NAME.test(name) ||
    type === PSD_TYPE || PSD_NAME.test(name) ||
    WORD_TYPE.test(type) || WORD_NAME.test(name) ||
    SPREADSHEET_TYPE.test(type) || SPREADSHEET_NAME.test(name) ||
    PRESENTATION_TYPE.test(type) || PRESENTATION_NAME.test(name) ||
    isPreviewPackage(name, type) ||
    HEIF_TYPE.test(type) || HEIF_NAME.test(name) ||
    AUDIO_TYPE.test(type) || AUDIO_NAME.test(name) ||
    VIDEO_TYPE.test(type) || VIDEO_NAME.test(name) ||
    !!leadingBytesRead(name, type) ||
    DECODABLE_IMAGE_TYPE.test(type) || DECODABLE_IMAGE_NAME.test(name);
