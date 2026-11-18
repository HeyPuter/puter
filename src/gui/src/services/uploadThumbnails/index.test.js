import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFlac, createM4a, createMp3, flacPicture, id3Picture } from '../../../tests/fixtures/audio.js';
import { createRecordingCanvas } from '../../../tests/fixtures/canvas.js';
import { createDoc } from '../../../tests/fixtures/doc.js';
import { createDocx } from '../../../tests/fixtures/docx.js';
import { createPptx } from '../../../tests/fixtures/pptx.js';
import { createPsd, psdPreviewJpeg, psdResource } from '../../../tests/fixtures/psd.js';
import { createXlsx } from '../../../tests/fixtures/xlsx.js';
import {
    PDFJS_VERSION,
    PDF_THUMBNAIL_BATCH_TIMEOUT_MS,
    PDF_THUMBNAIL_JOB_TIMEOUT_MS,
    PDF_THUMBNAIL_MAX_FILE_BYTES,
    AUDIO_BATCH_TIMEOUT_MS,
    OFFICE_BATCH_TIMEOUT_MS,
    VIDEO_BATCH_TIMEOUT_MS,
    VIDEO_JOB_TIMEOUT_MS,
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

    it.each([
        new File([createPsd()], 'art.psd'),
        new File([createPsd({ version: 2 })], 'art.PSB'),
        new File([createPsd()], 'art', { type: 'image/vnd.adobe.photoshop' }),
    ])('hands the image generator the preview embedded in a PSD', async (file) => {
        const defaultGenerator = vi.fn(async () => thumbnail);
        expect(await createUploadThumbnailGenerator()(file, { defaultGenerator })).toBe(thumbnail);
        expect(defaultGenerator).toHaveBeenCalledOnce();
        const [image] = defaultGenerator.mock.calls[0];
        expect(image.type).toBe('image/jpeg');
        expect(new Uint8Array(await image.arrayBuffer())).toEqual(psdPreviewJpeg());
        expect(workers).toHaveLength(0);
    });

    it('uses the bundled image generator for a PSD when the SDK passes no context', async () => {
        expect(await createUploadThumbnailGenerator()(new File([createPsd()], 'art.psd'))).toBe(bundledThumbnail);
        expect(bundledImageGenerator.mock.calls[0][0].type).toBe('image/jpeg');
    });

    it('hands the image generator the merged image of a PSD saved without a preview', async () => {
        const defaultGenerator = vi.fn(async () => thumbnail);
        const file = new File([createPsd({ resources: [psdResource(1005, [1, 2])] })], 'art.psd');
        expect(await createUploadThumbnailGenerator()(file, { defaultGenerator })).toBe(thumbnail);
        expect(defaultGenerator).toHaveBeenCalledOnce();
        expect(defaultGenerator.mock.calls[0][0].type).toBe('image/bmp');
        expect(workers).toHaveLength(0);
    });

    it.each([
        createPsd({ resources: [], colorMode: 4, channels: [[0], [0], [0], [0]] }),
        'not a Photoshop document',
    ])('skips a PSD with no image it can read', async (content) => {
        const defaultGenerator = vi.fn(async () => thumbnail);
        const generate = createUploadThumbnailGenerator();
        expect(await generate(new File([content], 'art.psd'), { defaultGenerator })).toBeUndefined();
        expect(defaultGenerator).not.toHaveBeenCalled();
        expect(workers).toHaveLength(0);
    });

    it.each([
        new File([createDocx()], 'report.docx'),
        new File([createDocx()], 'template.DOTM'),
        new File([createDocx()], 'report', {
            type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
        new File([createDoc()], 'letter.doc'),
        new File([createDoc()], 'letter', { type: 'application/msword' }),
        // The name of a document doesn't always match the format it is saved in.
        new File([createDocx()], 'report.doc'),
        new File([createDoc()], 'letter.docx'),
    ])('hands the image generator a drawing of a Word document\'s first page', async (file) => {
        const { Canvas, drawn } = createRecordingCanvas();
        vi.stubGlobal('OffscreenCanvas', Canvas);
        const defaultGenerator = vi.fn(async () => thumbnail);
        expect(await createUploadThumbnailGenerator()(file, { defaultGenerator })).toBe(thumbnail);
        expect(defaultGenerator).toHaveBeenCalledOnce();
        expect(defaultGenerator.mock.calls[0][0].type).toBe('image/png');
        expect(drawn.text.map(word => word.text)).toEqual(['Hello']);
        expect(workers).toHaveLength(0);
    });

    it('hands the image generator the thumbnail stored in a DOCX', async () => {
        const defaultGenerator = vi.fn(async () => thumbnail);
        const file = new File([createDocx({ thumbnail: psdPreviewJpeg() })], 'report.docx');
        expect(await createUploadThumbnailGenerator()(file, { defaultGenerator })).toBe(thumbnail);
        const [image] = defaultGenerator.mock.calls[0];
        expect(image.type).toBe('image/jpeg');
        expect(new Uint8Array(await image.arrayBuffer())).toEqual(psdPreviewJpeg());
    });

    it.each([
        ['text that is only named like a document', 'not a Word document'],
        ['a DOCX whose main part does not inflate', (() => {
            const docx = createDocx({ stored: ['word/document.xml'] });
            // Mark the stored main part as deflated, in its directory entry.
            const name = new TextEncoder().encode('word/document.xml');
            const at = docx.findLastIndex((_, index) => name.every((byte, offset) => docx[index + offset] === byte));
            docx[at - 36] = 8;
            return docx;
        })()],
        ['a DOCX with a blank first page', createDocx({ body: '<w:p/>' })],
    ])('skips %s', async (_label, content) => {
        vi.stubGlobal('OffscreenCanvas', createRecordingCanvas().Canvas);
        const defaultGenerator = vi.fn(async () => thumbnail);
        const generate = createUploadThumbnailGenerator();
        expect(await generate(new File([content], 'report.docx'), { defaultGenerator })).toBeUndefined();
        expect(defaultGenerator).not.toHaveBeenCalled();
        expect(workers).toHaveLength(0);
    });

    it('reads the Word documents of an upload one at a time', async () => {
        const events = [];
        const { Canvas } = createRecordingCanvas();
        vi.stubGlobal('OffscreenCanvas', class extends Canvas {
            constructor (...size) {
                super(...size);
                events.push('draw');
            }
        });
        const read = Blob.prototype.arrayBuffer;
        vi.spyOn(Blob.prototype, 'arrayBuffer').mockImplementation(function () {
            events.push('read');
            return read.call(this);
        });
        const defaultGenerator = vi.fn(async () => thumbnail);
        const generate = createUploadThumbnailGenerator();
        // A document this small is read whole by its first read.
        const files = [new File([createDocx()], 'a.docx'), new File([createDocx()], 'b.docx')];
        expect(await Promise.all(files.map(file => generate(file, { defaultGenerator })))).toEqual([thumbnail, thumbnail]);
        expect(events).toEqual(['read', 'draw', 'read', 'draw']);
    });

    it('skips the Word documents still queued when an upload\'s preparation deadline passes', async () => {
        vi.stubGlobal('OffscreenCanvas', createRecordingCanvas().Canvas);
        const defaultGenerator = vi.fn(async () => thumbnail);
        const generate = createUploadThumbnailGenerator();
        const file = () => new File([createDocx()], 'report.docx');
        expect(await generate(file(), { defaultGenerator })).toBe(thumbnail);
        vi.setSystemTime(Date.now() + OFFICE_BATCH_TIMEOUT_MS);
        expect(await generate(file(), { defaultGenerator })).toBeUndefined();
        expect(defaultGenerator).toHaveBeenCalledOnce();
        // The next upload gets its own deadline.
        expect(await createUploadThumbnailGenerator()(file(), { defaultGenerator })).toBe(thumbnail);
    });

    it('gives up at the deadline on an Office document whose read has not come back', async () => {
        vi.stubGlobal('OffscreenCanvas', createRecordingCanvas().Canvas);
        const defaultGenerator = vi.fn(async () => thumbnail);
        const generate = createUploadThumbnailGenerator();
        // A file on a drive that has stopped answering.
        const stalled = { name: 'stalled.docx', type: '', size: 4096, slice: () => ({ arrayBuffer: () => new Promise(() => {}) }) };
        const results = Promise.all([
            generate(stalled, { defaultGenerator }),
            generate(new File([createXlsx()], 'budget.xlsx'), { defaultGenerator }),
        ]);
        await vi.advanceTimersByTimeAsync(OFFICE_BATCH_TIMEOUT_MS);
        expect(await results).toEqual([undefined, undefined]);
        expect(defaultGenerator).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('keeps reading Office documents after one makes its reader throw', async () => {
        vi.stubGlobal('OffscreenCanvas', createRecordingCanvas().Canvas);
        const defaultGenerator = vi.fn(async () => thumbnail);
        const generate = createUploadThumbnailGenerator();
        // The main part is stored, and its directory entry says it is deflated, so inflating it fails.
        const broken = createDocx({ stored: ['word/document.xml'] });
        const name = new TextEncoder().encode('word/document.xml');
        broken[broken.findLastIndex((_, index) => name.every((byte, offset) => broken[index + offset] === byte)) - 36] = 8;
        const { readDocxPreview } = await import('./docx.js');
        await expect(readDocxPreview(new File([broken], 'broken.docx'))).rejects.toThrow();
        const results = await Promise.all([
            generate(new File([broken], 'broken.docx'), { defaultGenerator }),
            generate(new File([createDocx()], 'report.docx'), { defaultGenerator }),
        ]);
        expect(results).toEqual([undefined, thumbnail]);
    });

    it('skips the Office documents still queued when the upload is cancelled', async () => {
        vi.stubGlobal('OffscreenCanvas', createRecordingCanvas().Canvas);
        const defaultGenerator = vi.fn(async () => thumbnail);
        const generate = createUploadThumbnailGenerator();
        const controller = new AbortController();
        const read = vi.spyOn(Blob.prototype, 'arrayBuffer');
        const results = Promise.all(['a.docx', 'b.docx', 'c.docx'].map(name =>
            generate(new File([createDocx()], name), { defaultGenerator, signal: controller.signal })));
        // The first document's turn has come, and the others wait for it.
        controller.abort();
        expect(await results).toEqual([undefined, undefined, undefined]);
        expect(defaultGenerator).not.toHaveBeenCalled();
        expect(read).not.toHaveBeenCalled();
    });

    it.each([
        new File([createXlsx()], 'budget.xlsx'),
        new File([createXlsx()], 'macros.XLSM'),
        new File([createXlsx()], 'template.xltx'),
        new File([createXlsx()], 'budget', {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
    ])('hands the image generator a drawing of a spreadsheet\'s first sheet', async (file) => {
        const { Canvas, drawn } = createRecordingCanvas();
        vi.stubGlobal('OffscreenCanvas', Canvas);
        const defaultGenerator = vi.fn(async () => thumbnail);
        expect(await createUploadThumbnailGenerator()(file, { defaultGenerator })).toBe(thumbnail);
        expect(defaultGenerator.mock.calls[0][0].type).toBe('image/png');
        expect(drawn.text.map(word => word.text)).toEqual(['Hello']);
        expect(workers).toHaveLength(0);
    });

    it.each([
        new File([createPptx()], 'deck.pptx'),
        new File([createPptx()], 'show.PPSX'),
        new File([createPptx()], 'template.potm'),
        new File([createPptx()], 'deck', {
            type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        }),
    ])('hands the image generator a drawing of a presentation\'s first slide', async (file) => {
        const { Canvas, drawn } = createRecordingCanvas();
        vi.stubGlobal('OffscreenCanvas', Canvas);
        const defaultGenerator = vi.fn(async () => thumbnail);
        expect(await createUploadThumbnailGenerator()(file, { defaultGenerator })).toBe(thumbnail);
        expect(defaultGenerator.mock.calls[0][0].type).toBe('image/png');
        expect(drawn.text.map(word => word.text)).toEqual(['Hello']);
        expect(workers).toHaveLength(0);
    });

    it.each([
        ['a presentation in the older format', new File([createPptx()], 'deck.ppt', { type: 'application/vnd.ms-powerpoint' })],
        ['text that is only named like a presentation', new File(['not a presentation'], 'deck.pptx')],
    ])('does not draw %s', async (_label, file) => {
        const { Canvas, drawn } = createRecordingCanvas();
        vi.stubGlobal('OffscreenCanvas', Canvas);
        const defaultGenerator = vi.fn(async () => undefined);
        expect(await createUploadThumbnailGenerator()(file, { defaultGenerator })).toBeUndefined();
        expect(drawn.text).toEqual([]);
    });

    it('reads spreadsheets and Word documents in one queue, under one deadline', async () => {
        vi.stubGlobal('OffscreenCanvas', createRecordingCanvas().Canvas);
        const defaultGenerator = vi.fn(async () => thumbnail);
        const generate = createUploadThumbnailGenerator();
        expect(await generate(new File([createDocx()], 'report.docx'), { defaultGenerator })).toBe(thumbnail);
        vi.setSystemTime(Date.now() + OFFICE_BATCH_TIMEOUT_MS);
        expect(await generate(new File([createXlsx()], 'budget.xlsx'), { defaultGenerator })).toBeUndefined();
        expect(defaultGenerator).toHaveBeenCalledOnce();
    });

    it.each([
        ['text that is only named like a spreadsheet', 'not a spreadsheet'],
        ['a workbook whose first sheet is empty', createXlsx({ sheet: '<sheetData/>' })],
        ['a Word document named like a spreadsheet', createDocx()],
    ])('skips %s', async (_label, content) => {
        vi.stubGlobal('OffscreenCanvas', createRecordingCanvas().Canvas);
        const defaultGenerator = vi.fn(async () => thumbnail);
        const generate = createUploadThumbnailGenerator();
        expect(await generate(new File([content], 'budget.xlsx'), { defaultGenerator })).toBeUndefined();
        expect(defaultGenerator).not.toHaveBeenCalled();
    });

    it('skips a Word document in a browser without OffscreenCanvas', async () => {
        vi.stubGlobal('OffscreenCanvas', undefined);
        const defaultGenerator = vi.fn(async () => thumbnail);
        const file = new File([createDocx()], 'report.docx');
        expect(await createUploadThumbnailGenerator()(file, { defaultGenerator })).toBeUndefined();
        expect(defaultGenerator).not.toHaveBeenCalled();
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

    it.each([
        new File(['%PDF-1.6\n%\xe2\xe3\xcf\xd3\n1 0 obj'], 'logo.ai'),
        new File(['%PDF-1.6'], 'LOGO.AI', { type: 'application/postscript' }),
        // The marker can come after a few bytes of other data.
        new File([new Uint8Array(200), '%PDF-1.4'], 'logo.ai'),
    ])('renders an Illustrator file that holds a PDF as a PDF', async (file) => {
        const result = createUploadThumbnailGenerator()(file);
        await vi.waitFor(() => expect(workers).toHaveLength(1));
        expect(workers[0].postMessage).toHaveBeenCalledWith(file);
        workers[0].complete();
        expect(await result).toBe(thumbnail);
        expect(workers[0].terminate).toHaveBeenCalledOnce();
    });

    it.each([
        ['an Illustrator file saved without a PDF inside', new File(['%!PS-Adobe-3.0 \n%%Creator: Adobe Illustrator'], 'logo.ai')],
        ['an empty Illustrator file', new File([], 'logo.ai')],
        ['a PostScript file that is not an Illustrator file', new File(['%PDF-1.6'], 'figure.eps', { type: 'application/postscript' })],
    ])('does not start the PDF renderer for %s', async (_label, file) => {
        const defaultGenerator = vi.fn(async () => undefined);
        expect(await createUploadThumbnailGenerator()(file, { defaultGenerator })).toBeUndefined();
        expect(workers).toHaveLength(0);
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

describe('video thumbnails', () => {
    const clip = (name = 'clip.mp4', type = 'video/mp4') => new File(['video'], name, { type });
    let videos;
    let revoked;
    let drawn;

    beforeEach(() => {
        videos = [];
        revoked = [];
        const canvas = createRecordingCanvas();
        drawn = canvas.drawn;
        vi.stubGlobal('OffscreenCanvas', canvas.Canvas);
        // The browser's media element, as far as the reader uses it.
        vi.stubGlobal('document', {
            createElement: vi.fn(() => {
                const video = { videoWidth: 640, videoHeight: 360, duration: 60, removeAttribute: vi.fn(), load: vi.fn() };
                videos.push(video);
                return video;
            }),
        });
        vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:video-${videos.length}`);
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(url => revoked.push(url));
    });

    // Let the queue start the next video.
    const settle = () => vi.advanceTimersByTimeAsync(0);
    const expectReleased = (video, url) => {
        expect(video.removeAttribute).toHaveBeenCalledWith('src');
        expect(video.load).toHaveBeenCalledOnce();
        expect(revoked).toContain(url);
    };

    it.each([
        new File(['video'], 'clip.mp4'),
        new File(['video'], 'CLIP.MOV'),
        new File(['video'], 'clip.m4v'),
        new File(['video'], 'clip.webm'),
        new File(['video'], 'clip', { type: 'video/mp4' }),
        new File(['video'], 'clip', { type: 'video/quicktime' }),
    ])('hands the image generator a frame from a tenth of the way into a video', async (file) => {
        const defaultGenerator = vi.fn(async () => thumbnail);
        const result = createUploadThumbnailGenerator()(file, { defaultGenerator });
        await settle();
        const [video] = videos;
        // With `metadata`, WebKit takes a second to finish each seek.
        expect(video).toMatchObject({ src: 'blob:video-1', muted: true, preload: 'auto' });
        expect(URL.createObjectURL).toHaveBeenCalledWith(file);
        video.onloadedmetadata();
        expect(video.currentTime).toBe(6);
        expect(defaultGenerator).not.toHaveBeenCalled();
        await video.onseeked();
        expect(await result).toBe(thumbnail);
        expect(defaultGenerator.mock.calls[0][0]).toMatchObject({ type: 'image/jpeg' });
        // The frame is scaled to fit the frame dimension, keeping its shape.
        expect(drawn).toMatchObject({ width: 256, height: 144 });
        expect(drawn.images).toEqual([{ image: video, x: 0, y: 0, width: 256, height: 144 }]);
        expectReleased(video, 'blob:video-1');
        expect(vi.getTimerCount()).toBe(0);
        expect(workers).toHaveLength(0);
    });

    it.each([
        [1200, 10],
        [Infinity, 0],
        [NaN, 0],
    ])('seeks a video %s seconds long to %s seconds', async (duration, time) => {
        const result = createUploadThumbnailGenerator()(clip(), { defaultGenerator: async () => thumbnail });
        await settle();
        videos[0].duration = duration;
        videos[0].onloadedmetadata();
        expect(videos[0].currentTime).toBe(time);
        await videos[0].onseeked();
        expect(await result).toBe(thumbnail);
    });

    it('waits for the frame when the browser reports the seek before it can paint', async () => {
        // WebKit's order: `seeked` first, with no frame to draw until the next one is presented.
        const frameCallbacks = [];
        let presented = false;
        vi.stubGlobal('VideoFrame', class {
            constructor () {
                if ( ! presented ) throw new Error('Video element has no video frame');
            }

            close () {}
        });
        const defaultGenerator = vi.fn(async () => thumbnail);
        const result = createUploadThumbnailGenerator()(clip(), { defaultGenerator });
        await settle();
        const [video] = videos;
        video.requestVideoFrameCallback = callback => frameCallbacks.push(callback);
        video.onloadedmetadata();
        // A frame from before the seek is not the one wanted.
        frameCallbacks.shift()();
        await settle();
        expect(drawn.images).toEqual([]);
        await video.onseeked();
        await settle();
        expect(drawn.images).toEqual([]);
        expect(defaultGenerator).not.toHaveBeenCalled();
        presented = true;
        frameCallbacks.shift()();
        expect(await result).toBe(thumbnail);
        expect(drawn.images).toHaveLength(1);
        expectReleased(video, 'blob:video-1');
    });

    it('draws at the seek when the frame is already there, without waiting for another', async () => {
        // Chromium's order: the frame is ready when `seeked` fires, and no later one is presented.
        vi.stubGlobal('VideoFrame', class {
            close () {}
        });
        const result = createUploadThumbnailGenerator()(clip(), { defaultGenerator: async () => thumbnail });
        await settle();
        videos[0].requestVideoFrameCallback = vi.fn();
        videos[0].onloadedmetadata();
        await videos[0].onseeked();
        expect(await result).toBe(thumbnail);
        expect(drawn.images).toHaveLength(1);
    });

    it('does not enlarge a small video', async () => {
        const result = createUploadThumbnailGenerator()(clip(), { defaultGenerator: async () => thumbnail });
        await settle();
        Object.assign(videos[0], { videoWidth: 90, videoHeight: 160 });
        videos[0].onloadedmetadata();
        await videos[0].onseeked();
        await result;
        expect(drawn).toMatchObject({ width: 90, height: 160 });
    });

    it.each(['error', 'no picture', 'timeout', 'cancel', 'canvas failure'])('skips a video on %s and releases it', async (failure) => {
        const controller = new AbortController();
        const defaultGenerator = vi.fn(async () => thumbnail);
        const result = createUploadThumbnailGenerator()(clip(), { defaultGenerator, signal: controller.signal });
        await settle();
        const [video] = videos;
        if ( failure === 'error' ) video.onerror();
        if ( failure === 'no picture' ) {
            video.videoWidth = 0;
            video.onloadedmetadata();
        }
        if ( failure === 'timeout' ) await vi.advanceTimersByTimeAsync(VIDEO_JOB_TIMEOUT_MS);
        if ( failure === 'cancel' ) controller.abort();
        if ( failure === 'canvas failure' ) {
            vi.stubGlobal('OffscreenCanvas', class { constructor () { throw new Error('no canvas'); } });
            video.onloadedmetadata();
            await video.onseeked();
        }
        expect(await result).toBeUndefined();
        expect(defaultGenerator).not.toHaveBeenCalled();
        expectReleased(video, 'blob:video-1');
        expect(vi.getTimerCount()).toBe(0);
        // A frame that arrives late changes nothing.
        video.onloadedmetadata();
        await video.onseeked();
        expect(defaultGenerator).not.toHaveBeenCalled();
    });

    it('loads one video at a time', async () => {
        const defaultGenerator = vi.fn(async () => thumbnail);
        const generate = createUploadThumbnailGenerator();
        const results = [clip('a.mp4'), clip('b.mp4')].map(file => generate(file, { defaultGenerator }));
        await settle();
        expect(videos).toHaveLength(1);
        videos[0].onloadedmetadata();
        await videos[0].onseeked();
        await settle();
        expect(videos).toHaveLength(2);
        videos[1].onloadedmetadata();
        await videos[1].onseeked();
        expect(await Promise.all(results)).toEqual([thumbnail, thumbnail]);
    });

    it('gives up at the deadline on the video still loading and on the videos still queued', async () => {
        const defaultGenerator = vi.fn(async () => thumbnail);
        const generate = createUploadThumbnailGenerator();
        const results = Promise.all([clip('a.mp4'), clip('b.mp4'), clip('c.mp4')].map(file => generate(file, { defaultGenerator })));
        let prepared = false;
        results.then(() => {
            prepared = true;
        });
        await settle();
        // The first video never loads and is given up on, which leaves the second a second before the deadline.
        await vi.advanceTimersByTimeAsync(VIDEO_JOB_TIMEOUT_MS);
        expect(videos).toHaveLength(2);
        await vi.advanceTimersByTimeAsync(VIDEO_BATCH_TIMEOUT_MS - VIDEO_JOB_TIMEOUT_MS - 1);
        expect(prepared).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(prepared).toBe(true);
        expect(await results).toEqual([undefined, undefined, undefined]);
        expect(videos).toHaveLength(2);
        expectReleased(videos[1], 'blob:video-2');
        expect(vi.getTimerCount()).toBe(0);
    });

    it('leaves other files with a video type to the image generator', async () => {
        // Browsers report a TypeScript source file as an MPEG transport stream.
        const file = new File(['export {};'], 'index.ts', { type: 'video/mp2t' });
        const defaultGenerator = vi.fn(async () => undefined);
        expect(await createUploadThumbnailGenerator()(file, { defaultGenerator })).toBeUndefined();
        expect(defaultGenerator).toHaveBeenCalledWith(file);
        expect(videos).toHaveLength(0);
    });
});

describe('audio cover thumbnails', () => {
    const jpeg = psdPreviewJpeg();
    const mp3 = () => createMp3({ frames: [{ name: 'APIC', data: id3Picture({ data: jpeg }) }] });

    it.each([
        new File([mp3()], 'song.mp3'),
        new File([mp3()], 'SONG.MP3', { type: 'audio/mpeg' }),
        new File([mp3()], 'song', { type: 'audio/mpeg' }),
        new File([createFlac({ blocks: [{ type: 6, data: flacPicture({ data: jpeg }) }] })], 'song.flac'),
        new File([createM4a({ cover: jpeg })], 'song.m4a'),
        new File([createM4a({ cover: jpeg })], 'book.m4b'),
        // An audio file in an MP4 container can carry the name a video would.
        new File([createM4a({ cover: jpeg })], 'song.mp4', { type: 'audio/mp4' }),
    ])('hands the image generator the cover stored in an audio file', async (file) => {
        const defaultGenerator = vi.fn(async () => thumbnail);
        expect(await createUploadThumbnailGenerator()(file, { defaultGenerator })).toBe(thumbnail);
        const [cover] = defaultGenerator.mock.calls[0];
        expect(cover.type).toBe('image/jpeg');
        expect(new Uint8Array(await cover.arrayBuffer())).toEqual(jpeg);
        expect(workers).toHaveLength(0);
    });

    it.each([
        ['an audio file with no cover', new File([createMp3({ frames: [{ name: 'TIT2', data: new Uint8Array([0, 65]) }] })], 'song.mp3')],
        ['text that is only named like an audio file', new File(['not audio'], 'song.flac')],
    ])('skips %s', async (_label, file) => {
        const defaultGenerator = vi.fn(async () => thumbnail);
        expect(await createUploadThumbnailGenerator()(file, { defaultGenerator })).toBeUndefined();
        expect(defaultGenerator).not.toHaveBeenCalled();
    });

    it('finds and scales one cover at a time, and skips the files still queued at the deadline', async () => {
        let scaling = 0;
        let most = 0;
        const finish = [];
        const defaultGenerator = vi.fn(() => new Promise((resolve) => {
            most = Math.max(most, ++scaling);
            finish.push(() => {
                scaling--;
                resolve(thumbnail);
            });
        }));
        const generate = createUploadThumbnailGenerator();
        const results = Promise.all(['a.mp3', 'b.mp3', 'c.mp3', 'd.mp3'].map(name => generate(new File([mp3()], name), { defaultGenerator })));
        await vi.waitFor(() => expect(finish).toHaveLength(1));
        finish.shift()();
        await vi.waitFor(() => expect(finish).toHaveLength(1));
        finish.shift()();
        await vi.waitFor(() => expect(finish).toHaveLength(1));
        // The third cover is still being scaled when the deadline passes.
        await vi.advanceTimersByTimeAsync(AUDIO_BATCH_TIMEOUT_MS);
        expect(await results).toEqual([thumbnail, thumbnail, undefined, undefined]);
        expect(most).toBe(1);
        expect(defaultGenerator).toHaveBeenCalledTimes(3);
    });
});

