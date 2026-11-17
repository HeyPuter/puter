export const PDFJS_VERSION = '6.3.289';
export const PDF_THUMBNAIL_ASSET_PATH = `/dist/pdf-thumbnails/${PDFJS_VERSION}/`;
export const PDF_THUMBNAIL_MAX_FILE_BYTES = 20 * 1024 * 1024;
export const PDF_THUMBNAIL_BATCH_TIMEOUT_MS = 5000;
export const PDF_THUMBNAIL_JOB_TIMEOUT_MS = 4000;
export const PDF_THUMBNAIL_MAX_PIXELS = 4 * 1024 * 1024;
export const PDF_THUMBNAIL_DIMENSION = 128;
export const PDF_THUMBNAIL_MAX_BYTES = 2 * 1024 * 1024;
export const PSD_PREVIEW_MAX_READ_BYTES = 1024 * 1024;
export const PSD_PREVIEW_MAX_BYTES = 1024 * 1024;
export const PSD_COMPOSITE_MAX_READ_BYTES = 16 * 1024 * 1024;
// Twice the thumbnail's size, so the image generator's downscale smooths the sampled rows.
export const PSD_COMPOSITE_DIMENSION = 256;
export const WORD_BATCH_TIMEOUT_MS = 5000;
// Covers finding a DOCX's parts, and a DOC's allocation tables and text.
export const WORD_MAX_READ_BYTES = 4 * 1024 * 1024;
export const WORD_XML_MAX_BYTES = 1024 * 1024;
export const WORD_TEXT_MAX_CHARACTERS = 16 * 1024;
export const WORD_THUMBNAIL_MAX_BYTES = 1024 * 1024;
export const WORD_PICTURE_MAX_BYTES = 4 * 1024 * 1024;
export const WORD_MAX_PICTURES = 4;
// Twice the thumbnail's size, so the image generator's downscale smooths the text.
export const WORD_PAGE_DIMENSION = 256;
