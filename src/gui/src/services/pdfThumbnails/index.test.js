import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    PDFJS_VERSION,
    PDF_THUMBNAIL_BATCH_TIMEOUT_MS,
    PDF_THUMBNAIL_JOB_TIMEOUT_MS,
    PDF_THUMBNAIL_MAX_FILE_BYTES,
} from './config.js';

const thumbnail = 'data:image/png;base64,AAAA';
const bundledThumbnail = 'data:image/webp;base64,BBBB';
const bundledImageGenerator = vi.fn(async () => bundledThumbnail);
vi.mock('../../../../puter-js/src/modules/FileSystem/operations/upload/thumbnails.js', () => ({
    defaultThumbnailGenerator: (...args) => bundledImageGenerator(...args),
}));
const pdf = () => new File(['%PDF-1.7'], 'document.pdf', { type: 'application/pdf' });
let createUploadThumbnailGenerator;
let workers;

beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    bundledImageGenerator.mockClear();
    workers = [];
    vi.stubGlobal('OffscreenCanvas', class {});
    vi.stubGlobal('Worker', class {
        terminate = vi.fn();
        postMessage = vi.fn();
        constructor (url, options) {
            this.url = url;
            this.options = options;
            workers.push(this);
        }
        complete (value = thumbnail) { this.onmessage({ data: { type: 'thumbnail', thumbnail: value } }); }
    });
    ({ createUploadThumbnailGenerator } = await import('./index.js'));
});

afterEach(async () => {
    await vi.runAllTimersAsync();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('PDF thumbnail asset loading', () => {
    it('uses the local dist directory for unbundled development', async () => {
        const result = createUploadThumbnailGenerator()(pdf());
        expect(workers[0].url).toBe(`/dist/pdf-thumbnails/${PDFJS_VERSION}/worker.js`);
        workers[0].complete();
        expect(await result).toBe(thumbnail);
    });

    it('resolves same-origin assets beside the bundle, independent of the page path', async () => {
        vi.stubGlobal('document', { currentScript: { src: 'https://desktop.example/assets/bundle.js?v=1' } });
        vi.stubGlobal('location', new URL('https://desktop.example/dashboard'));
        vi.resetModules();
        ({ createUploadThumbnailGenerator } = await import('./index.js'));
        document.currentScript = null;
        const result = createUploadThumbnailGenerator()(pdf());
        expect(workers[0].url).toBe(`https://desktop.example/assets/pdf-thumbnails/${PDFJS_VERSION}/worker.js`);
        expect(workers[0].options).toEqual({ type: 'module' });
        workers[0].complete();
        expect(await result).toBe(thumbnail);
    });

    it.each(['success', 'error', 'cancel', 'timeout', 'construction', 'clone'])(
        'releases the cross-origin worker Blob after %s', async (outcome) => {
            vi.stubGlobal('document', { currentScript: { src: 'https://cdn.example/assets/bundle.js?v=1' } });
            vi.stubGlobal('location', new URL('https://desktop.example/dashboard'));
            const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:https://desktop.example/worker');
            const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
            vi.resetModules();
            ({ createUploadThumbnailGenerator } = await import('./index.js'));
            document.currentScript = null;
            const generate = createUploadThumbnailGenerator();
            await generate(new File(['image'], 'image.png'));
            expect(createObjectUrl).not.toHaveBeenCalled();
            if ( outcome === 'construction' ) {
                vi.stubGlobal('Worker', class { constructor () { throw new Error('blocked'); } });
            }
            const controller = new AbortController();
            const result = generate(pdf(), { signal: controller.signal });
            expect(createObjectUrl).toHaveBeenCalledOnce();
            expect(await createObjectUrl.mock.calls[0][0].text()).toBe(
                `import "https://cdn.example/assets/pdf-thumbnails/${PDFJS_VERSION}/worker.js";`,
            );
            if ( outcome !== 'construction' ) {
                expect(workers[0].url).toBe('blob:https://desktop.example/worker');
                expect(workers[0].options).toEqual({ type: 'module' });
                expect(revokeObjectUrl).not.toHaveBeenCalled();
            }
            if ( outcome === 'success' ) workers[0].complete();
            if ( outcome === 'error' ) workers[0].onerror({ preventDefault: vi.fn() });
            if ( outcome === 'cancel' ) controller.abort();
            if ( outcome === 'timeout' ) await vi.advanceTimersByTimeAsync(PDF_THUMBNAIL_JOB_TIMEOUT_MS);
            if ( outcome === 'clone' ) workers[0].onmessageerror();
            expect(await result).toBe(outcome === 'success' ? thumbnail : undefined);
            expect(revokeObjectUrl).toHaveBeenCalledExactlyOnceWith('blob:https://desktop.example/worker');
            if ( workers.length ) expect(workers[0].terminate).toHaveBeenCalledOnce();
            expect(vi.getTimerCount()).toBe(0);
        },
    );
});

describe('GUI upload thumbnail scheduling', () => {
    it('delegates images without loading PDF assets', async () => {
        const file = new File(['image'], 'image.png');
        const defaultGenerator = vi.fn(async () => thumbnail);
        expect(await createUploadThumbnailGenerator()(file, { defaultGenerator })).toBe(thumbnail);
        expect(defaultGenerator).toHaveBeenCalledWith(file);
        expect(bundledImageGenerator).not.toHaveBeenCalled();
        expect(workers).toHaveLength(0);
    });

    it.each([undefined, {}, { defaultGenerator: 'not a function' }])(
        'falls back to the bundled image generator when the SDK passes no usable context: %j', async (context) => {
            const file = new File(['image'], 'image.png');
            expect(await createUploadThumbnailGenerator()(file, context)).toBe(bundledThumbnail);
            expect(bundledImageGenerator).toHaveBeenCalledWith(file);
            expect(workers).toHaveLength(0);
        });

    it('preserves graceful failure of the image generator', async () => {
        expect(await createUploadThumbnailGenerator()(new File(['x'], 'x.png'), {
            defaultGenerator: async () => { throw new Error('decode failed'); },
        })).toBeUndefined();
        expect(workers).toHaveLength(0);
    });

    it.each([
        new File([], 'empty.pdf'),
        { name: 'large.pdf', size: PDF_THUMBNAIL_MAX_FILE_BYTES + 1 },
    ])('skips empty and oversized PDFs without reading them', async (file) => {
        expect(await createUploadThumbnailGenerator()(file)).toBeUndefined();
        expect(workers).toHaveLength(0);
    });

    it.each(['Worker', 'OffscreenCanvas'])('skips PDFs when %s is unavailable', async (feature) => {
        vi.stubGlobal(feature, undefined);
        expect(await createUploadThumbnailGenerator()(pdf())).toBeUndefined();
        expect(workers).toHaveLength(0);
    });

    it.each([
        new File(['pdf'], 'document.PDF'),
        new File(['pdf'], 'document', { type: 'application/pdf' }),
    ])('recognizes PDF extensions and MIME types', async (file) => {
        const result = createUploadThumbnailGenerator()(file);
        expect(workers[0].postMessage).toHaveBeenCalledWith(file);
        workers[0].complete();
        expect(await result).toBe(thumbnail);
        expect(workers[0].terminate).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('ignores PDF.js readiness messages until the thumbnail is ready', async () => {
        const result = createUploadThumbnailGenerator()(pdf());
        workers[0].onmessage({ data: { action: 'ready', targetName: 'main' } });
        expect(workers[0].terminate).not.toHaveBeenCalled();
        workers[0].complete();
        expect(await result).toBe(thumbnail);
    });

    it('serializes PDFs across simultaneous uploads', async () => {
        const first = createUploadThumbnailGenerator()(pdf());
        const second = createUploadThumbnailGenerator()(pdf());
        expect(workers).toHaveLength(1);
        workers[0].complete();
        expect(workers).toHaveLength(2);
        workers[1].complete();
        expect(await Promise.all([first, second])).toEqual([thumbnail, thumbnail]);
    });

    it('terminates a stuck worker and advances the queue', async () => {
        const generate = createUploadThumbnailGenerator();
        const first = generate(pdf());
        const second = generate(pdf());
        await vi.advanceTimersByTimeAsync(PDF_THUMBNAIL_JOB_TIMEOUT_MS);
        expect(await first).toBeUndefined();
        expect(workers[0].terminate).toHaveBeenCalledOnce();
        expect(workers).toHaveLength(2);
        workers[1].complete();
        expect(await second).toBe(thumbnail);
    });

    it('bounds a whole batch including queued files and rejects late results', async () => {
        const generate = createUploadThumbnailGenerator();
        const results = Array.from({ length: 20 }, () => generate(pdf()));
        await vi.advanceTimersByTimeAsync(PDF_THUMBNAIL_BATCH_TIMEOUT_MS);
        expect(await Promise.all(results)).toEqual(Array(20).fill(undefined));
        expect(workers).toHaveLength(Math.ceil(PDF_THUMBNAIL_BATCH_TIMEOUT_MS / PDF_THUMBNAIL_JOB_TIMEOUT_MS));
        expect(workers.every(worker => worker.terminate.mock.calls.length === 1)).toBe(true);
        workers[0].complete();
        expect(await generate(pdf())).toBeUndefined();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('cancels both running and queued jobs and releases abort listeners', async () => {
        const controller = new AbortController();
        const remove = vi.spyOn(controller.signal, 'removeEventListener');
        const generate = createUploadThumbnailGenerator();
        const first = generate(pdf(), { signal: controller.signal });
        const second = generate(pdf(), { signal: controller.signal });
        controller.abort();
        expect(await Promise.all([first, second])).toEqual([undefined, undefined]);
        expect(workers).toHaveLength(1);
        expect(workers[0].terminate).toHaveBeenCalledOnce();
        expect(remove).toHaveBeenCalledTimes(2);
        expect(vi.getTimerCount()).toBe(0);
        expect(await generate(pdf(), { signal: controller.signal })).toBeUndefined();
    });

    it.each(['error', 'messageerror', 'invalid', 'empty'])('recovers from a worker %s', async (failure) => {
        const result = createUploadThumbnailGenerator()(pdf());
        if ( failure === 'error' ) workers[0].onerror({ preventDefault: vi.fn() });
        if ( failure === 'messageerror' ) workers[0].onmessageerror();
        if ( failure === 'invalid' ) workers[0].complete('not an image');
        if ( failure === 'empty' ) workers[0].onmessage({ data: { type: 'thumbnail' } });
        expect(await result).toBeUndefined();
        expect(workers[0].terminate).toHaveBeenCalledOnce();
        const next = createUploadThumbnailGenerator()(pdf());
        workers[1].complete();
        expect(await next).toBe(thumbnail);
    });

    it('survives worker construction and structured-clone errors', async () => {
        vi.stubGlobal('Worker', class { constructor () { throw new Error('blocked'); } });
        expect(await createUploadThumbnailGenerator()(pdf())).toBeUndefined();
        vi.stubGlobal('Worker', class {
            terminate = vi.fn();
            postMessage () { throw new Error('clone failed'); }
            constructor () { workers.push(this); }
        });
        expect(await createUploadThumbnailGenerator()(pdf())).toBeUndefined();
        expect(workers[0].terminate).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
    });
});
