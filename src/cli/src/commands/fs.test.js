import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ client: null }));

vi.mock('../lib/auth.js', () => ({
  ensureClient: async () => state.client,
}));

import { fsCat, fsCp, fsLs, fsMkdir, fsMv, fsRm, fsStat } from './fs.js';

const MODIFIED = 1756900000;

// Entries are keyed by the `~/...` path a command resolves to, but carry the
// resolved `/u/...` path the backend actually returns.
function entry(remotePath, over = {}) {
  const name = remotePath.split('/').pop();
  return {
    path: `/u${remotePath.replace(/^~/, '')}`,
    name,
    is_dir: false,
    size: 1024,
    modified: MODIFIED,
    uid: `uid-${name}`,
    ...over,
  };
}

const dir = (remotePath, over = {}) =>
  entry(remotePath, { is_dir: true, size: null, ...over });

const notFound = () => ({
  status: 404,
  code: 'subject_does_not_exist',
  message: 'not found',
});

function makeClient({ entries = {}, listings = {}, deep = {}, apps = {}, read } = {}) {
  const calls = [];
  const push = (name, ...args) => calls.push({ name, args });

  async function* iterate(items) {
    yield { items };
  }

  const client = {
    fs: {
      stat: async (arg) => {
        const target = typeof arg === 'string' ? arg : arg.path;
        push('stat', target);
        if (!(target in entries)) throw notFound();
        return entries[target];
      },
      readdir: (arg) => {
        const options = typeof arg === 'string' ? { path: arg } : arg;
        push('readdir', options);
        const items = options.recursive
          ? (deep[options.path] ?? [])
          : (listings[options.path] ?? []);
        if (options.stream) return iterate(items);
        if (options.includeTotal) {
          return Promise.resolve({
            items: items.slice(0, options.limit ?? items.length),
            total: items.length,
          });
        }
        return Promise.resolve(items);
      },
      delete: async (target, options) => push('delete', target, options),
      copy: async (source, destination, options) =>
        push('copy', source, destination, options),
      move: async (source, destination, options) =>
        push('move', source, destination, options),
      rename: async (...args) => push('rename', ...args),
      mkdir: async (target, options) => {
        push('mkdir', target, options);
        return { path: `/u${target.replace(/^~/, '')}` };
      },
      write: async (target, data, options) => {
        push('write', target, data.length, options);
        return { path: target };
      },
      upload: async (items, destination, options) => {
        push('upload', items.map((i) => i.finalPath), destination, options);
      },
      read: read ?? (async () => new Blob([Buffer.from('hello')])),
    },
    apps: {
      list: async () => Object.values(apps),
      get: async (name) => {
        if (!apps[name]) throw notFound();
        return apps[name];
      },
    },
    workers: {
      get: async () => null,
    },
  };
  return { client, calls };
}

const callsOf = (calls, name) => calls.filter((call) => call.name === name);
const firstOf = (calls, name) => callsOf(calls, name)[0];

let out;
let err;

beforeEach(() => {
  out = [];
  err = [];
  vi.spyOn(console, 'log').mockImplementation((line = '') => out.push(String(line)));
  vi.spyOn(console, 'error').mockImplementation((...args) => err.push(args.join(' ')));
});

afterEach(() => {
  vi.restoreAllMocks();
  state.client = null;
});

describe('fs rm', () => {
  it('deletes a file non-recursively — the SDK would recurse by default', async () => {
    const { client, calls } = makeClient({ entries: { '~/a.txt': entry('~/a.txt') } });
    state.client = client;

    await fsRm('puter:/a.txt', {});

    expect(firstOf(calls, 'delete').args).toEqual(['~/a.txt', { recursive: false }]);
  });

  it('refuses a directory without -r, and deletes nothing', async () => {
    const { client, calls } = makeClient({ entries: { '~/dist': dir('~/dist') } });
    state.client = client;

    await expect(fsRm('puter:/dist', {})).rejects.toThrow(/is a directory — pass -r/);
    expect(callsOf(calls, 'delete')).toHaveLength(0);
  });

  it('counts what is about to go before it goes', async () => {
    const { client, calls } = makeClient({
      entries: { '~/dist': dir('~/dist') },
      deep: { '~/dist': [entry('~/dist/a.js'), entry('~/dist/b.js'), dir('~/dist/sub')] },
    });
    state.client = client;

    await fsRm('puter:/dist', { recursive: true, yes: true });

    expect(err.join('\n')).toContain('rm -r puter:/dist → ~/dist (3 entries)');
    expect(firstOf(calls, 'delete').args).toEqual(['~/dist', { recursive: true }]);
  });

  it('refuses the root in both modes', async () => {
    const { client, calls } = makeClient({ entries: { '~': dir('~') } });
    state.client = client;

    await expect(fsRm('puter:/', { recursive: true, yes: true })).rejects.toThrow(
      /whole drive/,
    );
    await expect(
      fsRm('puter:/', { recursive: true, yes: true, app: 'app-1f2e' }),
    ).rejects.toThrow(/all of app-1f2e/);
    expect(callsOf(calls, 'delete')).toHaveLength(0);
  });

  it('will not delete recursively without confirmation when nobody can answer', async () => {
    const { client, calls } = makeClient({
      entries: { '~/dist': dir('~/dist') },
      deep: { '~/dist': [entry('~/dist/a.js')] },
    });
    state.client = client;

    await expect(fsRm('puter:/dist', { recursive: true })).rejects.toThrow(
      /without confirmation/,
    );
    expect(callsOf(calls, 'delete')).toHaveLength(0);
  });

  it('lists instead of deleting on --dry-run', async () => {
    const { client, calls } = makeClient({
      entries: { '~/dist': dir('~/dist') },
      deep: { '~/dist': [entry('~/dist/a.js')] },
    });
    state.client = client;

    await fsRm('puter:/dist', { recursive: true, dryRun: true });

    expect(out).toEqual(['/u/dist/a.js', '/u/dist']);
    expect(callsOf(calls, 'delete')).toHaveLength(0);
  });
});

describe('fs --app', () => {
  it('rebases puter:/ onto the app store and says so', async () => {
    const { client, calls } = makeClient({ entries: {} });
    state.client = client;

    await fsMkdir('puter:/dist', { app: 'app-1f2e', parents: true });

    expect(firstOf(calls, 'mkdir').args).toEqual([
      '~/AppData/app-1f2e/dist',
      { createMissingParents: true, dedupeName: false },
    ]);
    expect(err.join('\n')).toContain('mkdir puter:/dist → ~/AppData/app-1f2e/dist');
  });

  it('resolves an app name to its uid, the way kv connect does', async () => {
    const { client, calls } = makeClient({
      apps: { notes: { name: 'notes', uid: 'app-99' } },
    });
    state.client = client;

    await fsMkdir('puter:/dist', { app: 'notes' });

    expect(firstOf(calls, 'mkdir').args[0]).toBe('~/AppData/app-99/dist');
    expect(err.join('\n')).toContain('[notes (app-99)]');
  });
});

describe('fs cp within the drive', () => {
  it('copies into an existing directory under the same name', async () => {
    const { client, calls } = makeClient({
      entries: { '~/a.txt': entry('~/a.txt'), '~/backup': dir('~/backup') },
    });
    state.client = client;

    await fsCp('puter:/a.txt', 'puter:/backup', {});

    expect(firstOf(calls, 'copy').args).toEqual([
      '~/a.txt',
      '~/backup',
      { overwrite: true, dedupeName: false },
    ]);
  });

  it('splits the new name off a destination that does not exist yet', async () => {
    const { client, calls } = makeClient({ entries: { '~/a.txt': entry('~/a.txt') } });
    state.client = client;

    await fsCp('puter:/a.txt', 'puter:/b.txt', {});

    expect(firstOf(calls, 'copy').args).toEqual([
      '~/a.txt',
      '~',
      { overwrite: true, dedupeName: false, newName: 'b.txt' },
    ]);
  });

  it('skips an existing destination with -n', async () => {
    const { client, calls } = makeClient({
      entries: { '~/a.txt': entry('~/a.txt'), '~/b.txt': entry('~/b.txt') },
    });
    state.client = client;

    // commander reports `--no-clobber` as clobber: false.
    await fsCp('puter:/a.txt', 'puter:/b.txt', { clobber: false });

    expect(callsOf(calls, 'copy')).toHaveLength(0);
    expect(err.join('\n')).toContain('Skipped ~/b.txt (exists)');
  });

  it('refuses a directory source without -r', async () => {
    const { client, calls } = makeClient({ entries: { '~/dist': dir('~/dist') } });
    state.client = client;

    await expect(fsCp('puter:/dist', 'puter:/copy', {})).rejects.toThrow(
      /is a directory — pass -r/,
    );
    expect(callsOf(calls, 'copy')).toHaveLength(0);
  });
});

describe('fs cp across the boundary', () => {
  const tempDirs = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
    }
  });

  function tempFile(name, contents) {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'puter-cli-fs-'));
    tempDirs.push(base);
    const full = path.join(base, name);
    fs.writeFileSync(full, contents);
    return full;
  }

  it('writes a single local file to the remote path it names', async () => {
    const { client, calls } = makeClient({ entries: {} });
    state.client = client;
    const local = tempFile('notes.txt', 'hello');

    await fsCp(local, 'puter:/notes.txt', {});

    expect(firstOf(calls, 'write').args).toEqual([
      '~/notes.txt',
      5,
      { overwrite: true, dedupeName: false, createMissingParents: true },
    ]);
  });

  it('uploads a local file into an existing remote directory', async () => {
    const { client, calls } = makeClient({ entries: { '~/Desktop': dir('~/Desktop') } });
    state.client = client;
    const local = tempFile('notes.txt', 'hello');

    await fsCp(local, 'puter:/Desktop', {});

    expect(firstOf(calls, 'write').args[0]).toBe('~/Desktop/notes.txt');
  });

  it('writes stdout for a remote source and `-`', async () => {
    const { client } = makeClient({ entries: { '~/a.txt': entry('~/a.txt', { size: 5 }) } });
    state.client = client;
    const chunks = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk, cb) => {
      chunks.push(Buffer.from(chunk).toString());
      cb?.();
      return true;
    });

    await fsCp('puter:/a.txt', '-', {});

    expect(chunks.join('')).toBe('hello');
  });

  it('reads stdin into a remote file', async () => {
    const { client, calls } = makeClient({ entries: {} });
    state.client = client;
    const { Readable } = await import('node:stream');
    const stdin = Object.getOwnPropertyDescriptor(process, 'stdin');
    Object.defineProperty(process, 'stdin', {
      value: Readable.from([Buffer.from('piped')]),
      configurable: true,
    });

    try {
      await fsCp('-', 'puter:/from-stdin.txt', {});
    } finally {
      Object.defineProperty(process, 'stdin', stdin);
    }

    expect(firstOf(calls, 'write').args[0]).toBe('~/from-stdin.txt');
    expect(firstOf(calls, 'write').args[1]).toBe(5);
  });
});

describe('fs ls', () => {
  it('emits operands that feed back into another command when piped', async () => {
    const { client } = makeClient({
      entries: { '~/logs': dir('~/logs') },
      listings: { '~/logs': [entry('~/logs/a.log'), dir('~/logs/old')] },
    });
    state.client = client;

    await fsLs('puter:/logs', {});

    expect(out).toEqual(['puter:/logs/a.log', 'puter:/logs/old']);
  });

  it('falls back to the full listing when the SDK cannot stream', async () => {
    const { client } = makeClient({
      listings: { '~/logs': [entry('~/logs/a.log')] },
    });
    // An SDK without a streaming readdir answers the same call with the
    // whole listing instead of an async iterator.
    const inner = client.fs.readdir;
    client.fs.readdir = (arg) => {
      const options = typeof arg === 'string' ? { path: arg } : arg;
      return Promise.resolve(inner({ ...options, stream: false }));
    };
    state.client = client;

    await fsLs('puter:/logs', {});

    expect(out).toEqual(['puter:/logs/a.log']);
  });

  it('lines up type, size and time with -l', async () => {
    const { client } = makeClient({
      listings: {
        '~/logs': [
          entry('~/logs/a.log', { size: 2048 }),
          dir('~/logs/old'),
        ],
      },
    });
    state.client = client;

    await fsLs('puter:/logs', { long: true });

    // The size column is padded to the widest value, so both rows line up.
    expect(out).toHaveLength(2);
    expect(out[0]).toMatch(/^- 2\.0 KB \d{4}-\d{2}-\d{2} \d{2}:\d{2} a\.log$/);
    expect(out[1]).toMatch(/^d {6}- \d{4}-\d{2}-\d{2} \d{2}:\d{2} old\/$/);
  });

  it('gives the whole entry with --json', async () => {
    const { client } = makeClient({
      listings: { '~/logs': [entry('~/logs/a.log')] },
    });
    state.client = client;

    await fsLs('puter:/logs', { json: true });

    expect(JSON.parse(out.join('\n'))).toEqual([entry('~/logs/a.log')]);
  });
});

describe('fs stat and cat', () => {
  it('prints one field per line, and everything with --json', async () => {
    const { client } = makeClient({ entries: { '~/a.txt': entry('~/a.txt') } });
    state.client = client;

    await fsStat('puter:/a.txt', {});
    expect(out[0]).toBe('path:     /u/a.txt');
    expect(out[1]).toBe('type:     file');
    expect(out[2]).toBe('size:     1024 (1.0 KB)');

    out.length = 0;
    await fsStat('puter:/a.txt', { json: true });
    expect(JSON.parse(out.join('\n')).uid).toBe('uid-a.txt');
  });

  it('refuses to cat a directory', async () => {
    const { client } = makeClient({ entries: { '~/dist': dir('~/dist') } });
    state.client = client;

    await expect(fsCat('puter:/dist', {})).rejects.toThrow(/is a directory/);
  });
});

describe('fs mv', () => {
  it('hands the destination to move(), which works out dir vs rename', async () => {
    const { client, calls } = makeClient({ entries: { '~/a.txt': entry('~/a.txt') } });
    state.client = client;

    await fsMv('puter:/a.txt', 'puter:/Desktop/b.txt', {});

    expect(firstOf(calls, 'move').args).toEqual([
      '~/a.txt',
      '~/Desktop/b.txt',
      { overwrite: true, dedupeName: false },
    ]);
    expect(callsOf(calls, 'rename')).toHaveLength(0);
  });

  it('refuses to move the root', async () => {
    const { client, calls } = makeClient({ entries: { '~': dir('~') } });
    state.client = client;

    await expect(fsMv('puter:/', 'puter:/x', {})).rejects.toThrow(/the root itself/);
    expect(callsOf(calls, 'move')).toHaveLength(0);
  });
});
