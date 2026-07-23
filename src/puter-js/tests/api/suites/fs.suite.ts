import { suite } from '../harness/types.ts';
import type { TestContext } from '../harness/types.ts';

const home = (t: TestContext) => `/${t.env.users.user.username}`;

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
        // Object form: delete's positional form treats a leading array as
        // the options object, so `delete([a, b])` never reaches the server.
        await t.puter.fs.delete({ paths: [a, b] });
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

    'batch send applies move and delete operations': async (t) => {
        const dir = `${home(t)}/fs-suite-batch`;
        await t.puter.fs.mkdir(dir);
        await t.puter.fs.write(`${dir}/moved.txt`, 'batch move');
        await t.puter.fs.write(`${dir}/removed.txt`, 'batch delete');
        const batch = new t.puter.fs.Batch();
        batch.move(`${dir}/moved.txt`, dir, 'moved-renamed.txt');
        batch.delete(`${dir}/removed.txt`);
        const results = await batch.send();
        t.assert.ok(Array.isArray(results), 'batch should return results');
        const blob = await t.puter.fs.read(`${dir}/moved-renamed.txt`);
        t.assert.equal(await blob.text(), 'batch move');
        await t.assert.rejects(() => t.puter.fs.stat(`${dir}/removed.txt`));
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
