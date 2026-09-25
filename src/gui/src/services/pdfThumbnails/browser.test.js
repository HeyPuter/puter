import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium } from '@playwright/test';
import express from 'express';
import webpack from 'webpack';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyPdfThumbnailAssets } from '../../../tools/copyPdfThumbnailAssets.js';
import { createPdf } from '../../../tests/fixtures/pdf.js';

let browser;
let server;
let cdnServer;
let cdnOrigin;
let directory;
let origin;
let workerMode;

beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'puter-pdf-thumbnails-'));
    await copyPdfThumbnailAssets(directory);
    await new Promise((resolve, reject) => {
        const compiler = webpack({
            mode: 'production',
            entry: fileURLToPath(new URL('./index.js', import.meta.url)),
            output: {
                path: directory,
                filename: 'bundle.js',
                library: { name: 'pdfThumbnails', type: 'window' },
            },
        });
        compiler.run((error, stats) => {
            compiler.close(closeError => {
                if ( error || closeError ) return reject(error || closeError);
                if ( stats.hasErrors() ) return reject(new Error(stats.toString()));
                resolve();
            });
        });
    });
    const cdn = express();
    cdn.use((_req, res, next) => {
        res.set('Access-Control-Allow-Origin', '*');
        next();
    });
    cdn.use('/assets', express.static(directory));
    cdnServer = await new Promise(resolve => {
        const listener = cdn.listen(0, '127.0.0.1', () => resolve(listener));
    });
    cdnOrigin = `http://127.0.0.1:${cdnServer.address().port}`;
    const app = express();
    app.get('/dist/pdf-thumbnails/:version/worker.js', (_req, res, next) => {
        if ( workerMode === 'missing' ) return res.sendStatus(404);
        if ( workerMode === 'busy' ) return res.type('js').send('self.onmessage = () => { while (true) {} };');
        next();
    });
    app.use('/dist', express.static(directory));
    // The generator's relative import into the SDK source climbs past /src, which the browser clamps to /puter-js/src.
    app.use('/puter-js/src', express.static(fileURLToPath(new URL('../../../../puter-js/src/', import.meta.url))));
    app.use('/src', express.static(fileURLToPath(new URL('../../', import.meta.url))));
    app.get('/bundled', (req, res) => res.send(`<!doctype html><title>Bundled thumbnail test</title>
        <script src="${req.query.cdn ? `${cdnOrigin}/assets` : '/dist'}/bundle.js?v=1"></script>
        <script>window.createUploadThumbnailGenerator = window.pdfThumbnails.createUploadThumbnailGenerator;</script>`));
    app.get('/', (_req, res) => res.send(`<!doctype html><title>Thumbnail test</title><script type="module">
        import { createUploadThumbnailGenerator } from '/src/services/pdfThumbnails/index.js';
        import { defaultThumbnailGenerator } from '/puter-js/src/modules/FileSystem/operations/upload/thumbnails.js';
        window.defaultGenerator = defaultThumbnailGenerator;
        window.createUploadThumbnailGenerator = createUploadThumbnailGenerator;
    </script>`));
    server = await new Promise(resolve => {
        const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });
    origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch();
}, 30000);

afterAll(async () => {
    await browser?.close();
    if ( server ) await new Promise(resolve => server.close(resolve));
    if ( cdnServer ) await new Promise(resolve => cdnServer.close(resolve));
    if ( directory ) await rm(directory, { recursive: true, force: true });
});

describe('PDF thumbnails in a real browser', () => {
    it.each([false, true])('loads renderer assets beside the bundle (CDN: %s)', async (cdn) => {
        const page = await browser.newPage();
        const requests = [];
        page.on('request', request => {
            if ( request.url().includes('/pdf-thumbnails/') ) requests.push(request.url());
        });
        try {
            if ( cdn ) await page.route(`${origin}/dist/pdf-thumbnails/**`, route => route.abort());
            await page.goto(`${origin}/bundled${cdn ? '?cdn=1' : ''}`);
            expect(requests).toEqual([]);
            const result = await page.evaluate(async pdf => {
                const thumbnail = await window.createUploadThumbnailGenerator()(new File([pdf], 'test.pdf'));
                if ( ! thumbnail ) return null;
                const image = new Image();
                image.src = thumbnail;
                await image.decode();
                const canvas = document.createElement('canvas');
                canvas.width = image.width;
                canvas.height = image.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(image, 0, 0);
                return { width: image.width, height: image.height, pixel: [...ctx.getImageData(5, 5, 1, 1).data] };
            }, createPdf());
            expect(result).toEqual({ width: 64, height: 128, pixel: [255, 0, 0, 255] });
            const assetBase = `${cdn ? `${cdnOrigin}/assets` : `${origin}/dist`}/pdf-thumbnails/`;
            expect(requests.some(url => url.endsWith('/worker.js'))).toBe(true);
            expect(requests.every(url => url.startsWith(assetBase))).toBe(true);
            await expect.poll(() => page.workers().length).toBe(0);
        } finally {
            await page.close();
        }
    });

    it.each([
        { rotation: 0, scanned: false },
        { rotation: 90, scanned: false },
        { rotation: 0, scanned: true },
    ])('renders the first page with rotation and scanned images: %j', async (options) => {
        const page = await browser.newPage();
        try {
            await page.goto(origin);
            await page.waitForFunction(() => window.createUploadThumbnailGenerator);
            const result = await page.evaluate(async ({ pdf }) => {
                const thumbnail = await window.createUploadThumbnailGenerator()(new File([pdf], 'test.pdf'));
                if ( ! thumbnail ) return null;
                const image = new Image();
                image.src = thumbnail;
                await image.decode();
                const canvas = document.createElement('canvas');
                canvas.width = image.width;
                canvas.height = image.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(image, 0, 0);
                const pixels = ctx.getImageData(0, 0, image.width, image.height).data;
                let whitePixels = 0;
                for ( let i = 0; i < pixels.length; i += 4 ) {
                    if ( pixels[i] > 240 && pixels[i + 1] > 40 && pixels[i + 2] > 40 ) whitePixels++;
                }
                return { width: image.width, height: image.height, pixel: [...ctx.getImageData(5, 5, 1, 1).data], hasText: whitePixels > 0 };
            }, { pdf: createPdf(options) });
            expect(result).toEqual({
                width: options.rotation ? 128 : 64,
                height: options.rotation ? 64 : 128,
                pixel: [255, 0, 0, 255],
                hasText: !options.scanned,
            });
        } finally {
            await page.close();
        }
    });

    it('retains image thumbnails in mixed uploads and leaves original PDF bytes intact', async () => {
        const page = await browser.newPage();
        try {
            await page.goto(origin);
            await page.waitForFunction(() => window.createUploadThumbnailGenerator);
            const result = await page.evaluate(async (pdf) => {
                const canvas = document.createElement('canvas');
                canvas.width = canvas.height = 10;
                const image = new File([await new Promise(resolve => canvas.toBlob(resolve))], 'image.png', { type: 'image/png' });
                const file = new File([pdf], 'document.PDF');
                const generate = window.createUploadThumbnailGenerator();
                const thumbnails = await Promise.all([file, image, new File(['notes'], 'notes.txt')]
                    .map(file => generate(file, { defaultGenerator: window.defaultGenerator })));
                // An SDK without the callback context calls the generator with the file alone.
                const withoutContext = await generate(image);
                return { thumbnails, withoutContext, original: await file.text() };
            }, createPdf());
            expect(result.thumbnails[0]).toMatch(/^data:image\/png;base64,/);
            expect(result.thumbnails[1]).toMatch(/^data:image\//);
            expect(result.thumbnails[2]).toBeUndefined();
            expect(result.withoutContext).toMatch(/^data:image\//);
            expect(result.original).toBe(createPdf());
        } finally {
            await page.close();
        }
    });

    it('skips encrypted, malformed, and oversized-image PDFs without unhandled errors', async () => {
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        try {
            await page.goto(origin);
            await page.waitForFunction(() => window.createUploadThumbnailGenerator);
            const encrypted = [...await readFile(new URL('../../../tests/fixtures/encrypted.pdf', import.meta.url))];
            const result = await page.evaluate(async ({ encrypted, oversized }) => {
                const generate = window.createUploadThumbnailGenerator();
                return await Promise.all([
                    new File([new Uint8Array(encrypted)], 'encrypted.pdf'),
                    new File(['not a PDF'], 'broken.pdf'),
                    new File([oversized], 'oversized.pdf'),
                ].map(file => generate(file)));
            }, { encrypted, oversized: createPdf({ scanned: true, imageSize: 4096 }) });
            expect(result).toEqual([undefined, undefined, undefined]);
            expect(errors).toEqual([]);
        } finally {
            await page.close();
        }
    });

    it('recovers after missing renderer assets', async () => {
        const page = await browser.newPage();
        try {
            workerMode = 'missing';
            await page.goto(origin);
            await page.waitForFunction(() => window.createUploadThumbnailGenerator);
            const generate = () => page.evaluate(async pdf =>
                window.createUploadThumbnailGenerator()(new File([pdf], 'document.pdf')), createPdf());
            expect(await generate()).toBeUndefined();
            workerMode = undefined;
            expect(await generate()).toMatch(/^data:image\/png;base64,/);
        } finally {
            workerMode = undefined;
            await page.close();
        }
    });

    it.each(['timeout', 'cancel'])('terminates CPU-bound rendering on %s while the page stays responsive', async (mode) => {
        const page = await browser.newPage();
        try {
            workerMode = 'busy';
            await page.goto(origin);
            await page.waitForFunction(() => window.createUploadThumbnailGenerator);
            const result = await page.evaluate(async ({ pdf, mode }) => {
                const controller = new AbortController();
                let ticks = 0;
                const timer = setInterval(() => ticks++, 10);
                if ( mode === 'cancel' ) setTimeout(() => controller.abort(), 100);
                const thumbnail = await window.createUploadThumbnailGenerator()(new File([pdf], 'document.pdf'), { signal: controller.signal });
                clearInterval(timer);
                return { thumbnail, ticks };
            }, { pdf: createPdf(), mode });
            expect(result.thumbnail).toBeUndefined();
            expect(result.ticks).toBeGreaterThan(2);
            await expect.poll(() => page.workers().length, { timeout: 5000 }).toBe(0);
        } finally {
            workerMode = undefined;
            await page.close();
        }
    }, 10000);

});
