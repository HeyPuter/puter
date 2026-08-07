// Shared constants for the upload pipeline.

export const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;
export const DEFAULT_THUMBNAIL_DIMENSION = 128;
export const MIN_THUMBNAIL_DIMENSION = 32;

// Marks whether the signed batch-write endpoints are known to be available on
// the current backend. Cached on the FileSystem module instance so a single
// "unavailable" response permanently routes later uploads through the legacy path.
export const SIGNED_BATCH_WRITE_CAPABILITY_KEY = 'signedBatchWriteSupported';
export const SIGNED_BATCH_REQUEST_CHUNK_SIZE = 500;
export const SIGNED_BATCH_CHUNK_PIPELINE_CONCURRENCY = 4;
export const SIGNED_BATCH_FILE_UPLOAD_CONCURRENCY = 8;
export const SIGNED_MULTIPART_PART_UPLOAD_CONCURRENCY = 8;
export const SIGNED_BATCH_WRITE_UNAVAILABLE_STATUSES = new Set([404, 405, 501]);
export const SIGNED_BATCH_SUPPORTED_ENVS = ['web', 'gui', 'app'];
