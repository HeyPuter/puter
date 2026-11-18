import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    MISSING_THUMBNAIL_BACKOFF_MS,
    MISSING_THUMBNAIL_CONCURRENCY,
    MISSING_THUMBNAIL_FAILURES_REMEMBERED,
    MISSING_THUMBNAIL_MAX_FILE_BYTES,
    MISSING_THUMBNAIL_PER_MINUTE,
    MISSING_THUMBNAIL_SESSION_BYTES,
    MISSING_THUMBNAIL_SETTLE_MS,
} from './config.js';
import { createMissingThumbnailFiller, createRememberedFailures, wantsThumbnail } from './missing.js';

const HOME = '/alice';
const place = { listRow: false, homePath: HOME, excludedPaths: ['/alice/Trash', '/alice/AppData'] };
const thumbnail = 'data:image/png;base64,AAAA';
// Saved well before the tests' clock, so nothing waits to settle unless a test says so.
const SAVED = 1_000;

const entry = (overrides = {}) => ({
    uid: overrides.uid ?? crypto.randomUUID(),
    name: 'photo.png',
    path: `${HOME}/Pictures/${overrides.name ?? 'photo.png'}`,
    type: 'image/png',
    size: 4,
    modified: SAVED,
    thumbnail: null,
    is_dir: false,
    ...overrides,
});

let observers;
let rows;

class FakeIntersectionObserver {
    constructor (callback) {
        this.callback = callback;
        this.targets = new Set();
        observers.push(this);
    }
    // A real observer reports a target's state once when it starts observing it.
    observe (target) {
        this.targets.add(target);
        if ( target.onScreen ) queueMicrotask(() => this.callback([{ target, isIntersecting: true }]));
    }
    unobserve (target) { this.targets.delete(target); }
    disconnect () { this.targets.clear(); }
}

/** Scroll a row into view, as the browser reports it. */
const show = (row) => {
    row.onScreen = true;
    for ( const observer of observers ) {
        if ( observer.targets.has(row) ) observer.callback([{ target: row, isIntersecting: true }]);
    }
};

const makeRow = () => {
    const row = { isConnected: true, onScreen: false };
    rows.push(row);
    return row;
};

const setup = ({ generated = thumbnail, storeStatus = 200, failures } = {}) => {
    const downloads = [];
    const download = vi.fn((uid, signal) => new Promise((resolve, reject) => {
        const pendingDownload = {
            uid,
            signal,
            finish: (status = 200) => resolve(new Response(status === 200 ? 'abcd' : null, { status })),
        };
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        downloads.push(pendingDownload);
    }));
    const store = vi.fn(async () => new Response('{}', { status: typeof storeStatus === 'function' ? storeStatus() : storeStatus }));
    const generate = vi.fn(async () => generated);
    const onStored = vi.fn();
    const filler = createMissingThumbnailFiller({ download, store, generate, onStored, failures, now: () => Date.now() });
    return { filler, downloads, download, store, generate, onStored };
};

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000_000);
    observers = [];
    rows = [];
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('wantsThumbnail', () => {
    it.each([
        ['an image in the home folder', {}, place, true],
        ['a PDF in a grid', { name: 'doc.pdf', type: 'application/pdf' }, place, true],
        ['a folder', { is_dir: true }, place, false],
        ['a file that already has a thumbnail', { thumbnail: 'https://x/t.png' }, place, false],
        ['a shortcut', { is_shortcut: 1 }, place, false],
        ['an empty file', { size: 0 }, place, false],
        ['a file over the size cap', { size: MISSING_THUMBNAIL_MAX_FILE_BYTES + 1 }, place, false],
        ['a file outside the home folder', { path: '/bob/Pictures/photo.png' }, place, false],
        ['a file in the Trash', { path: `${HOME}/Trash/photo.png` }, place, false],
        ['a file in AppData', { path: `${HOME}/AppData/app/icon.png` }, place, false],
        ['a kind the generator does not read', { name: 'notes.txt', type: 'text/plain' }, place, false],
        ['a PDF in a list row', { name: 'doc.pdf', type: 'application/pdf' }, { ...place, listRow: true }, false],
        ['an image in a list row', {}, { ...place, listRow: true }, true],
    ])('%s: %s', (_label, overrides, where, expected) => {
        expect(wantsThumbnail(entry(overrides), where)).toBe(expected);
    });
});

describe('createMissingThumbnailFiller', () => {
    it('makes and stores a thumbnail once the row is on screen', async () => {
        const { filler, downloads, generate, store, onStored } = setup();
        const row = makeRow();
        const file = entry();

        filler.observe(row, file, place);
        await vi.advanceTimersByTimeAsync(0);
        expect(downloads).toHaveLength(0);

        show(row);
        expect(downloads.map(d => d.uid)).toEqual([file.uid]);
        downloads[0].finish();
        await vi.advanceTimersByTimeAsync(0);

        const [generated] = generate.mock.calls[0];
        expect(generated).toBeInstanceOf(File);
        expect(generated).toMatchObject({ name: 'photo.png', type: 'image/png' });
        expect(store).toHaveBeenCalledWith({ uid: file.uid, thumbnail, expectedModified: SAVED });
        expect(onStored).toHaveBeenCalledWith(row, file, thumbnail);
        // The row's own entry, so the caller can record the thumbnail on it.
        expect(onStored.mock.calls[0][1]).toBe(file);
    });

    it('leaves a row alone when its file was saved again while the thumbnail was being stored', async () => {
        let finishStoring;
        const { filler, downloads, store, onStored } = setup();
        store.mockImplementation(() => new Promise((resolve) => {
            finishStoring = () => resolve(new Response('{}', { status: 200 }));
        }));
        const row = makeRow();
        const file = entry();
        filler.observe(row, file, place);
        show(row);
        downloads[0].finish();
        await vi.advanceTimersByTimeAsync(0);

        file.modified = SAVED + 5;
        filler.observe(row, file, place);
        finishStoring();
        await vi.advanceTimersByTimeAsync(0);
        expect(onStored).not.toHaveBeenCalled();
    });

    it('stores nothing when the generator makes no thumbnail', async () => {
        const { filler, downloads, store } = setup({ generated: null });
        const row = makeRow();
        filler.observe(row, entry(), place);
        show(row);
        downloads[0].finish();
        await vi.advanceTimersByTimeAsync(0);
        expect(store).not.toHaveBeenCalled();
    });

    it('tries each version of a file once', async () => {
        const { filler, downloads } = setup({ generated: null });
        const row = makeRow();
        const file = entry();

        filler.observe(row, file, place);
        show(row);
        downloads[0].finish();
        await vi.advanceTimersByTimeAsync(0);

        filler.observe(row, file, place);
        show(row);
        await vi.advanceTimersByTimeAsync(0);
        expect(downloads).toHaveLength(1);

        filler.observe(row, { ...file, modified: SAVED + 5 }, place);
        show(row);
        await vi.advanceTimersByTimeAsync(0);
        expect(downloads).toHaveLength(2);
    });

    it('waits for a file saved moments ago to settle', async () => {
        const { filler, downloads } = setup();
        const row = makeRow();
        filler.observe(row, entry({ modified: Date.now() / 1000 }), place);
        show(row);
        await vi.advanceTimersByTimeAsync(MISSING_THUMBNAIL_SETTLE_MS - 1);
        expect(downloads).toHaveLength(0);
        await vi.advanceTimersByTimeAsync(1);
        expect(downloads).toHaveLength(1);
    });

    it('makes only the newest version of a file saved again while it waits', async () => {
        const { filler, downloads, store } = setup();
        const row = makeRow();
        const file = entry({ modified: Date.now() / 1000 });
        filler.observe(row, file, place);
        show(row);
        await vi.advanceTimersByTimeAsync(1000);

        const newer = { ...file, modified: Date.now() / 1000 };
        filler.observe(row, newer, place);
        show(row);
        await vi.advanceTimersByTimeAsync(MISSING_THUMBNAIL_SETTLE_MS);

        expect(downloads).toHaveLength(1);
        downloads[0].finish();
        await vi.advanceTimersByTimeAsync(0);
        expect(store).toHaveBeenCalledWith(expect.objectContaining({ expectedModified: newer.modified }));
    });

    it('cancels the download of a version the file no longer has', async () => {
        const { filler, downloads } = setup();
        const row = makeRow();
        const file = entry();
        filler.observe(row, file, place);
        show(row);
        expect(downloads).toHaveLength(1);

        filler.observe(row, { ...file, modified: SAVED + 5 }, place);
        expect(downloads[0].signal.aborted).toBe(true);
    });

    it('drops a waiting file that got a thumbnail from somewhere else', async () => {
        const { filler, downloads } = setup();
        const row = makeRow();
        const file = entry();
        filler.observe(row, file, place);

        // Another tab stored one: the row's entry is updated in place and passed in again.
        file.thumbnail = 'https://storage.example/thumbnail';
        filler.observe(row, file, place);
        show(row);
        await vi.advanceTimersByTimeAsync(MISSING_THUMBNAIL_SETTLE_MS);
        expect(downloads).toHaveLength(0);
    });

    it('drops a waiting file whose entry stopped being eligible without being passed in again', async () => {
        const { filler, downloads } = setup();
        const row = makeRow();
        const file = entry();
        filler.observe(row, file, place);

        file.name = 'photo.txt';
        file.type = 'text/plain';
        show(row);
        await vi.advanceTimersByTimeAsync(MISSING_THUMBNAIL_SETTLE_MS);
        expect(downloads).toHaveLength(0);
    });

    it('cancels a download when the file is saved again as one too large to read', async () => {
        const { filler, downloads } = setup();
        const row = makeRow();
        const file = entry();
        filler.observe(row, file, place);
        show(row);

        file.modified = SAVED + 5;
        file.size = MISSING_THUMBNAIL_MAX_FILE_BYTES + 1;
        filler.observe(row, file, place);
        expect(downloads[0].signal.aborted).toBe(true);
        await vi.advanceTimersByTimeAsync(MISSING_THUMBNAIL_SETTLE_MS);
        expect(downloads).toHaveLength(1);
    });

    it('stores nothing for a file that got a thumbnail from somewhere else while its own was made', async () => {
        let finishGenerating;
        const { filler, downloads, generate, store, onStored } = setup();
        generate.mockImplementation(() => new Promise((resolve) => {
            finishGenerating = resolve;
        }));
        const row = makeRow();
        const file = entry();
        filler.observe(row, file, place);
        show(row);
        downloads[0].finish();
        await vi.advanceTimersByTimeAsync(0);

        file.thumbnail = 'https://storage.example/thumbnail';
        filler.observe(row, file, place);
        finishGenerating(thumbnail);
        await vi.advanceTimersByTimeAsync(0);
        expect(store).not.toHaveBeenCalled();
        expect(onStored).not.toHaveBeenCalled();
    });

    it('sends the modified time of the version it downloaded when the file changes meanwhile', async () => {
        let finishGenerating;
        const { filler, downloads, generate, store } = setup();
        generate.mockImplementation(() => new Promise(resolve => {
            finishGenerating = resolve;
        }));
        const row = makeRow();
        const file = entry();
        filler.observe(row, file, place);
        show(row);
        downloads[0].finish();
        await vi.advanceTimersByTimeAsync(0);

        // The dashboard updates the row's entry in place.
        file.modified = SAVED + 5;
        finishGenerating(thumbnail);
        await vi.advanceTimersByTimeAsync(0);
        expect(store).toHaveBeenCalledWith(expect.objectContaining({ expectedModified: SAVED }));
    });

    it(`downloads at most ${MISSING_THUMBNAIL_CONCURRENCY} files at a time`, async () => {
        const { filler, downloads } = setup();
        const visibleRows = Array.from({ length: 5 }, () => makeRow());
        for ( const row of visibleRows ) {
            filler.observe(row, entry(), place);
            show(row);
        }
        expect(downloads).toHaveLength(MISSING_THUMBNAIL_CONCURRENCY);

        downloads[0].finish();
        await vi.advanceTimersByTimeAsync(0);
        expect(downloads).toHaveLength(MISSING_THUMBNAIL_CONCURRENCY + 1);
    });

    it(`starts at most ${MISSING_THUMBNAIL_PER_MINUTE} files a minute`, async () => {
        const { filler, downloads } = setup();
        for ( let i = 0; i < MISSING_THUMBNAIL_PER_MINUTE + 5; i++ ) {
            const row = makeRow();
            filler.observe(row, entry(), place);
            show(row);
        }
        for ( let finished = 0; finished < downloads.length; finished++ ) {
            downloads[finished].finish();
            await vi.advanceTimersByTimeAsync(0);
        }
        expect(downloads).toHaveLength(MISSING_THUMBNAIL_PER_MINUTE);

        await vi.advanceTimersByTimeAsync(60_000);
        expect(downloads.length).toBeGreaterThan(MISSING_THUMBNAIL_PER_MINUTE);
    });

    it('waits and tries again when the server asks it to slow down', async () => {
        let status = 429;
        const { filler, downloads, store, onStored } = setup({ storeStatus: () => status });
        const row = makeRow();
        filler.observe(row, entry(), place);
        show(row);
        downloads[0].finish();
        await vi.advanceTimersByTimeAsync(0);
        expect(store).toHaveBeenCalledTimes(1);
        expect(onStored).not.toHaveBeenCalled();

        status = 200;
        await vi.advanceTimersByTimeAsync(MISSING_THUMBNAIL_BACKOFF_MS - 1);
        expect(store).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        // The thumbnail it made is sent again; the file isn't downloaded a second time.
        expect(store).toHaveBeenCalledTimes(2);
        expect(downloads).toHaveLength(1);
        expect(onStored).toHaveBeenCalledTimes(1);
    });

    it('sends a made thumbnail again when storing it could not reach the server', async () => {
        const { filler, downloads, store, onStored } = setup();
        store.mockImplementationOnce(async () => {
            throw new TypeError('Failed to fetch');
        });
        const row = makeRow();
        filler.observe(row, entry(), place);
        show(row);
        downloads[0].finish();
        await vi.advanceTimersByTimeAsync(MISSING_THUMBNAIL_BACKOFF_MS);

        expect(store).toHaveBeenCalledTimes(2);
        expect(downloads).toHaveLength(1);
        expect(onStored).toHaveBeenCalledTimes(1);
    });

    it('downloads the file again when it was saved again before its made thumbnail could be stored', async () => {
        let status = 429;
        const { filler, downloads, store } = setup({ storeStatus: () => status });
        const row = makeRow();
        const file = entry();
        filler.observe(row, file, place);
        show(row);
        downloads[0].finish();
        await vi.advanceTimersByTimeAsync(0);

        status = 200;
        file.modified = SAVED + 5;
        filler.observe(row, file, place);
        await vi.advanceTimersByTimeAsync(MISSING_THUMBNAIL_BACKOFF_MS);
        expect(downloads).toHaveLength(2);
        downloads[1].finish();
        await vi.advanceTimersByTimeAsync(0);
        expect(store).toHaveBeenLastCalledWith({ uid: file.uid, thumbnail, expectedModified: SAVED + 5 });
    });

    it('waits and tries again when the server could not be reached', async () => {
        const { filler, download, downloads, onStored } = setup();
        download.mockImplementationOnce(async () => {
            throw new TypeError('Failed to fetch');
        });
        const row = makeRow();
        const file = entry();
        filler.observe(row, file, place);
        show(row);
        await vi.advanceTimersByTimeAsync(MISSING_THUMBNAIL_BACKOFF_MS - 1);
        expect(download).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(1);
        expect(download).toHaveBeenCalledTimes(2);
        downloads[0].finish();
        await vi.advanceTimersByTimeAsync(0);
        expect(onStored).toHaveBeenCalledWith(row, file, thumbnail);
    });

    it('cancels downloads when the folder changes, and tries them again later', async () => {
        const { filler, downloads } = setup();
        const row = makeRow();
        const file = entry();
        filler.observe(row, file, place);
        show(row);

        filler.reset();
        await vi.advanceTimersByTimeAsync(0);
        expect(downloads[0].signal.aborted).toBe(true);

        const again = makeRow();
        filler.observe(again, file, place);
        show(again);
        expect(downloads).toHaveLength(2);
    });

    it('keeps a download going when the folder on screen is drawn again', async () => {
        const { filler, downloads, onStored } = setup();
        const row = makeRow();
        const file = entry();
        const gone = entry();
        filler.observe(row, file, place);
        filler.observe(makeRow(), gone, place);
        rows.forEach(show);
        expect(downloads).toHaveLength(2);

        // A refresh clears the rows and draws the listing again in one go. One file is no longer in it.
        filler.reset();
        row.isConnected = false;
        const again = makeRow();
        filler.observe(again, file, place);
        show(again);
        await vi.advanceTimersByTimeAsync(0);

        expect(downloads).toHaveLength(2);
        expect(downloads[0].signal.aborted).toBe(false);
        expect(downloads[1].signal.aborted).toBe(true);
        downloads[0].finish();
        await vi.advanceTimersByTimeAsync(0);
        expect(onStored).toHaveBeenCalledWith(again, file, thumbnail);
    });

    it('downloads a file again when its row comes back while the cancelled download is still ending', async () => {
        const rejections = [];
        const { filler, download } = setup();
        // A download that takes a moment to end after it's cancelled.
        download.mockImplementation((_uid, signal) => new Promise((_resolve, reject) => {
            rejections.push(() => reject(new DOMException('aborted', 'AbortError')));
            signal.addEventListener('abort', () => {});
        }));
        const row = makeRow();
        const file = entry();
        filler.observe(row, file, place);
        show(row);

        filler.reset();
        await vi.advanceTimersByTimeAsync(0);
        const again = makeRow();
        filler.observe(again, file, place);
        show(again);
        expect(download).toHaveBeenCalledTimes(1);

        rejections[0]();
        await vi.advanceTimersByTimeAsync(0);
        expect(download).toHaveBeenCalledTimes(2);
    });

    /** A download that delivers `bytes` and then stays open until it's cancelled. */
    const stalledAfter = (bytes) => (_uid, signal) => Promise.resolve(new Response(new ReadableStream({
        start (controller) {
            controller.enqueue(new Uint8Array(bytes));
            signal.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')));
        },
    })));

    it('counts what a cancelled download had already received against the download budget', async () => {
        const { filler, download } = setup();
        const size = MISSING_THUMBNAIL_MAX_FILE_BYTES;
        download.mockImplementation(stalledAfter(size - 1));
        const affordable = Math.floor(MISSING_THUMBNAIL_SESSION_BYTES / size);

        for ( let i = 0; i < affordable + 1; i++ ) {
            const row = makeRow();
            filler.observe(row, entry({ size }), place);
            show(row);
            await vi.advanceTimersByTimeAsync(0);
            // The folder changes with the download nearly done.
            filler.reset();
            row.isConnected = false;
            await vi.advanceTimersByTimeAsync(0);
        }
        expect(download).toHaveBeenCalledTimes(affordable);
    });

    it('stops reading a file that turns out to be larger than its listed size allows', async () => {
        let cancelled = false;
        const { filler, download, generate } = setup();
        let chunksLeft = 4;
        download.mockImplementation(async () => new Response(new ReadableStream({
            pull (controller) {
                if ( chunksLeft-- > 0 ) controller.enqueue(new Uint8Array(MISSING_THUMBNAIL_MAX_FILE_BYTES / 2 + 1));
                else controller.close();
            },
            cancel () {
                cancelled = true;
            },
        })));
        const row = makeRow();
        filler.observe(row, entry(), place);
        show(row);
        await vi.advanceTimersByTimeAsync(0);
        expect(cancelled).toBe(true);
        expect(generate).not.toHaveBeenCalled();
    });

    it('gives back the budget set aside for a download the server refused', async () => {
        const { filler, downloads } = setup();
        const size = MISSING_THUMBNAIL_MAX_FILE_BYTES;
        const count = Math.floor(MISSING_THUMBNAIL_SESSION_BYTES / size) + 1;
        for ( let i = 0; i < count; i++ ) {
            const row = makeRow();
            filler.observe(row, entry({ size }), place);
            show(row);
            downloads[i]?.finish(500);
            await vi.advanceTimersByTimeAsync(0);
        }
        expect(downloads).toHaveLength(count);
    });

    it('drops a row that left the page before its turn', async () => {
        const { filler, downloads } = setup();
        const first = makeRow();
        const second = makeRow();
        const third = makeRow();
        for ( const row of [first, second, third] ) {
            filler.observe(row, entry(), place);
            show(row);
        }
        third.isConnected = false;
        downloads[0].finish();
        await vi.advanceTimersByTimeAsync(0);
        expect(downloads).toHaveLength(MISSING_THUMBNAIL_CONCURRENCY);
    });

    it('does not download a version that gave no thumbnail again after the page reloads', async () => {
        const storage = new Map();
        const localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
        const file = entry();

        const before = setup({ generated: null, failures: createRememberedFailures(() => localStorage) });
        const row = makeRow();
        before.filler.observe(row, file, place);
        show(row);
        before.downloads[0].finish();
        await vi.advanceTimersByTimeAsync(0);

        const after = setup({ failures: createRememberedFailures(() => localStorage) });
        const again = makeRow();
        after.filler.observe(again, file, place);
        show(again);
        after.filler.observe(again, { ...file, modified: SAVED + 5 }, place);
        show(again);
        await vi.advanceTimersByTimeAsync(0);
        expect(after.downloads).toHaveLength(1);
    });

    it('does not download a version again whose thumbnail the server refused as unusable', async () => {
        const storage = new Map();
        const localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
        const file = entry();

        const before = setup({ storeStatus: 400, failures: createRememberedFailures(() => localStorage) });
        const row = makeRow();
        before.filler.observe(row, file, place);
        show(row);
        before.downloads[0].finish();
        await vi.advanceTimersByTimeAsync(0);
        expect(before.onStored).not.toHaveBeenCalled();

        const after = setup({ failures: createRememberedFailures(() => localStorage) });
        const again = makeRow();
        after.filler.observe(again, file, place);
        show(again);
        await vi.advanceTimersByTimeAsync(0);
        expect(after.downloads).toHaveLength(0);
    });

    it('downloads nothing more once the account is out of credit', async () => {
        const { filler, downloads } = setup();
        const first = makeRow();
        filler.observe(first, entry(), place);
        show(first);
        downloads[0].finish(402);
        await vi.advanceTimersByTimeAsync(0);

        const second = makeRow();
        filler.observe(second, entry(), place);
        show(second);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(downloads).toHaveLength(1);
    });
});

describe('createRememberedFailures', () => {
    it(`keeps the latest ${MISSING_THUMBNAIL_FAILURES_REMEMBERED} versions`, () => {
        const storage = new Map();
        const localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
        const failures = createRememberedFailures(() => localStorage);
        for ( let i = 0; i <= MISSING_THUMBNAIL_FAILURES_REMEMBERED; i++ ) failures.add(`file:${i}`);

        const reloaded = createRememberedFailures(() => localStorage);
        expect(reloaded.has('file:0')).toBe(false);
        expect(reloaded.has('file:1')).toBe(true);
        expect(reloaded.has(`file:${MISSING_THUMBNAIL_FAILURES_REMEMBERED}`)).toBe(true);
    });

    it('works for this page load when storage is blocked or holds something else', () => {
        const blocked = createRememberedFailures(() => {
            throw new Error('SecurityError');
        });
        blocked.add('file:1');
        expect(blocked.has('file:1')).toBe(true);

        const garbled = createRememberedFailures(() => ({ getItem: () => '{not json', setItem: () => {} }));
        expect(garbled.has('file:1')).toBe(false);
    });
});
