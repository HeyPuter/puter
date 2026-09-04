// Moving bytes in bulk: bounded concurrency, retry with backoff, and the
// batching that `puter.fs.upload()` wants.
//
// Everything here goes through the SDK rather than talking to the API
// directly — `upload()` is the fast path (one signed batch write per call
// instead of a request per file), and it reports which of its items failed,
// so a retry re-sends only those.

import fs from 'node:fs';

import { messageOf } from './errors.js';

export const DEFAULT_CONCURRENCY = 8;

// A batch is capped by both count and size because its files are held in
// memory at once, and `--concurrency` batches are in flight at a time.
const MAX_BATCH_FILES = 100;
const MAX_BATCH_BYTES = 8 * 1024 * 1024;

const ATTEMPTS = 3;
const BASE_BACKOFF_MS = 500;

// puter.fs.read() resolves a whole Blob — the SDK has no streaming read — so
// anything past this is pulled in ranged chunks to keep memory flat.
const CHUNKED_READ_THRESHOLD = 32 * 1024 * 1024;
const READ_CHUNK_BYTES = 8 * 1024 * 1024;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Worth another go: the request never reached a verdict (network) or the
// server said it couldn't answer right now (5xx, 429). A 4xx won't change
// its mind, and retrying it only delays the message.
export function isRetryable(err) {
  const status = Number(err?.status ?? err?.statusCode);
  if (Number.isFinite(status) && status > 0) {
    return status >= 500 || status === 429;
  }
  const code = err?.code ?? err?.errno;
  if (typeof code === 'string' && /^(ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE|ENETUNREACH|ESOCKET)/.test(code)) {
    return true;
  }
  return /network|socket hang up|timed? ?out|fetch failed/i.test(messageOf(err));
}

export async function withRetry(fn, { attempts = ATTEMPTS, onRetry } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= attempts || !isRetryable(err)) throw err;
      const delay = BASE_BACKOFF_MS * 2 ** (attempt - 1);
      onRetry?.(err, attempt, delay);
      await sleep(delay);
    }
  }
}

/**
 * Run `worker` over `items` with at most `limit` in flight, preserving input
 * order in the returned results. Rejections are the worker's to handle — this
 * resolves with whatever each call returned.
 *
 * @template T, R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T, index: number) => Promise<R>} worker
 * @returns {Promise<R[]>}
 */
export async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = new Array(Math.min(Math.max(1, limit), items.length || 1))
    .fill(null)
    .map(async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await worker(items[index], index);
      }
    });
  await Promise.all(runners);
  return results;
}

function sizeOf(file) {
  if (Number.isFinite(file.size)) return file.size;
  try {
    return fs.statSync(file.full).size;
  } catch {
    return 0;
  }
}

const relDirOf = (rel) => {
  const slash = rel.lastIndexOf('/');
  return slash === -1 ? '' : rel.slice(0, slash);
};

const relNameOf = (rel) => rel.slice(rel.lastIndexOf('/') + 1);

// Batches are grouped by directory, and each one uploads into its own
// `dirPath`, because that is the only part of the destination the SDK
// honors: the per-file `finalPath` it computes a nested path from is dropped
// on the signed batch-write path, which collapses a tree onto its basenames
// (and silently overwrites same-named files from different directories).
function batchFiles(files) {
  const byDir = new Map();
  for (const file of files) {
    const dir = relDirOf(file.rel);
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir).push(file);
  }

  const batches = [];
  for (const [dir, group] of byDir) {
    let current = [];
    let bytes = 0;
    for (const file of group) {
      const size = sizeOf(file);
      if (
        current.length > 0 &&
        (current.length >= MAX_BATCH_FILES || bytes + size > MAX_BATCH_BYTES)
      ) {
        batches.push({ dir, files: current });
        current = [];
        bytes = 0;
      }
      current.push(file);
      bytes += size;
    }
    if (current.length > 0) batches.push({ dir, files: current });
  }
  return batches;
}

// upload() rejects with one of two shapes depending on which path ran: the
// signed batch write reports `failedPaths`/`failedItems`, the legacy /batch
// path a `batch_upload_*` code with `failedItems`. Both name the operations
// that failed, so pull out the subset still owed and leave the rest counted
// as written. Returns null when the failure names nothing.
function attributeFailures(pending, err) {
  const named = [
    ...(Array.isArray(err?.failedPaths) ? err.failedPaths : []),
    ...(Array.isArray(err?.failedItems) ? err.failedItems : []).map(
      (item) => item?.path ?? item?.name,
    ),
  ].filter((value) => typeof value === 'string' && value.length > 0);

  if (named.length === 0) return null;

  // The server reports absolute paths; ours are relative to the destination.
  const failed = pending.filter((file) =>
    named.some((p) => p === file.rel || p.endsWith(`/${file.rel}`)),
  );
  return failed.length > 0 ? failed : null;
}

async function sendBatch(puter, dir, files, destination, options) {
  const items = files.map(
    (file) => new File([fs.readFileSync(file.full)], relNameOf(file.rel)),
  );
  await puter.fs.upload(items, dir ? `${destination}/${dir}` : destination, {
    // `-n` filtered out what already exists, so a conflict here means the
    // destination changed under us: fail it rather than clobber.
    overwrite: !options.noClobber,
    dedupeName: false,
    createMissingParents: true,
  });
}

/**
 * Upload local files into a remote directory, preserving their relative paths.
 * A file that keeps failing is collected rather than aborting the run — the
 * caller reports the summary and exits non-zero.
 *
 * @returns {Promise<{ uploaded: number, failures: {rel: string, message: string}[] }>}
 */
export async function uploadFiles(
  puter,
  { files, destination, concurrency = DEFAULT_CONCURRENCY, noClobber = false, onProgress, onRetry },
) {
  const failures = [];
  let uploaded = 0;

  await pool(batchFiles(files), concurrency, async (batch) => {
    let pending = batch.files;
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      try {
        await sendBatch(puter, batch.dir, pending, destination, { noClobber });
        uploaded += pending.length;
        onProgress?.(uploaded + failures.length, files.length);
        return;
      } catch (err) {
        // Items the server did write don't need re-sending; when the failure
        // names nothing, the whole batch is still owed.
        const owed = attributeFailures(pending, err) ?? pending;
        uploaded += pending.length - owed.length;

        if (attempt === ATTEMPTS || !isRetryable(err)) {
          const message = messageOf(err);
          for (const file of owed) failures.push({ rel: file.rel, message });
          onProgress?.(uploaded + failures.length, files.length);
          return;
        }
        onRetry?.(err, attempt);
        pending = owed;
        await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1));
      }
    }
  });

  return { uploaded, failures };
}

/**
 * Read a remote file as a sequence of buffers. Files past the chunk threshold
 * are pulled with `offset`/`byte_count` (which the backend serves as a Range
 * request) so memory stays flat; if a chunk comes back longer than asked for
 * the range wasn't honored, and that response is the whole file.
 *
 * @param {*} puter
 * @param {string} remotePath
 * @param {number} [size]
 * @returns {AsyncGenerator<Buffer>}
 */
export async function* readRemote(puter, remotePath, size) {
  const toBuffer = async (blob) => Buffer.from(await blob.arrayBuffer());

  if (!Number.isFinite(size) || size <= CHUNKED_READ_THRESHOLD) {
    yield await toBuffer(await withRetry(() => puter.fs.read(remotePath)));
    return;
  }

  let offset = 0;
  while (offset < size) {
    const byteCount = Math.min(READ_CHUNK_BYTES, size - offset);
    const chunk = await toBuffer(
      await withRetry(() =>
        puter.fs.read(remotePath, { offset, byte_count: byteCount }),
      ),
    );
    yield chunk;
    if (chunk.length === 0 || chunk.length > byteCount) return;
    offset += chunk.length;
  }
}

// Write to a stream and wait for it to drain, so a large transfer doesn't
// queue the whole file in memory behind a slow consumer.
export function writeChunk(stream, buf) {
  return new Promise((resolve, reject) => {
    stream.write(buf, (err) => (err ? reject(err) : resolve()));
  });
}
