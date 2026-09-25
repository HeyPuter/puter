import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { isRetryable, pool, readRemote, uploadFiles, withRetry } from './transfer.js';

const tempDirs = [];

function makeLocalFiles(count, bytes = 8) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'puter-cli-transfer-'));
  tempDirs.push(dir);
  const files = [];
  for (let i = 0; i < count; i++) {
    const rel = `f${i}.txt`;
    const full = path.join(dir, rel);
    fs.writeFileSync(full, Buffer.alloc(bytes, 1));
    files.push({ full, rel });
  }
  return files;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe('isRetryable', () => {
  it('retries what might answer differently next time', () => {
    expect(isRetryable({ status: 500 })).toBe(true);
    expect(isRetryable({ status: 503 })).toBe(true);
    expect(isRetryable({ status: 429 })).toBe(true);
    expect(isRetryable({ code: 'ECONNRESET' })).toBe(true);
    expect(isRetryable({ message: 'fetch failed' })).toBe(true);
  });

  it('does not retry a verdict', () => {
    expect(isRetryable({ status: 404 })).toBe(false);
    expect(isRetryable({ status: 403 })).toBe(false);
    expect(isRetryable({ status: 400, code: 'invalid_request' })).toBe(false);
  });
});

describe('withRetry', () => {
  it('gives up immediately on a client error', async () => {
    let calls = 0;
    await expect(
      withRetry(() => {
        calls++;
        return Promise.reject({ status: 400, message: 'nope' });
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(calls).toBe(1);
  });

  it('retries a server error and returns the eventual success', async () => {
    let calls = 0;
    const result = await withRetry(() => {
      calls++;
      if (calls < 3) return Promise.reject({ status: 500 });
      return Promise.resolve('ok');
    });
    expect(result).toBe('ok');
    expect(calls).toBe(3);
  });
});

describe('pool', () => {
  it('keeps at most `limit` in flight and preserves result order', async () => {
    let inFlight = 0;
    let peak = 0;
    const items = Array.from({ length: 20 }, (_, i) => i);

    const results = await pool(items, 4, async (item) => {
      peak = Math.max(peak, ++inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight--;
      return item * 2;
    });

    expect(peak).toBeLessThanOrEqual(4);
    expect(results).toEqual(items.map((i) => i * 2));
  });
});

describe('uploadFiles', () => {
  function client(upload) {
    return { fs: { upload } };
  }

  it('batches by file count rather than sending one request per file', async () => {
    const files = makeLocalFiles(101);
    const batches = [];
    const puter = client(async (items) => {
      batches.push(items.length);
    });

    const result = await uploadFiles(puter, {
      files,
      destination: '~/dst',
      concurrency: 1,
    });

    expect(batches).toEqual([100, 1]);
    expect(result).toEqual({ uploaded: 101, failures: [] });
  });

  it('carries nesting in the destination, not in a per-file path', async () => {
    // The SDK drops the per-file relative path on its signed batch-write
    // path, so each directory is uploaded into its own dirPath instead.
    const files = makeLocalFiles(1);
    files.push(
      { full: files[0].full, rel: 'nested/c.txt' },
      { full: files[0].full, rel: 'nested/deep/d.txt' },
      { full: files[0].full, rel: 'other/c.txt' },
    );
    const sent = [];
    const puter = client(async (items, destination) => {
      sent.push({ destination, names: items.map((item) => item.name) });
    });

    await uploadFiles(puter, { files, destination: '~/dst', concurrency: 1 });

    expect(sent).toEqual([
      { destination: '~/dst', names: ['f0.txt'] },
      { destination: '~/dst/nested', names: ['c.txt'] },
      { destination: '~/dst/nested/deep', names: ['d.txt'] },
      { destination: '~/dst/other', names: ['c.txt'] },
    ]);
  });

  it('retries a batch that failed for a reason that might not repeat', async () => {
    const files = makeLocalFiles(3);
    let calls = 0;
    const puter = client(async () => {
      if (++calls === 1) throw { status: 503, message: 'unavailable' };
    });

    const result = await uploadFiles(puter, { files, destination: '~/dst' });

    expect(calls).toBe(2);
    expect(result.uploaded).toBe(3);
    expect(result.failures).toEqual([]);
  });

  it('re-sends only the items a partial failure names', async () => {
    const files = makeLocalFiles(3);
    const sent = [];
    let calls = 0;
    const puter = client(async (items) => {
      sent.push(items.map((item) => item.name));
      if (++calls === 1) {
        throw {
          partial: true,
          status: 503,
          message: 'one item failed',
          failedPaths: ['/u/dst/f1.txt'],
        };
      }
    });

    const result = await uploadFiles(puter, { files, destination: '~/dst' });

    expect(sent[1]).toEqual(['f1.txt']);
    expect(result).toEqual({ uploaded: 3, failures: [] });
  });

  it('collects what it cannot upload instead of aborting the run', async () => {
    const files = makeLocalFiles(3);
    let calls = 0;
    const puter = client(async () => {
      calls++;
      throw {
        code: 'batch_upload_partially_failed',
        status: 400,
        message: 'name too long',
        failedItems: [{ path: '/u/dst/f1.txt' }],
      };
    });

    const result = await uploadFiles(puter, { files, destination: '~/dst' });

    // A 400 is a verdict, so the batch is not re-sent...
    expect(calls).toBe(1);
    // ...and the two items the server did write still count as uploaded.
    expect(result.uploaded).toBe(2);
    expect(result.failures).toEqual([
      { rel: 'f1.txt', message: 'name too long' },
    ]);
  });

  it('blames the whole batch when the failure names nothing', async () => {
    const files = makeLocalFiles(2);
    const puter = client(async () => {
      throw { code: 'batch_upload_failed', status: 413, message: 'too large' };
    });

    const result = await uploadFiles(puter, { files, destination: '~/dst' });

    expect(result.uploaded).toBe(0);
    expect(result.failures.map((f) => f.rel).sort()).toEqual(['f0.txt', 'f1.txt']);
  });
});

describe('readRemote', () => {
  const blobOf = (bytes) => new Blob([Buffer.alloc(bytes, 7)]);

  it('reads a small file in one request', async () => {
    const reads = [];
    const puter = {
      fs: {
        read: async (p, options) => {
          reads.push(options);
          return blobOf(64);
        },
      },
    };

    const chunks = [];
    for await (const chunk of readRemote(puter, '~/a.bin', 64)) chunks.push(chunk);

    expect(reads).toEqual([undefined]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toHaveLength(64);
  });

  it('pulls a large file in ranged chunks so memory stays flat', async () => {
    const size = 40 * 1024 * 1024;
    const reads = [];
    const puter = {
      fs: {
        read: async (p, options) => {
          reads.push(options);
          return blobOf(options.byte_count);
        },
      },
    };

    let total = 0;
    for await (const chunk of readRemote(puter, '~/big.bin', size)) total += chunk.length;

    expect(total).toBe(size);
    expect(reads).toHaveLength(5);
    expect(reads.map((r) => r.offset)).toEqual([
      0,
      8 * 1024 * 1024,
      16 * 1024 * 1024,
      24 * 1024 * 1024,
      32 * 1024 * 1024,
    ]);
  });

  it('treats an over-long chunk as the whole file, not the first of many', async () => {
    const size = 40 * 1024 * 1024;
    let calls = 0;
    const puter = {
      fs: {
        read: async () => {
          calls++;
          return blobOf(size); // a backend that ignored the range
        },
      },
    };

    const chunks = [];
    for await (const chunk of readRemote(puter, '~/big.bin', size)) chunks.push(chunk);

    expect(calls).toBe(1);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toHaveLength(size);
  });
});
