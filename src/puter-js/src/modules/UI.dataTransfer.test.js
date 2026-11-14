import { afterEach, describe, expect, it, vi } from 'vitest';

const { UIModule } = await import('./UI.js');

const makeUI = () =>
    new UIModule(
        { env: 'web', authToken: null, APIOrigin: 'https://api.test', appID: 'app-1', util: {} },
        { appInstanceID: 'instance-1' },
    );

/** A dropped file, as the browser's FileSystemFileEntry hands it over. */
const fileEntry = (name) => ({
    isFile: true,
    isDirectory: false,
    name,
    file: (onFile) => onFile({ name }),
});

/** A dropped folder; its reader hands the entries over in batches, then an empty one. */
const directoryEntry = (name, ...batches) => ({
    isFile: false,
    isDirectory: true,
    name,
    createReader: () => {
        const remaining = [...batches];
        return { readEntries: (onEntries) => onEntries(remaining.shift() ?? []) };
    },
});

const failingFileEntry = (name, error) => ({
    isFile: true,
    name,
    file: (_onFile, onError) => onError(error),
});

const failingDirectoryEntry = (name, error) => ({
    isDirectory: true,
    name,
    createReader: () => ({ readEntries: (_onEntries, onError) => onError(error) }),
});

/** The DataTransferItemList of a drop carrying these entries. */
const dropped = (...entries) => {
    const items = entries.map((entry) => ({ webkitGetAsEntry: () => entry }));
    return { length: items.length, ...items };
};

const namedError = (name, message) => Object.assign(new Error(message), { name });

afterEach(() => {
    vi.restoreAllMocks();
});

describe('ui.getEntriesFromDataTransferItems', () => {
    it('resolves the dropped files with their paths', async () => {
        const files = await makeUI().getEntriesFromDataTransferItems(dropped(fileEntry('a.txt'), fileEntry('b.txt')));

        expect(files).toEqual([
            { name: 'a.txt', filepath: 'a.txt' },
            { name: 'b.txt', filepath: 'b.txt' },
        ]);
    });

    it('walks a dropped folder, listing each folder after what it holds', async () => {
        const nested = directoryEntry('img', [fileEntry('cat.png')]);
        // Two batches: a reader returns a large folder a chunk at a time.
        const docs = directoryEntry('docs', [fileEntry('a.txt'), nested], [fileEntry('b.txt')]);

        const files = await makeUI().getEntriesFromDataTransferItems(dropped(docs, fileEntry('top.txt')));

        expect(files).toEqual([
            { name: 'a.txt', filepath: 'docs/a.txt' },
            { name: 'cat.png', filepath: 'docs/img/cat.png' },
            nested,
            { name: 'b.txt', filepath: 'docs/b.txt' },
            docs,
            { name: 'top.txt', filepath: 'top.txt' },
        ]);
    });

    it('resolves an empty folder as the folder alone', async () => {
        const empty = directoryEntry('empty');

        await expect(makeUI().getEntriesFromDataTransferItems(dropped(empty))).resolves.toEqual([empty]);
    });

    it('leaves the files untouched when asked for them raw', async () => {
        const docs = directoryEntry('docs', [fileEntry('a.txt')]);

        const files = await makeUI().getEntriesFromDataTransferItems(dropped(docs), { raw: true });

        expect(files).toEqual([{ name: 'a.txt' }, docs]);
    });

    it('resolves nothing for an empty drop', async () => {
        await expect(makeUI().getEntriesFromDataTransferItems(dropped())).resolves.toEqual([]);
    });

    it('rejects with the error a file could not be read with', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const error = namedError('NotReadableError', 'The file could not be read.');

        await expect(
            makeUI().getEntriesFromDataTransferItems(dropped(failingFileEntry('a.txt', error))),
        ).rejects.toBe(error);
        expect(warn).not.toHaveBeenCalled();
    });

    it('rejects with the error a folder could not be listed with', async () => {
        const error = namedError('NotFoundError', 'The folder is gone.');

        await expect(
            makeUI().getEntriesFromDataTransferItems(dropped(failingDirectoryEntry('docs', error))),
        ).rejects.toBe(error);
    });

    // Chrome raises EncodingError for a page opened from the filesystem.
    it('explains an EncodingError once, however many reads fail with it', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const error = namedError('EncodingError', 'A URI supplied to the API was malformed.');
        const ui = makeUI();

        await expect(
            ui.getEntriesFromDataTransferItems(dropped(failingFileEntry('a.txt', error))),
        ).rejects.toBe(error);
        await expect(
            ui.getEntriesFromDataTransferItems(dropped(failingDirectoryEntry('docs', error))),
        ).rejects.toBe(error);

        expect(warn).toHaveBeenCalledOnce();
        expect(warn.mock.calls[0][0]).toContain('Try serving html over http');
    });
});
