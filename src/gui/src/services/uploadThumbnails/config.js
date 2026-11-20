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
// The picture a packaged document carries of itself. A book's cover can be a large one.
export const EMBEDDED_PREVIEW_MAX_BYTES = 8 * 1024 * 1024;
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
// A project folder is thousands of small source files, so an upload spends less time on them than on documents.
export const TEXT_BATCH_TIMEOUT_MS = 2000;
// Source code and Markdown are drawn from the start of the file, which is all of it that is read.
export const TEXT_MAX_READ_BYTES = 16 * 1024;
// The dashboard makes thumbnails for files that have none as it shows them, within these budgets.
export const MISSING_THUMBNAIL_MAX_FILE_BYTES = 20 * 1024 * 1024;
// One at a time: a download holds one of the account's concurrent file reads, and a temporary account has three for
// everything its apps do.
export const MISSING_THUMBNAIL_CONCURRENCY = 1;
export const MISSING_THUMBNAIL_PER_MINUTE = 20;
// Per page load. Downloads count as the account's egress, so browsing a large photo library stays bounded.
export const MISSING_THUMBNAIL_SESSION_BYTES = 100 * 1024 * 1024;
// A file saved within this long waits until it's this old, so an app saving every few seconds isn't chased.
export const MISSING_THUMBNAIL_SETTLE_MS = 3000;
export const MISSING_THUMBNAIL_BACKOFF_MS = 60 * 1000;
// How long a row keeps showing the thumbnail of the version before, while one is made for a file that was saved over.
export const MISSING_THUMBNAIL_OLD_PICTURE_MS = 10 * 1000;
export const MISSING_THUMBNAIL_ATTEMPTS_REMEMBERED = 10000;
// Files that gave no thumbnail, kept across page loads so they aren't downloaded again.
export const MISSING_THUMBNAIL_FAILURES_REMEMBERED = 1000;
