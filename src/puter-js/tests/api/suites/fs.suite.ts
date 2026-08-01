import { suite } from '../harness/types.ts';
import type { TestContext } from '../harness/types.ts';

const home = (t: TestContext) => `/${t.env.users.user.username}`;

// A 1x1 PNG. Small enough that the browser's thumbnail generator renders it
// well under the size cap, and a real image so the generator doesn't bail.
const TINY_PNG_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/**
 * A file entry shaped like one the GUI hands to `upload` after parsing a
 * drop: the relative path lives on the entry, because `File.name` cannot
 * carry a directory separator (browsers rewrite `/` to `:`).
 */
const droppedFile = (body: string, relativePath: string) => {
    const name = relativePath.slice(relativePath.lastIndexOf('/') + 1);
    const file = new File([body], name, { type: 'text/plain' });
    return Object.assign(file, {
        filepath: relativePath,
        fullPath: relativePath,
    });
};

const tinyPngFile = (name: string) => {
    const binary = atob(TINY_PNG_BASE64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new File([bytes], name, { type: 'image/png' });
};

/**
 * Runs `fn` with the signed batch-write path disabled, so the upload falls
 * through to the legacy `/batch` strategy on every platform. The capability
 * flag is what the SDK itself sets when a backend turns out not to support
 * signed writes, so this exercises the real fallback state.
 */
const withoutSignedBatchWrite = async (
    t: TestContext,
    fn: () => Promise<void>,
) => {
    const fs = t.puter.fs as unknown as Record<string, unknown>;
    const previous = fs.signedBatchWriteSupported;
    fs.signedBatchWriteSupported = false;
    try {
        await fn();
    } finally {
        fs.signedBatchWriteSupported = previous;
    }
};

export default suite('fs', {
    'write creates a file and read returns its content': async (t) => {
        const path = `${home(t)}/fs-suite-roundtrip.txt`;
        await t.puter.fs.write(path, 'hello from the suite');
        const blob = await t.puter.fs.read(path);
        t.assert.equal(await blob.text(), 'hello from the suite');
    },

    'write round-trips binary data intact': async (t) => {
        const path = `${home(t)}/fs-suite-binary.bin`;
        const bytes = new Uint8Array(256);
        for (let i = 0; i < bytes.length; i++) bytes[i] = i;
        await t.puter.fs.write(path, bytes);
        const blob = await t.puter.fs.read(path);
        const roundTripped = new Uint8Array(await blob.arrayBuffer());
        t.assert.equal(roundTripped.length, bytes.length);
        for (let i = 0; i < bytes.length; i++) {
            if (roundTripped[i] !== bytes[i]) {
                t.assert.equal(roundTripped[i], bytes[i], `byte ${i} differs`);
            }
        }
    },

    'write overwrites an existing file by default': async (t) => {
        const path = `${home(t)}/fs-suite-overwrite.txt`;
        await t.puter.fs.write(path, 'first');
        await t.puter.fs.write(path, 'second');
        const blob = await t.puter.fs.read(path);
        t.assert.equal(await blob.text(), 'second');
    },

    'write with dedupeName creates a sibling instead of overwriting': async (t) => {
        const path = `${home(t)}/fs-suite-dedupe.txt`;
        const first = await t.puter.fs.write(path, 'original');
        const second = await t.puter.fs.write(path, 'copy', {
            overwrite: false,
            dedupeName: true,
        });
        t.assert.ok(first.name !== second.name, 'dedupe should pick a new name');
        const blob = await t.puter.fs.read(path);
        t.assert.equal(await blob.text(), 'original');
    },

    'write with createMissingParents builds the directory tree': async (t) => {
        const path = `${home(t)}/fs-suite-deep/a/b/file.txt`;
        await t.puter.fs.write(path, 'nested', { createMissingParents: true });
        const blob = await t.puter.fs.read(path);
        t.assert.equal(await blob.text(), 'nested');
        const dir = await t.puter.fs.stat(`${home(t)}/fs-suite-deep/a/b`);
        t.assert.equal(Boolean(dir.is_dir), true);
    },

    'write handles unicode and spaces in names': async (t) => {
        const path = `${home(t)}/fs suite ünïcödé 文件.txt`;
        await t.puter.fs.write(path, 'unicode content');
        const info = await t.puter.fs.stat(path);
        t.assert.equal(info.name, 'fs suite ünïcödé 文件.txt');
        const blob = await t.puter.fs.read(path);
        t.assert.equal(await blob.text(), 'unicode content');
    },

    'write a ~1MB file round-trips': async (t) => {
        const path = `${home(t)}/fs-suite-large.bin`;
        const bytes = new Uint8Array(1024 * 1024);
        for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
        await t.puter.fs.write(path, bytes);
        const blob = await t.puter.fs.read(path);
        const got = new Uint8Array(await blob.arrayBuffer());
        t.assert.equal(got.length, bytes.length);
        // spot-check a few offsets rather than 1M assertions
        for (const i of [0, 1, 4093, 524287, bytes.length - 1]) {
            t.assert.equal(got[i], bytes[i], `byte ${i} differs`);
        }
    },

    'read of a missing file rejects': async (t) => {
        await t.assert.rejects(
            () => t.puter.fs.read(`${home(t)}/fs-suite-no-such-file.txt`),
            'read of a missing file should reject',
        );
    },

    'stat reports name and type': async (t) => {
        const path = `${home(t)}/fs-suite-stat.txt`;
        await t.puter.fs.write(path, 'stat me');
        const info = await t.puter.fs.stat(path);
        t.assert.equal(info.name, 'fs-suite-stat.txt');
        t.assert.equal(Boolean(info.is_dir), false);
    },

    'stat of a missing path rejects': async (t) => {
        await t.assert.rejects(
            () => t.puter.fs.stat(`${home(t)}/fs-suite-no-such-stat.txt`),
            'stat of a missing path should reject',
        );
    },

    'stat returnSize reports directory size': async (t) => {
        const dir = `${home(t)}/fs-suite-sized-dir`;
        await t.puter.fs.mkdir(dir);
        await t.puter.fs.write(`${dir}/data.txt`, 'twelve bytes');
        const info = await t.puter.fs.stat(dir, { returnSize: true });
        t.assert.equal(typeof info.size, 'number');
        t.assert.ok(info.size >= 12, `dir size ${info.size} should be >= 12`);
    },

    'mkdir creates a directory listable via readdir': async (t) => {
        const dir = `${home(t)}/fs-suite-dir`;
        await t.puter.fs.mkdir(dir);
        await t.puter.fs.write(`${dir}/inside.txt`, 'x');
        const entries = await t.puter.fs.readdir(dir);
        t.assert.equal(entries.length, 1);
        t.assert.equal(entries[0].name, 'inside.txt');
    },

    'mkdir with createMissingParents creates nested dirs': async (t) => {
        const dir = `${home(t)}/fs-suite-mk/x/y/z`;
        await t.puter.fs.mkdir(dir, { createMissingParents: true });
        const info = await t.puter.fs.stat(dir);
        t.assert.equal(Boolean(info.is_dir), true);
    },

    'mkdir over an existing directory is idempotent': async (t) => {
        const dir = `${home(t)}/fs-suite-mk-dup`;
        const first = await t.puter.fs.mkdir(dir);
        const second = await t.puter.fs.mkdir(dir);
        t.assert.equal(second.uid, first.uid, 'should return the same dir');
    },

    'mkdir over an existing file rejects': async (t) => {
        const path = `${home(t)}/fs-suite-mk-over-file`;
        await t.puter.fs.write(path, 'occupied');
        await t.assert.rejects(
            () => t.puter.fs.mkdir(path),
            'mkdir over an existing file should reject',
        );
    },

    'mkdir with dedupeName creates a renamed sibling': async (t) => {
        const dir = `${home(t)}/fs-suite-mk-dedupe`;
        const first = await t.puter.fs.mkdir(dir);
        const second = await t.puter.fs.mkdir(dir, { dedupeName: true });
        t.assert.ok(
            first.name !== second.name,
            'dedupeName should pick a new directory name',
        );
    },

    'readdir with limit keeps the bare array response': async (t) => {
        const dir = `${home(t)}/fs-suite-page-legacy`;
        await t.puter.fs.mkdir(dir);
        for (const n of ['a.txt', 'b.txt', 'c.txt']) {
            await t.puter.fs.write(`${dir}/${n}`, 'x');
        }
        const entries = await t.puter.fs.readdir({ path: dir, limit: 2 });
        t.assert.ok(Array.isArray(entries), 'legacy limit should stay an array');
        t.assert.equal(entries.length, 2);
    },

    'readdir(path, options) applies the options': async (t) => {
        const dir = `${home(t)}/fs-suite-readdir-positional-options`;
        await t.puter.fs.mkdir(dir);
        for (const n of ['a.txt', 'b.txt', 'c.txt']) {
            await t.puter.fs.write(`${dir}/${n}`, 'x');
        }
        const entries = await t.puter.fs.readdir(dir, {
            limit: 2,
            sortBy: 'name',
            sortOrder: 'desc',
        });
        t.assert.deepEqual(
            entries.map((e: { name: string }) => e.name),
            ['c.txt', 'b.txt'],
        );
    },

    'readdir with a cursor pages through a directory': async (t) => {
        const dir = `${home(t)}/fs-suite-page-cursor`;
        await t.puter.fs.mkdir(dir);
        const names = ['a.txt', 'b.txt', 'c.txt', 'd.txt', 'e.txt'];
        for (const n of names) {
            await t.puter.fs.write(`${dir}/${n}`, 'x');
        }
        const seen: string[] = [];
        let cursor: string | null | undefined = null;
        do {
            const page = (await t.puter.fs.readdir({
                path: dir,
                limit: 2,
                cursor,
            })) as { items: Array<{ name: string }>; cursor?: string };
            seen.push(...page.items.map((e) => e.name));
            cursor = page.cursor;
        } while (cursor);
        t.assert.deepEqual(seen, names);
    },

    'readdir with includeTotal reports the directory size': async (t) => {
        const dir = `${home(t)}/fs-suite-page-total`;
        await t.puter.fs.mkdir(dir);
        for (const n of ['a.txt', 'b.txt', 'c.txt']) {
            await t.puter.fs.write(`${dir}/${n}`, 'x');
        }
        const page = (await t.puter.fs.readdir({
            path: dir,
            limit: 1,
            cursor: null,
            includeTotal: true,
        })) as { items: unknown[]; total?: number };
        t.assert.equal(page.items.length, 1);
        t.assert.equal(page.total, 3);
    },

    'readdir with stream iterates pages via for await': async (t) => {
        const dir = `${home(t)}/fs-suite-page-stream`;
        await t.puter.fs.mkdir(dir);
        const names = ['a.txt', 'b.txt', 'c.txt'];
        for (const n of names) {
            await t.puter.fs.write(`${dir}/${n}`, 'x');
        }
        const seen: string[] = [];
        let pages = 0;
        for await (const page of t.puter.fs.readdir({
            path: dir,
            limit: 2,
            stream: true,
        }) as AsyncIterable<{ items: Array<{ name: string }>; cursor?: string }>) {
            pages++;
            t.assert.ok(page.items.length <= 2, 'stream pages respect limit');
            seen.push(...page.items.map((e) => e.name));
        }
        t.assert.ok(pages >= 2, 'stream should yield multiple pages');
        t.assert.deepEqual(seen, names);
    },

    'readdir cursor respects descending name sort': async (t) => {
        const dir = `${home(t)}/fs-suite-page-desc`;
        await t.puter.fs.mkdir(dir);
        for (const n of ['a.txt', 'b.txt', 'c.txt']) {
            await t.puter.fs.write(`${dir}/${n}`, 'x');
        }
        const page = (await t.puter.fs.readdir({
            path: dir,
            limit: 2,
            cursor: null,
            sortBy: 'name',
            sortOrder: 'desc',
        })) as { items: Array<{ name: string }>; cursor?: string };
        t.assert.deepEqual(
            page.items.map((e) => e.name),
            ['c.txt', 'b.txt'],
        );
    },

    'readdir of a missing directory rejects': async (t) => {
        await t.assert.rejects(
            () => t.puter.fs.readdir(`${home(t)}/fs-suite-no-such-dir`),
            'readdir of a missing dir should reject',
        );
    },

    'readdir recursive lists a nested subtree in v1 shape': async (t) => {
        const base = `${home(t)}/fs-suite-recursive`;
        await t.puter.fs.write(`${base}/a/b/deep.txt`, 'x', {
            createMissingParents: true,
        });
        await t.puter.fs.write(`${base}/top.txt`, 'y');

        // depth 1: only direct children
        const shallow = (await t.puter.fs.readdir({
            path: base,
            recursive: true,
            depth: 1,
            cursor: null,
        })) as { items: Array<{ name: string; is_dir: unknown }> };
        const shallowNames = shallow.items.map((e) => e.name).sort();
        t.assert.deepEqual(shallowNames, ['a', 'top.txt']);

        // deeper: descendants appear, and paging terminates
        const seen: string[] = [];
        let cursor: string | null | undefined = null;
        do {
            const page = (await t.puter.fs.readdir({
                path: base,
                recursive: true,
                depth: 5,
                limit: 2,
                cursor,
            })) as {
                items: Array<{ path: string; is_dir: unknown }>;
                cursor?: string;
            };
            seen.push(...page.items.map((e) => e.path));
            cursor = page.cursor;
        } while (cursor);
        const rel = seen.map((p) => p.slice(base.length + 1)).sort();
        t.assert.deepEqual(rel, ['a', 'a/b', 'a/b/deep.txt', 'top.txt']);
    },

    'copy duplicates a file': async (t) => {
        const src = `${home(t)}/fs-suite-copy-src.txt`;
        const dstDir = `${home(t)}/fs-suite-copy-dst`;
        await t.puter.fs.write(src, 'copy me');
        await t.puter.fs.mkdir(dstDir);
        await t.puter.fs.copy(src, dstDir);
        const blob = await t.puter.fs.read(`${dstDir}/fs-suite-copy-src.txt`);
        t.assert.equal(await blob.text(), 'copy me');
        // source still exists
        t.assert.ok(await t.puter.fs.stat(src));
    },

    'copy with newName renames the duplicate': async (t) => {
        const src = `${home(t)}/fs-suite-copy-rename-src.txt`;
        const dstDir = `${home(t)}/fs-suite-copy-rename-dst`;
        await t.puter.fs.write(src, 'renamed copy');
        await t.puter.fs.mkdir(dstDir);
        await t.puter.fs.copy(src, dstDir, { newName: 'renamed.txt' });
        const blob = await t.puter.fs.read(`${dstDir}/renamed.txt`);
        t.assert.equal(await blob.text(), 'renamed copy');
    },

    'copy conflicts by default and renames with dedupeName': async (t) => {
        const src = `${home(t)}/fs-suite-copy-conflict.txt`;
        const dstDir = `${home(t)}/fs-suite-copy-conflict-dst`;
        await t.puter.fs.write(src, 'original');
        await t.puter.fs.mkdir(dstDir);
        await t.puter.fs.copy(src, dstDir);
        await t.assert.rejects(
            () => t.puter.fs.copy(src, dstDir),
            'a second copy under the same name should conflict',
        );
        const deduped = await t.puter.fs.copy(src, dstDir, { dedupeName: true });
        const copied = Array.isArray(deduped) ? deduped[0].copied : deduped;
        t.assert.ok(
            copied.name !== 'fs-suite-copy-conflict.txt',
            `dedupeName should pick a free name, got ${copied.name}`,
        );
    },

    'copy calls the success callback that follows its options': async (t) => {
        const src = `${home(t)}/fs-suite-copy-cb-src.txt`;
        const dstDir = `${home(t)}/fs-suite-copy-cb-dst`;
        await t.puter.fs.write(src, 'copy with callback');
        await t.puter.fs.mkdir(dstDir);
        let callbackArg: unknown;
        const result = await t.puter.fs.copy(src, dstDir, { newName: 'via-callback.txt' }, (value: unknown) => {
            callbackArg = value;
        });
        t.assert.ok(callbackArg, 'success callback should fire');
        t.assert.deepEqual(callbackArg, result);
        const blob = await t.puter.fs.read(`${dstDir}/via-callback.txt`);
        t.assert.equal(await blob.text(), 'copy with callback');
    },

    'move relocates a file': async (t) => {
        const src = `${home(t)}/fs-suite-move-src.txt`;
        const dstDir = `${home(t)}/fs-suite-move-dst`;
        await t.puter.fs.write(src, 'move me');
        await t.puter.fs.mkdir(dstDir);
        await t.puter.fs.move(src, dstDir);
        const blob = await t.puter.fs.read(`${dstDir}/fs-suite-move-src.txt`);
        t.assert.equal(await blob.text(), 'move me');
        await t.assert.rejects(
            () => t.puter.fs.stat(src),
            'moved-away source should no longer stat',
        );
    },

    'move to a full destination path renames the file': async (t) => {
        const src = `${home(t)}/fs-suite-move-rename-src.txt`;
        const dst = `${home(t)}/fs-suite-move-renamed.txt`;
        await t.puter.fs.write(src, 'move+rename');
        await t.puter.fs.move(src, dst);
        const blob = await t.puter.fs.read(dst);
        t.assert.equal(await blob.text(), 'move+rename');
    },

    'rename addresses the item by uid': async (t) => {
        const path = `${home(t)}/fs-suite-rename-uid.txt`;
        const written = await t.puter.fs.write(path, 'rename by uid');
        const renamed = await t.puter.fs.rename({
            uid: written.uid,
            newName: 'fs-suite-renamed-by-uid.txt',
        });
        t.assert.equal(renamed.name, 'fs-suite-renamed-by-uid.txt');
        const blob = await t.puter.fs.read(`${home(t)}/fs-suite-renamed-by-uid.txt`);
        t.assert.equal(await blob.text(), 'rename by uid');
    },

    'rename changes the file name in place': async (t) => {
        const path = `${home(t)}/fs-suite-rename-before.txt`;
        await t.puter.fs.write(path, 'rename me');
        const renamed = await t.puter.fs.rename(path, 'fs-suite-rename-after.txt');
        t.assert.equal(renamed.name, 'fs-suite-rename-after.txt');
        const blob = await t.puter.fs.read(`${home(t)}/fs-suite-rename-after.txt`);
        t.assert.equal(await blob.text(), 'rename me');
    },

    'delete removes a file': async (t) => {
        const path = `${home(t)}/fs-suite-delete.txt`;
        await t.puter.fs.write(path, 'ephemeral');
        await t.puter.fs.delete(path);
        await t.assert.rejects(
            () => t.puter.fs.stat(path),
            'stat of a deleted file should reject',
        );
    },

    'delete recursive removes a directory tree': async (t) => {
        const dir = `${home(t)}/fs-suite-delete-tree`;
        await t.puter.fs.mkdir(dir);
        await t.puter.fs.write(`${dir}/a.txt`, 'a');
        await t.puter.fs.write(`${dir}/b.txt`, 'b');
        await t.puter.fs.delete(dir, { recursive: true });
        await t.assert.rejects(
            () => t.puter.fs.stat(dir),
            'deleted tree should no longer stat',
        );
    },

    'delete descendantsOnly empties a directory but keeps it': async (t) => {
        const dir = `${home(t)}/fs-suite-empty-me`;
        await t.puter.fs.mkdir(dir);
        await t.puter.fs.write(`${dir}/inside.txt`, 'x');
        await t.puter.fs.delete(dir, {
            recursive: true,
            descendantsOnly: true,
        });
        const entries = await t.puter.fs.readdir(dir);
        t.assert.equal(entries.length, 0);
    },

    'delete accepts multiple paths': async (t) => {
        const a = `${home(t)}/fs-suite-multi-a.txt`;
        const b = `${home(t)}/fs-suite-multi-b.txt`;
        await t.puter.fs.write(a, 'a');
        await t.puter.fs.write(b, 'b');
        await t.puter.fs.delete({ paths: [a, b] });
        await t.assert.rejects(() => t.puter.fs.stat(a));
        await t.assert.rejects(() => t.puter.fs.stat(b));
    },

    'delete accepts an array as its first argument': async (t) => {
        const a = `${home(t)}/fs-suite-array-a.txt`;
        const b = `${home(t)}/fs-suite-array-b.txt`;
        await t.puter.fs.write(a, 'a');
        await t.puter.fs.write(b, 'b');
        await t.puter.fs.delete([a, b]);
        await t.assert.rejects(() => t.puter.fs.stat(a));
        await t.assert.rejects(() => t.puter.fs.stat(b));
    },

    'space reports capacity and usage': async (t) => {
        const df = await t.puter.fs.space();
        t.assert.equal(typeof Number(df.capacity), 'number');
        t.assert.ok(Number(df.capacity) > 0, 'capacity should be positive');
        t.assert.ok(Number(df.used) >= 0, 'used should be non-negative');
    },

    'sign returns signed entries for a file': async (t) => {
        const path = `${home(t)}/fs-suite-sign.txt`;
        await t.puter.fs.write(path, 'sign me');
        const info = await t.puter.fs.stat(path);
        const signed = await t.puter.fs.sign(undefined, {
            uid: info.uid,
            action: 'read',
        });
        const item = signed.items ?? signed;
        t.assert.ok(item, 'sign should return a result');
    },

    'getReadURL grants unauthenticated read access': async (t) => {
        const path = `${home(t)}/fs-suite-readurl.txt`;
        await t.puter.fs.write(path, 'public via token');
        const url = await t.puter.fs.getReadURL(path);
        t.assert.ok(url.includes('/token-read'), 'should be a token-read URL');
        // No Authorization header — the token in the URL is the only auth.
        const resp = await fetch(url);
        t.assert.equal(resp.status, 200);
        t.assert.equal(await resp.text(), 'public via token');
    },

    'getReadURL of a directory rejects': async (t) => {
        const dir = `${home(t)}/fs-suite-readurl-dir`;
        await t.puter.fs.mkdir(dir);
        await t.assert.rejects(
            () => t.puter.fs.getReadURL(dir),
            'getReadURL of a directory should reject',
        );
    },

    'upload stores multiple files into a directory': async (t) => {
        const dir = `${home(t)}/fs-suite-upload`;
        await t.puter.fs.mkdir(dir);
        const files = [
            new File(['upload one'], 'up-1.txt', { type: 'text/plain' }),
            new File(['upload two'], 'up-2.txt', { type: 'text/plain' }),
        ];
        await t.puter.fs.upload(files, dir);
        const entries = await t.puter.fs.readdir(dir);
        const names = entries.map((e: { name: string }) => e.name).sort();
        t.assert.deepEqual(names, ['up-1.txt', 'up-2.txt']);
        const blob = await t.puter.fs.read(`${dir}/up-2.txt`);
        t.assert.equal(await blob.text(), 'upload two');
    },

    'upload of a single File resolves to one entry, not an array': async (t) => {
        const dir = `${home(t)}/fs-suite-upload-single`;
        await t.puter.fs.mkdir(dir);
        const result = await t.puter.fs.upload(
            new File(['solo upload'], 'solo.txt', { type: 'text/plain' }),
            dir,
        );
        t.assert.equal(Array.isArray(result), false);
        t.assert.equal(result.name, 'solo.txt');
        const blob = await t.puter.fs.read(`${dir}/solo.txt`);
        t.assert.equal(await blob.text(), 'solo upload');
    },

    'upload of a string writes it to default.txt': async (t) => {
        const dir = `${home(t)}/fs-suite-upload-string`;
        await t.puter.fs.mkdir(dir);
        await t.puter.fs.upload('hello as a string', dir);
        const blob = await t.puter.fs.read(`${dir}/default.txt`);
        t.assert.equal(await blob.text(), 'hello as a string');
    },

    'upload of a Blob uses options.name for the file name': async (t) => {
        const dir = `${home(t)}/fs-suite-upload-blob`;
        await t.puter.fs.mkdir(dir);
        await t.puter.fs.upload(new Blob(['blob contents']), dir, {
            name: 'from-blob.dat',
        });
        const blob = await t.puter.fs.read(`${dir}/from-blob.dat`);
        t.assert.equal(await blob.text(), 'blob contents');
    },

    'upload fires the start and success callbacks with the result': async (t) => {
        const dir = `${home(t)}/fs-suite-upload-callbacks`;
        await t.puter.fs.mkdir(dir);
        let started = false;
        let successArg: { name?: string } | undefined;
        // progress is intentionally not asserted: it is timing-dependent and
        // may not fire for a file small enough to finish within one tick.
        const result = await t.puter.fs.upload(
            new File(['callback file'], 'cb.txt', { type: 'text/plain' }),
            dir,
            {
                start: () => { started = true; },
                success: (items: { name?: string }) => { successArg = items; },
            },
        );
        t.assert.equal(started, true, 'start callback should fire');
        t.assert.equal(successArg?.name, 'cb.txt', 'success should receive the entry');
        t.assert.equal((result as { name?: string }).name, 'cb.txt');
    },

    'upload with dedupeName creates a sibling instead of overwriting': async (t) => {
        const dir = `${home(t)}/fs-suite-upload-dedupe`;
        await t.puter.fs.mkdir(dir);
        const first = await t.puter.fs.upload(
            new File(['original'], 'dupe.txt', { type: 'text/plain' }),
            dir,
        );
        const second = await t.puter.fs.upload(
            new File(['copy'], 'dupe.txt', { type: 'text/plain' }),
            dir,
            { overwrite: false, dedupeName: true },
        );
        t.assert.ok(first.name !== second.name, 'dedupe should pick a new name');
        const blob = await t.puter.fs.read(`${dir}/dupe.txt`);
        t.assert.equal(await blob.text(), 'original');
    },

    'upload to the root directory rejects': async (t) => {
        await t.assert.rejects(
            () => t.puter.fs.upload(
                new File(['nope'], 'nope.txt', { type: 'text/plain' }),
                '/',
            ),
            'uploading to root should reject',
        );
    },

    'upload of an unsupported type rejects with field_invalid': async (t) => {
        const dir = `${home(t)}/fs-suite-upload-invalid`;
        await t.puter.fs.mkdir(dir);
        const err = await t.assert.rejects(
            () => t.puter.fs.upload(12345 as unknown as File, dir),
            'uploading a number should reject',
        );
        t.assert.equal((err as { code?: string })?.code, 'field_invalid');
    },

    'read of a directory rejects': async (t) => {
        const dir = `${home(t)}/fs-suite-read-dir`;
        await t.puter.fs.mkdir(dir);
        await t.assert.rejects(
            () => t.puter.fs.read(dir),
            'reading a directory as a file should reject',
        );
    },

    'stat reports uid, path and size for a file': async (t) => {
        const path = `${home(t)}/fs-suite-stat-fields.txt`;
        await t.puter.fs.write(path, 'twelve bytes');
        const info = await t.puter.fs.stat(path);
        t.assert.ok(info.uid, 'stat should return a uid');
        t.assert.equal(Boolean(info.is_dir), false);
        t.assert.equal(info.name, 'fs-suite-stat-fields.txt');
        t.assert.ok(info.path.endsWith('fs-suite-stat-fields.txt'));
        t.assert.equal(Number(info.size), 'twelve bytes'.length);
    },

    'copy into a missing destination directory rejects': async (t) => {
        const src = `${home(t)}/fs-suite-copy-src.txt`;
        await t.puter.fs.write(src, 'copy me');
        await t.assert.rejects(
            () => t.puter.fs.copy(src, `${home(t)}/fs-suite-copy-nope`),
            'copy into a nonexistent directory should reject',
        );
    },

    // -- write argument shapes --

    'write with no data creates an empty file': async (t) => {
        const path = `${home(t)}/fs-suite-write-empty.txt`;
        const written = await t.puter.fs.write(path);
        t.assert.equal(written.name, 'fs-suite-write-empty.txt');
        const info = await t.puter.fs.stat(path);
        t.assert.equal(Number(info.size), 0);
        const blob = await t.puter.fs.read(path);
        t.assert.equal(await blob.text(), '');
    },

    'write of a lone File names the file after itself': async (t) => {
        const file = new File(['from the file itself'], 'fs-suite-lone-file.txt', {
            type: 'text/plain',
        });
        const written = await t.puter.fs.write(file);
        t.assert.equal(written.name, 'fs-suite-lone-file.txt');
        const blob = await t.puter.fs.read(`${home(t)}/fs-suite-lone-file.txt`);
        t.assert.equal(await blob.text(), 'from the file itself');
    },

    'write accepts an ArrayBuffer': async (t) => {
        const path = `${home(t)}/fs-suite-write-arraybuffer.bin`;
        const buffer = new Uint8Array([1, 2, 3, 4, 250]).buffer;
        await t.puter.fs.write(path, buffer);
        const got = new Uint8Array(await (await t.puter.fs.read(path)).arrayBuffer());
        t.assert.deepEqual(Array.from(got), [1, 2, 3, 4, 250]);
    },

    'write accepts a Blob and keeps the path name': async (t) => {
        const path = `${home(t)}/fs-suite-write-blob.txt`;
        await t.puter.fs.write(path, new Blob(['blob body'], { type: 'text/plain' }));
        const info = await t.puter.fs.stat(path);
        t.assert.equal(info.name, 'fs-suite-write-blob.txt');
        t.assert.equal(await (await t.puter.fs.read(path)).text(), 'blob body');
    },

    'write without a target path rejects with NO_TARGET_PATH': async (t) => {
        const err = await t.assert.rejects(
            () => (t.puter.fs.write as (p: string) => Promise<unknown>)(''),
            'an empty target path should reject',
        );
        t.assert.equal((err as { code?: string })?.code, 'NO_TARGET_PATH');
        t.assert.equal((err as { message?: string })?.message, 'No target path provided.');
    },

    'write of an unsupported data type rejects with field_invalid': async (t) => {
        const err = await t.assert.rejects(
            () =>
                (t.puter.fs.write as (p: string, d: unknown) => Promise<unknown>)(
                    `${home(t)}/fs-suite-write-number.txt`,
                    12345,
                ),
            'writing a number should reject',
        );
        t.assert.equal((err as { code?: string })?.code, 'field_invalid');
    },

    'write to a relative path lands under the user home': async (t) => {
        await t.puter.fs.write('fs-suite-relative.txt', 'relative write');
        const info = await t.puter.fs.stat(`${home(t)}/fs-suite-relative.txt`);
        t.assert.equal(info.name, 'fs-suite-relative.txt');
        // Reading it back by the same relative path resolves identically.
        const blob = await t.puter.fs.read('fs-suite-relative.txt');
        t.assert.equal(await blob.text(), 'relative write');
    },

    // -- upload edge cases --

    'upload of a zero-byte file creates an empty file': async (t) => {
        const dir = `${home(t)}/fs-suite-upload-empty`;
        await t.puter.fs.mkdir(dir);
        const result = await t.puter.fs.upload(
            new File([], 'zero.bin', { type: 'application/octet-stream' }),
            dir,
        );
        t.assert.equal(result.name, 'zero.bin');
        const info = await t.puter.fs.stat(`${dir}/zero.bin`);
        t.assert.equal(Number(info.size), 0);
        t.assert.equal(await (await t.puter.fs.read(`${dir}/zero.bin`)).text(), '');
    },

    'upload of more files than the concurrency window stores them all': async (t) => {
        const dir = `${home(t)}/fs-suite-upload-many`;
        await t.puter.fs.mkdir(dir);
        // Ten files span more than one file-upload concurrency chunk.
        const files = Array.from({ length: 10 }, (_unused, i) =>
            new File([`body ${i}`.repeat(i + 1)], `many-${i}.txt`, {
                type: 'text/plain',
            }),
        );
        const result = await t.puter.fs.upload(files, dir);
        t.assert.equal(Array.isArray(result), true);
        t.assert.equal((result as unknown[]).length, 10);
        const entries = await t.puter.fs.readdir(dir);
        t.assert.equal(entries.length, 10);
        t.assert.equal(
            await (await t.puter.fs.read(`${dir}/many-3.txt`)).text(),
            'body 3'.repeat(4),
        );
    },

    // Directory uploads only work on the signed batch-write path. The legacy
    // `/batch` fallback (node, workers) sends a mkdir operation the backend
    // does not accept, so these are pinned where the behaviour is correct
    // rather than asserted everywhere and quietly relaxed. What the legacy
    // path does instead is asserted below, in the legacy upload tests.
    'upload of parsed drop entries creates the dropped directory tree': {
        platforms: ['browser'],
        fn: async (t) => {
            const dir = `${home(t)}/fs-suite-upload-drop`;
            await t.puter.fs.mkdir(dir);
            await t.puter.fs.upload(
                [
                    { isDirectory: true, fullPath: 'dropped' },
                    droppedFile('inside the dropped dir', 'dropped/inside.txt'),
                ] as never,
                dir,
                { parsedDataTransferItems: true },
            );
            t.assert.equal(
                Boolean((await t.puter.fs.stat(`${dir}/dropped`)).is_dir),
                true,
            );
            t.assert.equal(
                await (await t.puter.fs.read(`${dir}/dropped/inside.txt`)).text(),
                'inside the dropped dir',
            );
        },
    },

    'upload with createFileParent builds the directories the files sit in': {
        platforms: ['browser'],
        fn: async (t) => {
            const dir = `${home(t)}/fs-suite-upload-parents`;
            await t.puter.fs.mkdir(dir);
            await t.puter.fs.upload(
                [
                    droppedFile('leaf a', 'nested/a.txt'),
                    droppedFile('leaf b', 'nested/deep/b.txt'),
                ] as never,
                dir,
                { parsedDataTransferItems: true, createFileParent: true },
            );
            t.assert.equal(
                Boolean((await t.puter.fs.stat(`${dir}/nested/deep`)).is_dir),
                true,
            );
            t.assert.equal(
                await (await t.puter.fs.read(`${dir}/nested/a.txt`)).text(),
                'leaf a',
            );
            t.assert.equal(
                await (await t.puter.fs.read(`${dir}/nested/deep/b.txt`)).text(),
                'leaf b',
            );
        },
    },

    'upload skips .DS_Store entries': async (t) => {
        const dir = `${home(t)}/fs-suite-upload-dsstore`;
        await t.puter.fs.mkdir(dir);
        await t.puter.fs.upload(
            [
                new File(['keep me'], 'keep.txt', { type: 'text/plain' }),
                new File(['junk'], '.DS_Store', { type: 'text/plain' }),
            ],
            dir,
        );
        const names = (await t.puter.fs.readdir(dir)).map(
            (e: { name: string }) => e.name,
        );
        t.assert.deepEqual(names, ['keep.txt']);
    },

    'upload of nothing but .DS_Store rejects with EMPTY_UPLOAD': async (t) => {
        const dir = `${home(t)}/fs-suite-upload-only-dsstore`;
        await t.puter.fs.mkdir(dir);
        const err = await t.assert.rejects(
            () =>
                t.puter.fs.upload(
                    [new File(['junk'], '.DS_Store', { type: 'text/plain' })],
                    dir,
                ),
            'an upload with nothing left to send should reject',
        );
        t.assert.equal((err as { code?: string })?.code, 'EMPTY_UPLOAD');
        t.assert.equal(
            (err as { message?: string })?.message,
            'No files or directories to upload.',
        );
    },

    'upload calls the error callback and rejects with the same error': async (t) => {
        const dir = `${home(t)}/fs-suite-upload-error-cb`;
        await t.puter.fs.mkdir(dir);
        let callbackArg: { code?: string } | undefined;
        const err = await t.assert.rejects(
            () =>
                t.puter.fs.upload(12345 as unknown as File, dir, {
                    error: (e: { code?: string }) => { callbackArg = e; },
                }),
            'an invalid upload should reject',
        );
        t.assert.equal(callbackArg?.code, 'field_invalid');
        t.assert.equal((err as { code?: string })?.code, 'field_invalid');
    },

    'upload init receives the operation id and the request handle': async (t) => {
        const dir = `${home(t)}/fs-suite-upload-init`;
        await t.puter.fs.mkdir(dir);
        let operationId: string | undefined;
        let requestHandle: unknown;
        await t.puter.fs.upload(
            new File(['init hook'], 'init.txt', { type: 'text/plain' }),
            dir,
            {
                init: (id: string, xhr: unknown) => {
                    operationId = id;
                    requestHandle = xhr;
                },
            },
        );
        t.assert.equal(typeof operationId, 'string');
        t.assert.equal(
            /^[0-9a-f-]{36}$/.test(operationId ?? ''),
            true,
            `operation id should be a uuid, got ${operationId}`,
        );
        t.assert.ok(requestHandle, 'init should receive the request object');
    },

    // A directory upload on the legacy `/batch` path cannot work: the mkdir
    // operation and the `$dir_N`-relative file paths the SDK sends are not a
    // shape the backend understands. What must not happen is the upload
    // reporting success while writing nothing.
    'upload of a directory through the legacy batch path rejects': async (t) => {
        const dir = `${home(t)}/fs-suite-upload-legacy-dir`;
        await t.puter.fs.mkdir(dir);
        await withoutSignedBatchWrite(t, async () => {
            const err = (await t.assert.rejects(
                () =>
                    t.puter.fs.upload(
                        [
                            { isDirectory: true, fullPath: 'legacy-dropped' },
                            droppedFile('inside', 'legacy-dropped/inside.txt'),
                        ] as never,
                        dir,
                        { parsedDataTransferItems: true },
                    ),
                'a legacy-path directory upload should reject',
            )) as {
                code?: string;
                message?: string;
                failedCount?: number;
                totalCount?: number;
                results?: unknown[];
            };
            t.assert.equal(err.code, 'batch_upload_failed');
            t.assert.ok(
                (err.message ?? '').startsWith('Upload failed:'),
                `unexpected message: ${err.message}`,
            );
            // Every operation failed, and the per-item results ride along.
            t.assert.equal(err.failedCount, 2);
            t.assert.equal(err.totalCount, 2);
            t.assert.equal((err.results ?? []).length, 2);
        });
        // Nothing was written, which is why resolving here was wrong.
        t.assert.deepEqual(await t.puter.fs.readdir(dir), []);
    },

    'upload through the legacy batch path rejects when only some operations fail': async (t) => {
        const dir = `${home(t)}/fs-suite-upload-legacy-partial`;
        await t.puter.fs.mkdir(dir);
        await t.puter.fs.write(`${dir}/taken.txt`, 'already here');
        await withoutSignedBatchWrite(t, async () => {
            const err = (await t.assert.rejects(
                () =>
                    t.puter.fs.upload(
                        [
                            new File(['rejected body'], 'taken.txt', {
                                type: 'text/plain',
                            }),
                            new File(['fresh body'], 'fresh.txt', {
                                type: 'text/plain',
                            }),
                        ],
                        dir,
                        { dedupeName: false, overwrite: false },
                    ),
                'a legacy upload with one failed operation should reject',
            )) as {
                code?: string;
                failedCount?: number;
                totalCount?: number;
                failedItems?: Array<{ code?: string }>;
            };
            t.assert.equal(err.code, 'batch_upload_partially_failed');
            t.assert.equal(err.failedCount, 1);
            t.assert.equal(err.totalCount, 2);
            t.assert.equal(
                err.failedItems?.[0]?.code,
                'item_with_same_name_exists',
            );
        });
        // The operation that did succeed still landed — the rejection reports
        // the partial outcome, it doesn't roll anything back.
        t.assert.equal(
            await (await t.puter.fs.read(`${dir}/taken.txt`)).text(),
            'already here',
        );
        t.assert.equal(
            await (await t.puter.fs.read(`${dir}/fresh.txt`)).text(),
            'fresh body',
        );
    },

    'upload through the legacy batch path stores every file': async (t) => {
        const dir = `${home(t)}/fs-suite-upload-legacy`;
        await t.puter.fs.mkdir(dir);
        await withoutSignedBatchWrite(t, async () => {
            const result = await t.puter.fs.upload(
                [
                    new File(['legacy one'], 'one.txt', { type: 'text/plain' }),
                    new File(['legacy two'], 'two.txt', { type: 'text/plain' }),
                ],
                dir,
            );
            t.assert.equal(Array.isArray(result), true);
            t.assert.equal((result as unknown[]).length, 2);
        });
        t.assert.equal(
            await (await t.puter.fs.read(`${dir}/one.txt`)).text(),
            'legacy one',
        );
        t.assert.equal(
            await (await t.puter.fs.read(`${dir}/two.txt`)).text(),
            'legacy two',
        );
    },

    'upload through the legacy batch path reports progress and completes': async (t) => {
        const dir = `${home(t)}/fs-suite-upload-legacy-progress`;
        await t.puter.fs.mkdir(dir);
        const reported: Array<[string, number]> = [];
        await withoutSignedBatchWrite(t, async () => {
            await t.puter.fs.upload(
                new File(['x'.repeat(256 * 1024)], 'progress.bin', {
                    type: 'application/octet-stream',
                }),
                dir,
                {
                    progress: (operationId: string, percent: string) => {
                        reported.push([operationId, Number(percent)]);
                    },
                },
            );
        });
        // Progress ticks are timing-dependent, so only their shape is pinned:
        // every reported value must be a percentage of this operation.
        for (const [, percent] of reported) {
            t.assert.equal(
                Number.isFinite(percent) && percent >= 0 && percent <= 100,
                true,
                `progress ${percent} should be a percentage`,
            );
        }
        t.assert.equal(
            Number((await t.puter.fs.stat(`${dir}/progress.bin`)).size),
            256 * 1024,
        );
    },

    'upload of a file past the single-shot limit round-trips intact': async (t) => {
        const dir = `${home(t)}/fs-suite-upload-multipart`;
        await t.puter.fs.mkdir(dir);
        // Above the single-PUT ceiling, so the signed path switches to a
        // multipart upload and the bytes cross several part boundaries.
        const size = 11 * 1024 * 1024;
        const bytes = new Uint8Array(size);
        for (let i = 0; i < size; i++) bytes[i] = i % 251;
        await t.puter.fs.upload(
            new File([bytes], 'multipart.bin', {
                type: 'application/octet-stream',
            }),
            dir,
        );
        t.assert.equal(
            Number((await t.puter.fs.stat(`${dir}/multipart.bin`)).size),
            size,
        );
        const got = new Uint8Array(
            await (await t.puter.fs.read(`${dir}/multipart.bin`)).arrayBuffer(),
        );
        t.assert.equal(got.length, size);
        // Spot-check around the 5MB part boundaries rather than every byte.
        for (const i of [0, 5 * 1024 * 1024 - 1, 5 * 1024 * 1024, 10 * 1024 * 1024, size - 1]) {
            t.assert.equal(got[i], bytes[i], `byte ${i} differs`);
        }
    },

    'write refuses to clobber an existing name without overwrite or dedupe': async (t) => {
        const path = `${home(t)}/fs-suite-conflict.txt`;
        await t.puter.fs.write(path, 'the original');
        const err = await t.assert.rejects(
            () =>
                t.puter.fs.write(path, 'the intruder', {
                    overwrite: false,
                    dedupeName: false,
                }),
            'a conflicting write should reject',
        );
        t.assert.ok(err && typeof err === 'object', 'error should be structured');
        t.assert.equal(
            typeof (err as { message?: string }).message,
            'string',
            'error should carry a message',
        );
        // The original must survive a rejected write.
        t.assert.equal(await (await t.puter.fs.read(path)).text(), 'the original');
    },

    // Aborting is only wired up on the signed path; the legacy `/batch`
    // fallback tears down its request without settling the upload promise.
    'upload aborts through the request handle': {
        platforms: ['browser'],
        fn: async (t) => {
            const dir = `${home(t)}/fs-suite-upload-abort`;
            await t.puter.fs.mkdir(dir);
            let handle: { abort: () => void } | undefined;
            let abortedOperationId: string | undefined;
            let initOperationId: string | undefined;
            const err = await t.assert.rejects(
                () =>
                    t.puter.fs.upload(
                        new File(['never lands'], 'aborted.txt', {
                            type: 'text/plain',
                        }),
                        dir,
                        {
                            init: (id: string, xhr: { abort: () => void }) => {
                                initOperationId = id;
                                handle = xhr;
                            },
                            start: () => { handle?.abort(); },
                            abort: (id: string) => { abortedOperationId = id; },
                        },
                    ),
                'an aborted upload should reject',
            );
            t.assert.equal((err as { aborted?: boolean })?.aborted, true);
            t.assert.equal(abortedOperationId, initOperationId);
            const entries = await t.puter.fs.readdir(dir);
            t.assert.equal(entries.length, 0, 'nothing should have landed');
        },
    },

    'upload creates a shortcut when shortcutTo is given': async (t) => {
        const dir = `${home(t)}/fs-suite-upload-shortcut`;
        await t.puter.fs.mkdir(dir);
        const target = await t.puter.fs.write(
            `${home(t)}/fs-suite-shortcut-target.txt`,
            'the real file',
        );
        await t.puter.fs.upload(
            new File([''], 'link.txt', { type: 'text/plain' }),
            dir,
            { shortcutTo: target.uid },
        );
        const info = await t.puter.fs.stat(`${dir}/link.txt`);
        t.assert.equal(info.name, 'link.txt');
        t.assert.equal(Number(info.is_shortcut), 1);
        t.assert.equal(Number(info.size), 0, 'a shortcut stores no content');
        // Shortcuts are pointers: the content lives at the target, and the
        // backend refuses a direct read through the link.
        const err = await t.assert.rejects(
            () => t.puter.fs.read(`${dir}/link.txt`),
            'reading through a shortcut should reject',
        );
        t.assert.equal(
            (err as { code?: string })?.code,
            'shortcut_target_not_found',
        );
    },

    // -- thumbnails --

    'upload runs a caller-supplied thumbnail generator per file': async (t) => {
        const dir = `${home(t)}/fs-suite-thumb-custom`;
        await t.puter.fs.mkdir(dir);
        const generatedFor: string[] = [];
        await t.puter.fs.upload(
            [
                new File(['a'], 'thumb-a.txt', { type: 'text/plain' }),
                new File(['bb'], 'thumb-b.txt', { type: 'text/plain' }),
            ],
            dir,
            {
                thumbnailGenerator: async (file: File) => {
                    generatedFor.push(file.name);
                    return `data:image/png;base64,${TINY_PNG_BASE64}`;
                },
            },
        );
        t.assert.deepEqual([...generatedFor].sort(), [
            'thumb-a.txt',
            'thumb-b.txt',
        ]);
        t.assert.equal(await (await t.puter.fs.read(`${dir}/thumb-a.txt`)).text(), 'a');
    },

    'upload survives a thumbnail generator that throws': async (t) => {
        const dir = `${home(t)}/fs-suite-thumb-throws`;
        await t.puter.fs.mkdir(dir);
        await t.puter.fs.upload(
            new File(['still uploaded'], 'resilient.txt', { type: 'text/plain' }),
            dir,
            {
                thumbnailGenerator: async () => {
                    throw new Error('thumbnail generation exploded');
                },
            },
        );
        t.assert.equal(
            await (await t.puter.fs.read(`${dir}/resilient.txt`)).text(),
            'still uploaded',
        );
    },

    'upload drops a thumbnail that exceeds the size cap': async (t) => {
        const dir = `${home(t)}/fs-suite-thumb-oversized`;
        await t.puter.fs.mkdir(dir);
        // Over the 2MB cap once base64 is decoded, so it is dropped rather
        // than shipped with the file.
        const oversized = `data:image/png;base64,${'A'.repeat(3 * 1024 * 1024)}`;
        await t.puter.fs.upload(
            new File(['payload survives'], 'big-thumb.txt', { type: 'text/plain' }),
            dir,
            { thumbnail: oversized },
        );
        t.assert.equal(
            await (await t.puter.fs.read(`${dir}/big-thumb.txt`)).text(),
            'payload survives',
        );
    },

    'upload with generateThumbnails handles image and non-image files': async (t) => {
        const dir = `${home(t)}/fs-suite-thumb-default`;
        await t.puter.fs.mkdir(dir);
        const result = await t.puter.fs.upload(
            [tinyPngFile('pixel.png'), new File(['plain'], 'plain.txt', { type: 'text/plain' })],
            dir,
            { generateThumbnails: true },
        );
        t.assert.equal((result as unknown[]).length, 2);
        const names = (await t.puter.fs.readdir(dir))
            .map((e: { name: string }) => e.name)
            .sort();
        t.assert.deepEqual(names, ['pixel.png', 'plain.txt']);
        t.assert.equal(
            await (await t.puter.fs.read(`${dir}/plain.txt`)).text(),
            'plain',
        );
    },

    // -- stat / readdir options --

    'stat by uid returns the same entry as stat by path': async (t) => {
        const path = `${home(t)}/fs-suite-stat-by-uid.txt`;
        const written = await t.puter.fs.write(path, 'by uid');
        const byUid = await t.puter.fs.stat({ uid: written.uid });
        t.assert.equal(byUid.name, 'fs-suite-stat-by-uid.txt');
        t.assert.equal(byUid.uid, written.uid);
    },

    'stat with eventual consistency serves the cached entry': async (t) => {
        const path = `${home(t)}/fs-suite-stat-cached.txt`;
        await t.puter.fs.write(path, 'cache me');
        const fresh = await t.puter.fs.stat(path);
        const cached = await t.puter.fs.stat(path, { consistency: 'eventual' });
        t.assert.equal(cached.uid, fresh.uid);
        t.assert.equal(cached.name, 'fs-suite-stat-cached.txt');
    },

    'stat returnPermissions and returnVersions widen the response': async (t) => {
        const path = `${home(t)}/fs-suite-stat-extras.txt`;
        await t.puter.fs.write(path, 'extras');
        const info = await t.puter.fs.stat(path, {
            returnPermissions: true,
            returnVersions: true,
            returnSubdomains: true,
        });
        t.assert.equal(info.name, 'fs-suite-stat-extras.txt');
        t.assert.equal(Array.isArray(info.subdomains), true);
        t.assert.equal(Array.isArray(info.versions), true);
    },

    'stat fires the trailing success callback': async (t) => {
        const path = `${home(t)}/fs-suite-stat-callback.txt`;
        await t.puter.fs.write(path, 'callback');
        let seen: { name?: string } | undefined;
        const info = await (
            t.puter.fs.stat as (
                p: string,
                s: (v: { name?: string }) => void,
            ) => Promise<{ name: string }>
        )(path, (value) => { seen = value; });
        t.assert.equal(seen?.name, 'fs-suite-stat-callback.txt');
        t.assert.equal(info.name, 'fs-suite-stat-callback.txt');
    },

    'readdir by uid lists the directory': async (t) => {
        const dir = `${home(t)}/fs-suite-readdir-by-uid`;
        const created = await t.puter.fs.mkdir(dir);
        await t.puter.fs.write(`${dir}/inside.txt`, 'x');
        const entries = await t.puter.fs.readdir({ uid: created.uid });
        t.assert.equal(entries.length, 1);
        t.assert.equal(entries[0].name, 'inside.txt');
    },

    'readdir without a path or uid rejects with NO_PATH_OR_UID': async (t) => {
        const err = await t.assert.rejects(
            () => t.puter.fs.readdir({} as never),
            'readdir with neither path nor uid should reject',
        );
        t.assert.equal((err as { code?: string })?.code, 'NO_PATH_OR_UID');
        t.assert.equal(
            (err as { message?: string })?.message,
            'Either path or uid must be provided.',
        );
    },

    'readdir stream rejects offset and a pathless stream client-side': async (t) => {
        const dir = `${home(t)}/fs-suite-readdir-stream-guards`;
        await t.puter.fs.mkdir(dir);
        let offsetError: { code?: string } | undefined;
        try {
            t.puter.fs.readdir({ path: dir, stream: true, offset: 1 } as never);
        } catch (e) {
            offsetError = e as { code?: string };
        }
        t.assert.equal(offsetError?.code, 'invalid_request');

        let pathlessError: { code?: string } | undefined;
        try {
            t.puter.fs.readdir({ stream: true } as never);
        } catch (e) {
            pathlessError = e as { code?: string };
        }
        t.assert.equal(pathlessError?.code, 'NO_PATH_OR_UID');
    },

    'readdir with an offset skips the leading entries': async (t) => {
        const dir = `${home(t)}/fs-suite-readdir-offset`;
        await t.puter.fs.mkdir(dir);
        for (const n of ['a.txt', 'b.txt', 'c.txt']) {
            await t.puter.fs.write(`${dir}/${n}`, 'x');
        }
        const entries = await t.puter.fs.readdir({
            path: dir,
            offset: 1,
            limit: 10,
            sortBy: 'name',
            sortOrder: 'asc',
        });
        t.assert.deepEqual(
            entries.map((e: { name: string }) => e.name),
            ['b.txt', 'c.txt'],
        );
    },

    'readdir fires the trailing success callback with the listing': async (t) => {
        const dir = `${home(t)}/fs-suite-readdir-callback`;
        await t.puter.fs.mkdir(dir);
        await t.puter.fs.write(`${dir}/only.txt`, 'x');
        let seen: Array<{ name: string }> | undefined;
        await (
            t.puter.fs.readdir as (
                p: string,
                s: (v: Array<{ name: string }>) => void,
            ) => Promise<unknown>
        )(dir, (value) => { seen = value; });
        t.assert.equal(seen?.length, 1);
        t.assert.equal(seen?.[0].name, 'only.txt');
    },

    'readdir maps AppData entries onto the v1 shape': async (t) => {
        const appDir = `${home(t)}/AppData/fs-suite-app/inner`;
        await t.puter.fs.mkdir(appDir, { createMissingParents: true });
        await t.puter.fs.write(`${appDir}/data.json`, '{}');
        const entries = await t.puter.fs.readdir(appDir);
        t.assert.equal(entries.length, 1);
        const entry = entries[0] as Record<string, unknown>;
        t.assert.equal(entry.name, 'data.json');
        t.assert.equal(entry.appdata_app, 'fs-suite-app');
        t.assert.equal(entry.dirname, appDir);
        t.assert.equal(entry.dirpath, appDir);
        t.assert.equal(entry.is_dir, false);
        t.assert.equal(entry.is_shortcut, 0);
        t.assert.equal(entry.is_symlink, 0);
        t.assert.equal(entry.writable, true);
        t.assert.deepEqual(entry.subdomains, []);
        t.assert.equal(entry.has_website, false);
        t.assert.equal(entry.uid, entry.uuid);
    },

    // -- read options --

    'read with cache true still returns the content': async (t) => {
        const path = `${home(t)}/fs-suite-read-cached.txt`;
        await t.puter.fs.write(path, 'cacheable');
        const blob = await t.puter.fs.read(path, { cache: true });
        t.assert.equal(await blob.text(), 'cacheable');
    },

    // -- sign / readdirSubdomains --

    'sign returns an array when several items are signed': async (t) => {
        const first = await t.puter.fs.write(`${home(t)}/fs-suite-sign-a.txt`, 'a');
        const second = await t.puter.fs.write(`${home(t)}/fs-suite-sign-b.txt`, 'b');
        const signed = await t.puter.fs.sign(undefined, [
            { uid: first.uid, action: 'read' },
            { uid: second.uid, action: 'read' },
        ]);
        t.assert.equal(Array.isArray(signed.items), true);
        t.assert.equal(signed.items.length, 2);
        t.assert.deepEqual(
            signed.items.map((s: { path: string }) => s.path).sort(),
            [
                `${home(t)}/fs-suite-sign-a.txt`,
                `${home(t)}/fs-suite-sign-b.txt`,
            ],
        );
    },

    'readdirSubdomains rejects an empty directory_ids list': async (t) => {
        const err = await t.assert.rejects(
            () => t.puter.fs.readdirSubdomains({ directory_ids: [] }),
            'readdirSubdomains with no ids should reject',
        );
        t.assert.equal(
            (err as { message?: string })?.message,
            'directory_ids must be a non-empty array',
        );
    },

    'readdir reports a shortcut with its target in the v1 shape': async (t) => {
        const dir = `${home(t)}/fs-suite-readdir-shortcut`;
        await t.puter.fs.mkdir(dir);
        const target = await t.puter.fs.write(
            `${home(t)}/fs-suite-readdir-shortcut-target.txt`,
            'pointed at',
        );
        await t.puter.fs.upload(
            new File([''], 'pointer.txt', { type: 'text/plain' }),
            dir,
            { shortcutTo: target.uid },
        );
        const entries = await t.puter.fs.readdir(dir);
        const entry = entries[0] as Record<string, unknown>;
        t.assert.equal(entry.name, 'pointer.txt');
        t.assert.equal(entry.is_shortcut, 1);
        t.assert.ok(entry.shortcut_to, 'the shortcut target should be reported');
        t.assert.equal(entry.is_symlink, 0);
        t.assert.equal(entry.symlink_path, null);
    },

    'write to a tilde path resolves against the user home': async (t) => {
        await t.puter.fs.write('~/fs-suite-tilde.txt', 'tilde write');
        const info = await t.puter.fs.stat(`${home(t)}/fs-suite-tilde.txt`);
        t.assert.equal(info.name, 'fs-suite-tilde.txt');
        t.assert.equal(
            await (await t.puter.fs.read('~/fs-suite-tilde.txt')).text(),
            'tilde write',
        );
    },

    'upload strips a leading slash from a drop entry path': async (t) => {
        const dir = `${home(t)}/fs-suite-upload-leading-slash`;
        await t.puter.fs.mkdir(dir);
        // A drop entry's path is relative to the drop target even when it
        // arrives root-anchored, so the slash must not escape `dir`.
        await t.puter.fs.upload(
            [droppedFile('rooted entry', '/leading.txt')] as never,
            dir,
            { parsedDataTransferItems: true },
        );
        const names = (await t.puter.fs.readdir(dir)).map(
            (e: { name: string }) => e.name,
        );
        t.assert.deepEqual(names, ['leading.txt']);
        t.assert.equal(
            await (await t.puter.fs.read(`${dir}/leading.txt`)).text(),
            'rooted entry',
        );
    },

    'the filesystem module exposes its cache maintenance helpers': async (t) => {
        const fs = t.puter.fs as unknown as {
            getCacheTimestamp: () => Promise<number>;
            invalidateCache: () => void;
            startCacheUpdateTimer: () => void;
            stopCacheUpdateTimer: () => void;
        };
        const timestamp = await fs.getCacheTimestamp();
        t.assert.equal(typeof timestamp, 'number');
        t.assert.ok(timestamp > 0, 'the server should report a cache timestamp');

        const path = `${home(t)}/fs-suite-cache-helpers.txt`;
        await t.puter.fs.write(path, 'cached then dropped');
        await t.puter.fs.stat(path);
        fs.invalidateCache();
        // With the cache emptied, an eventual-consistency read has to go back
        // to the server, and still finds the file.
        const info = await t.puter.fs.stat(path, { consistency: 'eventual' });
        t.assert.equal(info.name, 'fs-suite-cache-helpers.txt');

        // Outside the desktop the periodic refresh is a no-op, and stopping a
        // timer that never started is safe.
        fs.startCacheUpdateTimer();
        fs.stopCacheUpdateTimer();
    },

    // -- FSItem --

    'FSItem exposes the entry fields a stat result carries': async (t) => {
        const path = `${home(t)}/fs-suite-fsitem-fields.txt`;
        const written = await t.puter.fs.write(path, 'fsitem fields');
        const info = await t.puter.fs.stat(path);
        // Building an item from an unsigned entry must work: stat results
        // carry no read or write URL to derive a signature from.
        const item = new t.puter.fs.FSItem(info);
        t.assert.equal(item.name, 'fs-suite-fsitem-fields.txt');
        t.assert.equal(item.path, info.path);
        t.assert.equal(item.uid, written.uid);
        t.assert.equal(item.id, written.uid);
        t.assert.equal(item.uuid, written.uid);
        t.assert.equal(item.isDir, false);
        t.assert.equal(item.isDirectory, false);
        t.assert.equal(Number(item.size), 'fsitem fields'.length);
    },

    'FSItem accepts the legacy fsentry_ spellings': async (t) => {
        const item = new t.puter.fs.FSItem({
            fsentry_name: 'legacy.txt',
            fsentry_uid: 'uid-legacy',
            fsentry_path: '/somewhere/legacy.txt',
            fsentry_size: 42,
            fsentry_is_dir: 1,
            fsentry_created: 1700000000,
        });
        t.assert.equal(item.name, 'legacy.txt');
        t.assert.equal(item.uid, 'uid-legacy');
        t.assert.equal(item.path, '/somewhere/legacy.txt');
        t.assert.equal(item.size, 42);
        t.assert.equal(item.isDir, true);
        t.assert.equal(item.created, 1700000000);
    },

    'FSItem reads and rewrites the file it points at': async (t) => {
        const path = `${home(t)}/fs-suite-fsitem-io.txt`;
        await t.puter.fs.write(path, 'first body');
        const item = new t.puter.fs.FSItem(await t.puter.fs.stat(path));
        t.assert.equal(await (await item.read()).text(), 'first body');
        await item.write('second body');
        t.assert.equal(await (await t.puter.fs.read(path)).text(), 'second body');
    },

    'FSItem renames, moves, copies and deletes the entry': async (t) => {
        const dir = `${home(t)}/fs-suite-fsitem-ops`;
        const destination = `${home(t)}/fs-suite-fsitem-ops-dest`;
        await t.puter.fs.mkdir(dir);
        await t.puter.fs.mkdir(destination);
        await t.puter.fs.write(`${dir}/before.txt`, 'movable');

        const item = new t.puter.fs.FSItem(await t.puter.fs.stat(`${dir}/before.txt`));
        const renamed = await item.rename('after.txt');
        t.assert.equal(renamed.name, 'after.txt');

        const moved = new t.puter.fs.FSItem(await t.puter.fs.stat(`${dir}/after.txt`));
        await moved.move(destination);
        t.assert.equal(
            await (await t.puter.fs.read(`${destination}/after.txt`)).text(),
            'movable',
        );

        const copyable = new t.puter.fs.FSItem(
            await t.puter.fs.stat(`${destination}/after.txt`),
        );
        await copyable.copy(dir);
        t.assert.equal(
            await (await t.puter.fs.read(`${dir}/after.txt`)).text(),
            'movable',
        );

        await copyable.delete();
        await t.assert.rejects(
            () => t.puter.fs.stat(`${destination}/after.txt`),
            'the deleted item should no longer stat',
        );
    },

    'FSItem mkdir and readdir work on a directory and refuse a file': async (t) => {
        const dir = `${home(t)}/fs-suite-fsitem-dir`;
        await t.puter.fs.mkdir(dir);
        const dirItem = new t.puter.fs.FSItem(await t.puter.fs.stat(dir));
        t.assert.equal(dirItem.isDir, true);
        const created = await dirItem.mkdir('child');
        t.assert.equal(created.name, 'child');
        const listed = await dirItem.readdir();
        t.assert.deepEqual(
            listed.map((e: { name: string }) => e.name),
            ['child'],
        );

        await t.puter.fs.write(`${dir}/leaf.txt`, 'x');
        const fileItem = new t.puter.fs.FSItem(
            await t.puter.fs.stat(`${dir}/leaf.txt`),
        );
        const mkdirError = await t.assert.rejects(
            () => fileItem.mkdir('nope'),
            'mkdir on a file should reject',
        );
        t.assert.equal(
            (mkdirError as Error).message,
            'mkdir() can only be called on a directory',
        );
        const readdirError = await t.assert.rejects(
            () => fileItem.readdir(),
            'readdir on a file should reject',
        );
        t.assert.equal(
            (readdirError as Error).message,
            'readdir() can only be called on a directory',
        );
    },

    'FSItem derives its signature from a signed URL': async (t) => {
        const item = new t.puter.fs.FSItem({
            name: 'signed.txt',
            path: '/somewhere/signed.txt',
            uid: 'uid-signed',
            readURL: 'https://api.example/read?signature=abc123&expires=1750000000',
        });
        // `_internalProperties` is not public API; this pins the derivation
        // the GUI's file_signature handoff depends on.
        const internals = (item as unknown as {
            _internalProperties: {
                signature: string | null;
                expires: string | null;
                file_signature: Record<string, unknown>;
            };
        })._internalProperties;
        t.assert.equal(internals.signature, 'abc123');
        t.assert.equal(internals.expires, '1750000000');
        t.assert.equal(internals.file_signature.uid, 'uid-signed');
        t.assert.equal(internals.file_signature.fsentry_name, 'signed.txt');
        t.assert.equal(internals.file_signature.fsentry_is_dir, false);
    },

    'users cannot read files outside their home': async (t) => {
        await t.assert.rejects(
            () => t.puter.fs.readdir(`/${t.env.users.admin.username}`),
            "reading another user's home should reject",
        );
    },

    'users cannot write outside their home': async (t) => {
        await t.assert.rejects(
            () =>
                t.puter.fs.write(
                    `/${t.env.users.other.username}/fs-suite-intrusion.txt`,
                    'should not exist',
                ),
            "writing into another user's home should reject",
        );
    },
});
