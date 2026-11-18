export const PDFJS_VERSION = '6.3.289';
export const PDF_THUMBNAIL_ASSET_PATH = `/dist/pdf-thumbnails/${PDFJS_VERSION}/`;
export const PDF_THUMBNAIL_MAX_FILE_BYTES = 20 * 1024 * 1024;
export const PDF_THUMBNAIL_BATCH_TIMEOUT_MS = 5000;
export const PDF_THUMBNAIL_JOB_TIMEOUT_MS = 4000;
export const PDF_THUMBNAIL_MAX_PIXELS = 4 * 1024 * 1024;
// A page of a 300 dpi scan is about 8.5 megapixels and a phone photo 12. Decoding takes memory by the pixel.
export const PDF_THUMBNAIL_MAX_IMAGE_PIXELS = 16 * 1024 * 1024;
export const PDF_THUMBNAIL_DIMENSION = 128;
export const PDF_THUMBNAIL_MAX_BYTES = 2 * 1024 * 1024;
export const PSD_PREVIEW_MAX_READ_BYTES = 1024 * 1024;
export const PSD_PREVIEW_MAX_BYTES = 1024 * 1024;
export const PSD_COMPOSITE_MAX_READ_BYTES = 16 * 1024 * 1024;
// Twice the thumbnail's size, so the image generator's downscale smooths the sampled rows.
export const PSD_COMPOSITE_DIMENSION = 256;
export const OFFICE_BATCH_TIMEOUT_MS = 5000;
// Covers finding the entries of a ZIP archive: its directory and the headers of the entries read.
export const ARCHIVE_MAX_READ_BYTES = 4 * 1024 * 1024;
// Covers a DOC's allocation tables and text.
export const OFFICE_MAX_READ_BYTES = 4 * 1024 * 1024;
export const OFFICE_XML_MAX_BYTES = 1024 * 1024;
export const WORD_TEXT_MAX_CHARACTERS = 16 * 1024;
export const OFFICE_THUMBNAIL_MAX_BYTES = 1024 * 1024;
export const OFFICE_PICTURE_MAX_BYTES = 4 * 1024 * 1024;
export const OFFICE_PICTURE_MAX_PIXELS = 16 * 1024 * 1024;
export const WORD_MAX_PICTURES = 4;
// Twice the thumbnail's size, so the image generator's downscale smooths the text.
export const OFFICE_PAGE_DIMENSION = 256;
// How much of the first sheet a spreadsheet's thumbnail shows, from its top-left corner, in points a side.
export const SHEET_VIEW_POINTS = 480;
export const SHEET_MAX_ROWS = 128;
export const SHEET_MAX_COLUMNS = 64;
export const SHEET_CELL_MAX_CHARACTERS = 256;
export const SLIDE_MAX_SHAPES = 256;
export const SLIDE_MAX_PICTURES = 8;
export const SLIDE_TEXT_MAX_CHARACTERS = 4096;
export const AUDIO_BATCH_TIMEOUT_MS = 5000;
// Covers finding the cover in an audio file's tags. The cover itself is not read until it is decoded.
export const AUDIO_MAX_READ_BYTES = 1024 * 1024;
export const AUDIO_COVER_MAX_BYTES = 16 * 1024 * 1024;
// A camera roll is hundreds of photos, each a few milliseconds of the device's decoder.
export const HEIF_BATCH_TIMEOUT_MS = 10000;
export const HEIF_DECODE_TIMEOUT_MS = 2000;
export const HEIF_META_MAX_BYTES = 1024 * 1024;
// Covers the index and the coded pictures of one photo: its stored thumbnail, or else all of its tiles.
export const HEIF_MAX_READ_BYTES = 16 * 1024 * 1024;
export const HEIF_MAX_TILES = 64;
export const HEIF_MAX_PIXELS = 16 * 1024 * 1024;
// Twice the thumbnail's size, so the image generator's downscale smooths the photo.
export const HEIF_PICTURE_DIMENSION = 256;
export const VIDEO_BATCH_TIMEOUT_MS = 5000;
export const VIDEO_JOB_TIMEOUT_MS = 4000;
// The frame shown is a tenth of the way into the video, but no later than this.
export const VIDEO_FRAME_MAX_SECONDS = 10;
// Twice the thumbnail's size, so the image generator's downscale smooths the frame.
export const VIDEO_FRAME_DIMENSION = 256;
