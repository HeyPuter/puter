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
export const OFFICE_BATCH_TIMEOUT_MS = 5000;
// Covers finding a DOCX's parts, and a DOC's allocation tables and text.
export const OFFICE_MAX_READ_BYTES = 4 * 1024 * 1024;
export const OFFICE_XML_MAX_BYTES = 1024 * 1024;
export const WORD_TEXT_MAX_CHARACTERS = 16 * 1024;
export const OFFICE_THUMBNAIL_MAX_BYTES = 1024 * 1024;
export const WORD_PICTURE_MAX_BYTES = 4 * 1024 * 1024;
export const WORD_PICTURE_MAX_PIXELS = 16 * 1024 * 1024;
export const WORD_MAX_PICTURES = 4;
// Twice the thumbnail's size, so the image generator's downscale smooths the text.
export const OFFICE_PAGE_DIMENSION = 256;
// How much of the first sheet a spreadsheet's thumbnail shows, from its top-left corner, in points a side.
export const SHEET_VIEW_POINTS = 480;
export const SHEET_MAX_ROWS = 128;
export const SHEET_MAX_COLUMNS = 64;
export const SHEET_CELL_MAX_CHARACTERS = 256;
export const VIDEO_BATCH_TIMEOUT_MS = 5000;
export const VIDEO_JOB_TIMEOUT_MS = 4000;
// The frame shown is a tenth of the way into the video, but no later than this.
export const VIDEO_FRAME_MAX_SECONDS = 10;
// Twice the thumbnail's size, so the image generator's downscale smooths the frame.
export const VIDEO_FRAME_DIMENSION = 256;
