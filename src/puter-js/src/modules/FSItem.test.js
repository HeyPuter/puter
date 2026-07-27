import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FSItem from './FSItem.js';

/**
 * FSItem's methods are thin wrappers over `puter.fs.*`. These pin the exact
 * arguments they forward, so options a caller passes to an FSItem method reach
 * the operation instead of landing in a slot it doesn't read.
 */

const origPuter = globalThis.puter;

let fs;

const makeItem = (options = {}) => new FSItem({
    uid: 'uid-1',
    name: 'file.txt',
    path: '/user/file.txt',
    readURL: 'https://api.test/read?signature=sig&expires=1',
    ...options,
});

beforeEach(() => {
    fs = {
        write: vi.fn(async () => ({})),
        rename: vi.fn(async () => ({})),
        move: vi.fn(async () => ({})),
        copy: vi.fn(async () => ({})),
        delete: vi.fn(async () => undefined),
        mkdir: vi.fn(async () => ({})),
        readdir: vi.fn(async () => []),
        read: vi.fn(async () => new Blob(['x'])),
    };
    globalThis.puter = { fs };
});

afterEach(() => {
    globalThis.puter = origPuter;
});

describe('FSItem properties', () => {
    it('exposes isDir alongside the legacy isDirectory', () => {
        expect(makeItem({ is_dir: true }).isDir).toBe(true);
        expect(makeItem({ is_dir: true }).isDirectory).toBe(true);
        expect(makeItem().isDir).toBe(false);
    });

    it('accepts the camelCase isDir spelling', () => {
        expect(makeItem({ isDir: true }).isDirectory).toBe(true);
    });
});

describe('FSItem.write', () => {
    it('overwrites the file in place', async () => {
        await makeItem().write('new contents');
        expect(fs.write).toHaveBeenCalledWith('/user/file.txt', 'new contents', {
            overwrite: true,
            dedupeName: false,
        });
    });

    it('passes binary data through untouched', async () => {
        const blob = new Blob(['bytes']);
        await makeItem().write(blob);
        expect(fs.write.mock.calls[0][1]).toBe(blob);
    });
});

describe('FSItem.rename', () => {
    it('addresses the item by uid', async () => {
        await makeItem().rename('renamed.txt');
        expect(fs.rename).toHaveBeenCalledWith({ uid: 'uid-1', newName: 'renamed.txt' });
    });

    it('falls back to the path when there is no uid', async () => {
        await makeItem({ uid: undefined, uuid: undefined, id: undefined }).rename('renamed.txt');
        expect(fs.rename).toHaveBeenCalledWith({ path: '/user/file.txt', newName: 'renamed.txt' });
    });
});

describe('FSItem.move', () => {
    it('forwards overwrite and newName as options', async () => {
        await makeItem().move('/user/dir', true, 'other.txt');
        expect(fs.move).toHaveBeenCalledWith('/user/file.txt', '/user/dir', {
            overwrite: true,
            newName: 'other.txt',
        });
    });

    it('defaults to a non-overwriting move', async () => {
        await makeItem().move('/user/dir');
        expect(fs.move).toHaveBeenCalledWith('/user/file.txt', '/user/dir', {
            overwrite: false,
            newName: undefined,
        });
    });
});

describe('FSItem.copy', () => {
    it('maps autoRename onto dedupeName', async () => {
        await makeItem().copy('/user/dir', true, false);
        expect(fs.copy).toHaveBeenCalledWith('/user/file.txt', '/user/dir', {
            dedupeName: true,
            overwrite: false,
        });
    });

    // Sending dedupeName: false would turn the backend's copy-and-rename
    // default into a conflict error.
    it('leaves dedupeName unset when autoRename is not given', async () => {
        await makeItem().copy('/user/dir');
        expect(fs.copy).toHaveBeenCalledWith('/user/file.txt', '/user/dir', {
            dedupeName: undefined,
            overwrite: false,
        });
    });
});

describe('FSItem.delete', () => {
    it('deletes by path', async () => {
        await makeItem().delete();
        expect(fs.delete).toHaveBeenCalledWith('/user/file.txt');
    });
});

describe('FSItem.mkdir', () => {
    it('creates a subdirectory and forwards autoRename', async () => {
        const dir = makeItem({ is_dir: true, path: '/user/dir' });
        await dir.mkdir('sub', true);
        expect(fs.mkdir).toHaveBeenCalledWith('/user/dir/sub', { dedupeName: true });
    });

    it('refuses to run on a file', async () => {
        await expect(makeItem().mkdir('sub')).rejects.toThrow('mkdir() can only be called on a directory');
        expect(fs.mkdir).not.toHaveBeenCalled();
    });
});

describe('FSItem.readdir', () => {
    it('lists the directory', async () => {
        await makeItem({ is_dir: true, path: '/user/dir' }).readdir();
        expect(fs.readdir).toHaveBeenCalledWith('/user/dir');
    });

    it('refuses to run on a file', async () => {
        await expect(makeItem().readdir()).rejects.toThrow('readdir() can only be called on a directory');
    });
});

describe('FSItem.read', () => {
    it('reads by path', async () => {
        await makeItem().read();
        expect(fs.read).toHaveBeenCalledWith('/user/file.txt');
    });
});
