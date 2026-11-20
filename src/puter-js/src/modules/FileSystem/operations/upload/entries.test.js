import { describe, expect, it } from 'vitest';

import { separateFilesAndDirs } from './entries.js';

const file = (filepath) => ({ name: filepath.split('/').pop(), filepath, size: 1 });

describe('separateFilesAndDirs', () => {
    it('places nested files and their parents under the destination', () => {
        const { dirs, files } = separateFilesAndDirs(
            [file('site/index.html'), file('site/a/../b.css')],
            '/user/AppData/app',
            { createFileParent: true },
        );
        expect(files.map((f) => f.puter_full_path)).toEqual([
            '/user/AppData/app/site/index.html',
            '/user/AppData/app/site/b.css',
        ]);
        expect(dirs.map((d) => d.path)).toContain('/user/AppData/app/site');
    });

    it.each([
        ['../../.config/settings.json'],
        ['site/../../outside.txt'],
    ])('refuses a file at %s, outside the destination', (filepath) => {
        expect(() =>
            separateFilesAndDirs([file(filepath)], '/user/AppData/app', {
                createFileParent: true,
            }),
        ).toThrow(expect.objectContaining({ code: 'invalid_upload_path' }));
    });

    it('refuses a directory entry outside the destination', () => {
        expect(() =>
            separateFilesAndDirs(
                [{ isDirectory: true, fullPath: '/../escape' }],
                '/user/AppData/app',
                {},
            ),
        ).toThrow(expect.objectContaining({ code: 'invalid_upload_path' }));
    });

    it('does not confuse a sibling folder that shares the prefix with the destination', () => {
        expect(() =>
            separateFilesAndDirs([file('../app-other/x.txt')], '/user/AppData/app', {}),
        ).toThrow(expect.objectContaining({ code: 'invalid_upload_path' }));
    });
});
