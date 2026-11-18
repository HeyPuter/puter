// Which files are documents, by name. A document's thumbnail is a picture of its first page.
export const PDF_NAME = /\.pdf$/i;
// Illustrator saves a PDF of the artwork inside its files, unless told not to. Such a file is artwork, not a page.
export const ILLUSTRATOR_NAME = /\.ai$/i;
export const WORD_NAME = /\.do[ct][xm]?$/i;
export const SPREADSHEET_NAME = /\.xl[st][xm]$/i;
// Presentations, slide shows and templates, with or without macros.
export const PRESENTATION_NAME = /\.p(pt|ps|ot)[xm]$/i;
export const PSD_NAME = /\.ps[db]$/i;
export const HEIF_NAME = /\.(heic|heif|hif)$/i;
export const AUDIO_NAME = /\.(mp3|m4a|m4b|flac)$/i;
export const VIDEO_NAME = /\.(mp4|m4v|mov|webm)$/i;

export const PSD_TYPE = 'image/vnd.adobe.photoshop';
export const WORD_TYPE = /^application\/(msword$|vnd\.ms-word\.|vnd\.openxmlformats-officedocument\.wordprocessingml\.)/;
export const SPREADSHEET_TYPE = /^application\/vnd\.(ms-excel\.(sheet|template)\.|openxmlformats-officedocument\.spreadsheetml\.)/;
export const PRESENTATION_TYPE = /^application\/vnd\.(ms-powerpoint\.|openxmlformats-officedocument\.presentationml\.)/;
export const HEIF_TYPE = /^image\/hei[cf]$/;
export const AUDIO_TYPE = /^audio\/(mpeg|mp3|mp4|m4a|x-m4a|flac|x-flac)$/;
// The containers browsers play. Other `video/` types are left alone: a `.ts` source file is reported as one.
export const VIDEO_TYPE = /^video\/(mp4|quicktime|webm|x-m4v)$/;
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
export const isPageDocument = (name = '') => [PDF_NAME, WORD_NAME, SPREADSHEET_NAME, PRESENTATION_NAME]
    .some(pattern => pattern.test(name));

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
    HEIF_TYPE.test(type) || HEIF_NAME.test(name) ||
    AUDIO_TYPE.test(type) || AUDIO_NAME.test(name) ||
    VIDEO_TYPE.test(type) || VIDEO_NAME.test(name) ||
    DECODABLE_IMAGE_TYPE.test(type) || DECODABLE_IMAGE_NAME.test(name);
