import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium } from '@playwright/test';
import express from 'express';
import webpack from 'webpack';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyPdfThumbnailAssets } from '../../../tools/copyPdfThumbnailAssets.js';
import { createFlac, createM4a, createMp3, flacPicture, id3Picture } from '../../../tests/fixtures/audio.js';
import { createDoc } from '../../../tests/fixtures/doc.js';
import { createDocx, createZip, paragraph, picture } from '../../../tests/fixtures/docx.js';
import { createEpub } from '../../../tests/fixtures/packages.js';
import { createHeif, createHeifGrid } from '../../../tests/fixtures/heif.js';
import { createPdf } from '../../../tests/fixtures/pdf.js';
import { createPptx, paragraph as slideParagraph, pictureShape, shape, solid } from '../../../tests/fixtures/pptx.js';
import { createPsd, psdPreviewJpeg, psdResource } from '../../../tests/fixtures/psd.js';
import { cell, createXlsx, row, styles } from '../../../tests/fixtures/xlsx.js';

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
                library: { name: 'uploadThumbnails', type: 'window' },
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
        <script>window.createUploadThumbnailGenerator = window.uploadThumbnails.createUploadThumbnailGenerator;</script>`));
    app.get('/', (_req, res) => res.send(`<!doctype html><title>Thumbnail test</title><script type="module">
        import { createUploadThumbnailGenerator } from '/src/services/uploadThumbnails/index.js';
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

describe('Upload thumbnails in a real browser', () => {
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

    it('renders a scanned page whose image is larger than the canvas budget', async () => {
        // 2200 pixels a side is 4.84 megapixels: over what a canvas may hold, so the image is scaled down to be drawn.
        const page = await browser.newPage();
        try {
            await page.goto(origin);
            await page.waitForFunction(() => window.createUploadThumbnailGenerator);
            const result = await page.evaluate(async (pdf) => {
                const thumbnail = await window.createUploadThumbnailGenerator()(new File([pdf], 'scan.pdf'));
                if ( ! thumbnail ) return null;
                const image = new Image();
                image.src = thumbnail;
                await image.decode();
                const canvas = document.createElement('canvas');
                canvas.width = image.width;
                canvas.height = image.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(image, 0, 0);
                return { width: image.width, height: image.height, pixel: [...ctx.getImageData(32, 64, 1, 1).data] };
            }, createPdf({ scanned: true, imageSize: 2200, filled: true }));
            expect(result).toEqual({ width: 64, height: 128, pixel: [255, 0, 0, 255] });
            await expect.poll(() => page.workers().length).toBe(0);
        } finally {
            await page.close();
        }
    });

    it('renders the PDF inside an Illustrator file, and loads no renderer for one without', async () => {
        const page = await browser.newPage();
        const requests = [];
        page.on('request', request => {
            if ( request.url().includes('/pdf-thumbnails/') ) requests.push(request.url());
        });
        try {
            await page.goto(origin);
            await page.waitForFunction(() => window.createUploadThumbnailGenerator);
            const generate = (content, name) => page.evaluate(async ([content, name]) => {
                const thumbnail = await window.createUploadThumbnailGenerator()(new File([content], name));
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
            }, [content, name]);
            expect(await generate('%!PS-Adobe-3.0\n%%Creator: Adobe Illustrator(R) 8.0\n', 'old.ai')).toBeNull();
            expect(requests).toEqual([]);
            expect(await generate(createPdf(), 'logo.ai')).toEqual({ width: 64, height: 128, pixel: [255, 0, 0, 255] });
            expect(requests.some(url => url.endsWith('/worker.js'))).toBe(true);
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

    it.each([false, true])('scales a PSD\'s embedded preview, or else its merged image (bundled: %s)', async (bundled) => {
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        try {
            await page.goto(bundled ? `${origin}/bundled` : origin);
            await page.waitForFunction(() => window.createUploadThumbnailGenerator);
            const result = await page.evaluate(async ({ psd, withoutPreview, cmyk }) => {
                const generate = window.createUploadThumbnailGenerator();
                // The bundled page has no SDK generator to pass, as with an SDK that predates the callback context.
                const context = window.defaultGenerator && { defaultGenerator: window.defaultGenerator };
                const [preview, merged, ...skipped] = await Promise.all([
                    new File([new Uint8Array(psd)], 'art.psd'),
                    new File([new Uint8Array(withoutPreview)], 'flat.psd'),
                    new File([new Uint8Array(cmyk)], 'print.psd'),
                    new File(['not a Photoshop document'], 'broken.psd', { type: 'image/vnd.adobe.photoshop' }),
                ].map(file => generate(file, context)));
                const decode = async (thumbnail) => {
                    if ( ! thumbnail ) return null;
                    const image = new Image();
                    image.src = thumbnail;
                    await image.decode();
                    const canvas = document.createElement('canvas');
                    canvas.width = image.width;
                    canvas.height = image.height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(image, 0, 0);
                    const pixel = y => [...ctx.getImageData(5, y, 1, 1).data];
                    return { width: image.width, height: image.height, top: pixel(5), bottom: pixel(image.height - 5) };
                };
                return { preview: await decode(preview), merged: await decode(merged), skipped };
            }, {
                psd: [...createPsd()],
                // 600 x 300, green where it is opaque; the top half is transparent.
                withoutPreview: [...createPsd({
                    resources: [psdResource(1005, [1, 2])],
                    width: 600,
                    height: 300,
                    channels: [0, 255, 0].map(value => new Uint8Array(600 * 300).fill(value))
                        .concat(new Uint8Array(600 * 300).fill(255, 600 * 150)),
                    layerCount: -1,
                    compression: 1,
                })],
                cmyk: [...createPsd({ resources: [], colorMode: 4, channels: [[0], [0], [0], [0]] })],
            });
            const near = expected => pixel => pixel.every((value, index) => Math.abs(value - expected[index]) < 15);
            expect(result.preview).toMatchObject({ width: 128, height: 64 });
            expect(result.preview.top).toSatisfy(near([255, 0, 0, 255]));
            expect(result.merged).toMatchObject({ width: 128, height: 64 });
            expect(result.merged.top).toSatisfy(near([255, 255, 255, 255]));
            expect(result.merged.bottom).toSatisfy(near([0, 255, 0, 255]));
            expect(result.skipped).toEqual([undefined, undefined]);
            expect(errors).toEqual([]);
        } finally {
            await page.close();
        }
    });

    it.each([false, true])('draws a Word document\'s first page, or scales the thumbnail stored in it (bundled: %s)', async (bundled) => {
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        try {
            await page.goto(bundled ? `${origin}/bundled` : origin);
            await page.waitForFunction(() => window.createUploadThumbnailGenerator);
            const result = await page.evaluate(async ({ docx, doc, withThumbnail, blank }) => {
                const generate = window.createUploadThumbnailGenerator();
                // The bundled page has no SDK generator to pass, as with an SDK that predates the callback context.
                const context = window.defaultGenerator && { defaultGenerator: window.defaultGenerator };
                const [drawn, legacy, stored, ...skipped] = await Promise.all([
                    new File([new Uint8Array(docx)], 'report.docx'),
                    new File([new Uint8Array(doc)], 'letter.doc'),
                    new File([new Uint8Array(withThumbnail)], 'saved.docx'),
                    new File([new Uint8Array(blank)], 'blank.docx'),
                    new File(['not a Word document'], 'broken.doc', { type: 'application/msword' }),
                ].map(file => generate(file, context)));
                const decode = async (thumbnail) => {
                    if ( ! thumbnail ) return null;
                    const image = new Image();
                    image.src = thumbnail;
                    await image.decode();
                    const canvas = document.createElement('canvas');
                    canvas.width = image.width;
                    canvas.height = image.height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(image, 0, 0);
                    const pixel = (x, y) => [...ctx.getImageData(x, y, 1, 1).data];
                    // How many pixels of the rows from `top` to `bottom` are not white. Text this small is gray.
                    const inked = (top, bottom) => {
                        const { data } = ctx.getImageData(0, top, image.width, bottom - top);
                        let count = 0;
                        for ( let at = 0; at < data.length; at += 4 ) {
                            if ( data[at] + data[at + 1] + data[at + 2] < 690 ) count++;
                        }
                        return count;
                    };
                    return { width: image.width, height: image.height, pixel, inked };
                };
                const [drawnImage, legacyImage, storedImage] = await Promise.all([drawn, legacy, stored].map(decode));
                return {
                    drawn: drawnImage && {
                        width: drawnImage.width,
                        height: drawnImage.height,
                        margin: drawnImage.pixel(3, 3),
                        heading: drawnImage.inked(12, 26),
                        picture: drawnImage.pixel(49, 45),
                        below: drawnImage.inked(70, 128),
                    },
                    legacy: legacyImage && {
                        width: legacyImage.width,
                        height: legacyImage.height,
                        text: legacyImage.inked(11, 20),
                        below: legacyImage.inked(20, 128),
                    },
                    stored: storedImage && {
                        width: storedImage.width,
                        height: storedImage.height,
                        pixel: storedImage.pixel(5, 5),
                    },
                    skipped,
                };
            }, {
                // US Letter: a 72 point bold heading, then a red picture as wide as the text area.
                docx: [...createDocx({
                    body: `<w:p><w:r><w:rPr><w:b/><w:sz w:val="144"/></w:rPr><w:t>Heading</w:t></w:r></w:p><w:p>${picture('rId1', 468, 234)}</w:p>`,
                    media: { 'image1.jpeg': psdPreviewJpeg() },
                })],
                doc: [...createDoc({ pieces: [{ text: 'A letter in the older format\r', compressed: true }] })],
                withThumbnail: [...createDocx({ thumbnail: psdPreviewJpeg() })],
                blank: [...createDocx({ body: paragraph('') })],
            });
            const near = expected => pixel => pixel.every((value, index) => Math.abs(value - expected[index]) < 15);
            expect(result.drawn).toMatchObject({ width: 99, height: 128, below: 0 });
            expect(result.drawn.margin).toSatisfy(near([255, 255, 255, 255]));
            expect(result.drawn.heading).toBeGreaterThan(20);
            expect(result.drawn.picture).toSatisfy(near([255, 0, 0, 255]));
            expect(result.legacy).toMatchObject({ width: 99, height: 128, below: 0 });
            expect(result.legacy.text).toBeGreaterThan(0);
            expect(result.stored).toMatchObject({ width: 128, height: 64 });
            expect(result.stored.pixel).toSatisfy(near([255, 0, 0, 255]));
            expect(result.skipped).toEqual([undefined, undefined]);
            expect(errors).toEqual([]);
        } finally {
            await page.close();
        }
    });

    it.each([false, true])('draws the top-left of a spreadsheet\'s first sheet (bundled: %s)', async (bundled) => {
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        try {
            await page.goto(bundled ? `${origin}/bundled` : origin);
            await page.waitForFunction(() => window.createUploadThumbnailGenerator);
            const result = await page.evaluate(async ({ xlsx, empty }) => {
                const generate = window.createUploadThumbnailGenerator();
                const context = window.defaultGenerator && { defaultGenerator: window.defaultGenerator };
                const [drawn, ...skipped] = await Promise.all([
                    new File([new Uint8Array(xlsx)], 'budget.xlsx'),
                    new File([new Uint8Array(empty)], 'empty.xlsx'),
                    new File(['not a spreadsheet'], 'broken.xlsx'),
                ].map(file => generate(file, context)));
                const image = new Image();
                image.src = drawn;
                await image.decode();
                const canvas = document.createElement('canvas');
                canvas.width = image.width;
                canvas.height = image.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(image, 0, 0);
                const pixel = (x, y) => [...ctx.getImageData(x, y, 1, 1).data];
                // The darkest pixel of a box, as the sum of its channels.
                const darkest = (x, y, width, height) => {
                    const { data } = ctx.getImageData(x, y, width, height);
                    let least = 765;
                    for ( let at = 0; at < data.length; at += 4 ) least = Math.min(least, data[at] + data[at + 1] + data[at + 2]);
                    return least;
                };
                return {
                    width: image.width,
                    height: image.height,
                    filled: pixel(20, 4),
                    besideFill: pixel(100, 4),
                    text: darkest(1, 9, 24, 6),
                    emptyCell: darkest(70, 54, 8, 3),
                    skipped,
                };
            }, {
                // Row 1 is 30 points tall, 8 pixels of the thumbnail, with its first three cells filled red.
                xlsx: [...createXlsx({
                    styles: styles({
                        fills: '<fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
                            '<fill><patternFill patternType="solid"><fgColor rgb="FFFF0000"/></patternFill></fill>',
                        fonts: '<font/><font><b/><sz val="20"/></font>',
                        formats: '<xf/><xf fillId="2"/><xf fontId="1"/>',
                    }),
                    sheet: `<sheetData>${row(1, cell('A1', '', { style: 1 }) + cell('B1', '', { style: 1 }) + cell('C1', '', { style: 1 }), ' ht="30"')}${
                        row(2, cell('A2', 'Totals', { type: 'str', style: 2 }), ' ht="24"')}</sheetData>`,
                })],
                empty: [...createXlsx({ sheet: '<sheetData/>' })],
            });
            const near = expected => pixel => pixel.every((value, index) => Math.abs(value - expected[index]) < 15);
            expect(result).toMatchObject({ width: 128, height: 128, skipped: [undefined, undefined] });
            expect(result.filled).toSatisfy(near([255, 0, 0, 255]));
            expect(result.besideFill).toSatisfy(near([255, 255, 255, 255]));
            expect(result.text).toBeLessThan(400);
            // Gridlines are light, and the inside of an empty cell is white.
            expect(result.emptyCell).toBeGreaterThan(690);
            expect(errors).toEqual([]);
        } finally {
            await page.close();
        }
    });

    it.each([false, true])('draws a presentation\'s first slide, or scales the thumbnail stored in it (bundled: %s)', async (bundled) => {
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        try {
            await page.goto(bundled ? `${origin}/bundled` : origin);
            await page.waitForFunction(() => window.createUploadThumbnailGenerator);
            const result = await page.evaluate(async ({ pptx, withThumbnail, empty }) => {
                const generate = window.createUploadThumbnailGenerator();
                const context = window.defaultGenerator && { defaultGenerator: window.defaultGenerator };
                const [drawn, stored, ...skipped] = await Promise.all([
                    new File([new Uint8Array(pptx)], 'deck.pptx'),
                    new File([new Uint8Array(withThumbnail)], 'saved.pptx'),
                    new File([new Uint8Array(empty)], 'empty.pptx'),
                    new File(['not a presentation'], 'broken.pptx'),
                ].map(file => generate(file, context)));
                const decode = async (thumbnail) => {
                    const image = new Image();
                    image.src = thumbnail;
                    await image.decode();
                    const canvas = document.createElement('canvas');
                    canvas.width = image.width;
                    canvas.height = image.height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(image, 0, 0);
                    const pixel = (x, y) => [...ctx.getImageData(x, y, 1, 1).data];
                    // How many pixels of a box are closer to white than to the dark background.
                    const light = (x, y, width, height) => {
                        const { data } = ctx.getImageData(x, y, width, height);
                        let count = 0;
                        for ( let at = 0; at < data.length; at += 4 ) {
                            if ( data[at] + data[at + 1] + data[at + 2] > 500 ) count++;
                        }
                        return count;
                    };
                    return { width: image.width, height: image.height, pixel, light };
                };
                const slide = await decode(drawn);
                const saved = await decode(stored);
                return {
                    slide: {
                        width: slide.width,
                        height: slide.height,
                        background: slide.pixel(4, 68),
                        title: slide.light(8, 6, 110, 16),
                        band: slide.pixel(64, 36),
                        picture: slide.pixel(100, 54),
                        circle: slide.pixel(20, 52),
                    },
                    saved: { width: saved.width, height: saved.height, pixel: saved.pixel(5, 5) },
                    skipped,
                };
            }, {
                // A 16:9 slide: a dark background from the master, a white title placed by the layout, a green band
                // across the middle, a red picture at the right and a blue circle at the left.
                pptx: [...createPptx({
                    size: [960, 540],
                    slide: {
                        shapes: shape({ placeholder: 'type="title"', text: slideParagraph('Quarterly review') }) +
                            shape({ box: [0, 250, 960, 40], fill: solid('00C800') }) +
                            pictureShape('rId2', [660, 330, 240, 120]) +
                            shape({ box: [90, 330, 120, 120], fill: solid('0000FF'), geometry: 'ellipse' }),
                    },
                    layout: { shapes: shape({ placeholder: 'type="title"', box: [60, 40, 840, 130], text: slideParagraph('Click to add title') }) },
                    master: {
                        background: '<p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef>',
                        colorMap: 'bg1="dk2" tx1="lt1" bg2="dk1" tx2="lt2"',
                        textStyles: '<p:titleStyle><a:lvl1pPr algn="ctr"><a:defRPr sz="8000" b="1"/></a:lvl1pPr></p:titleStyle>',
                    },
                    theme: ['000000', 'FFFFFF', '10203A', 'EEEEEE', '4F81BD', 'C0504D'],
                    media: { 'image1.jpeg': psdPreviewJpeg() },
                })],
                withThumbnail: [...createPptx({ thumbnail: psdPreviewJpeg() })],
                empty: [...createPptx({ slide: { shapes: '' } })],
            });
            const near = expected => pixel => pixel.every((value, index) => Math.abs(value - expected[index]) < 20);
            expect(result.slide).toMatchObject({ width: 128, height: 72 });
            expect(result.slide.background).toSatisfy(near([16, 32, 58, 255]));
            expect(result.slide.title).toBeGreaterThan(40);
            expect(result.slide.band).toSatisfy(near([0, 200, 0, 255]));
            expect(result.slide.picture).toSatisfy(near([255, 0, 0, 255]));
            expect(result.slide.circle).toSatisfy(near([0, 0, 255, 255]));
            expect(result.saved).toMatchObject({ width: 128, height: 64 });
            expect(result.saved.pixel).toSatisfy(near([255, 0, 0, 255]));
            expect(result.skipped).toEqual([undefined, undefined]);
            expect(errors).toEqual([]);
        } finally {
            await page.close();
        }
    });

    it.each([false, true])('shows a HEIC photo where the device can decode it, and keeps its icon where it can\'t (bundled: %s)', async (bundled) => {
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        try {
            await page.goto(bundled ? `${origin}/bundled` : origin);
            await page.waitForFunction(() => window.createUploadThumbnailGenerator);
            const result = await page.evaluate(async (files) => {
                // The browser this suite installs has no HEVC decoder, and one with a licensed build or a GPU's does.
                const decodes = typeof VideoDecoder !== 'undefined' &&
                    (await VideoDecoder.isConfigSupported({ codec: 'hvc1.3.E.L30.B0', codedWidth: 128, codedHeight: 64 }).catch(() => ({}))).supported === true;
                const generate = window.createUploadThumbnailGenerator();
                const context = window.defaultGenerator && { defaultGenerator: window.defaultGenerator };
                const thumbnails = await Promise.all(files.map(([name, bytes]) => generate(new File([new Uint8Array(bytes)], name), context)));
                const photos = await Promise.all(thumbnails.map(async (thumbnail) => {
                    if ( ! thumbnail ) return null;
                    const image = new Image();
                    image.src = thumbnail;
                    await image.decode();
                    const canvas = document.createElement('canvas');
                    canvas.width = image.width;
                    canvas.height = image.height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(image, 0, 0);
                    const pixel = x => [...ctx.getImageData(x, image.height >> 1, 1, 1).data];
                    return { width: image.width, height: image.height, left: pixel(8), right: pixel(image.width - 8) };
                }));
                return { decodes, photos };
            }, [
                ['photo.heic', [...createHeif()]],
                ['large.heic', [...createHeifGrid({ rows: 2, columns: 2 })]],
                ['broken.heic', [...new TextEncoder().encode('not a photo')]],
            ]);
            if ( result.decodes ) {
                // The picture is red on its left half and blue on its right, and a grid repeats it.
                const near = expected => pixel => pixel.every((value, index) => Math.abs(value - expected[index]) < 40);
                expect(result.photos[0]).toMatchObject({ width: 128, height: 64 });
                expect(result.photos[1]).toMatchObject({ width: 128, height: 64 });
                for ( const photo of result.photos.slice(0, 2) ) {
                    expect(photo.left).toSatisfy(near([235, 15, 0, 255]));
                    expect(photo.right).toSatisfy(near([0, 10, 230, 255]));
                }
            } else {
                expect(result.photos.slice(0, 2)).toEqual([null, null]);
            }
            expect(result.photos[2]).toBeNull();
            expect(errors).toEqual([]);
        } finally {
            await page.close();
        }
    });

    it.each([false, true])('scales the picture a packaged document carries of itself (bundled: %s)', async (bundled) => {
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        try {
            await page.goto(bundled ? `${origin}/bundled` : origin);
            await page.waitForFunction(() => window.createUploadThumbnailGenerator);
            const result = await page.evaluate(async (files) => {
                const generate = window.createUploadThumbnailGenerator();
                const context = window.defaultGenerator && { defaultGenerator: window.defaultGenerator };
                const thumbnails = await Promise.all(files.map(([name, bytes]) => generate(new File([new Uint8Array(bytes)], name), context)));
                return Promise.all(thumbnails.map(async (thumbnail) => {
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
                }));
            }, [
                // Each holds the same 160 x 80 red JPEG where its format keeps its picture.
                ['letter.pages', [...createZip({ 'Index/Document.iwa': 'x', 'preview-web.jpg': psdPreviewJpeg(), 'preview.jpg': psdPreviewJpeg() })]],
                ['old.key', [...createZip({ 'index.apxl': '<x/>', 'QuickLook/Thumbnail.jpg': psdPreviewJpeg() })]],
                ['letter.odt', [...createZip({ 'content.xml': '<x/>', 'Thumbnails/thumbnail.jpg': psdPreviewJpeg() })]],
                ['app.sketch', [...createZip({ 'document.json': '{}', 'previews/preview.png': psdPreviewJpeg() })]],
                ['book.epub', [...createEpub({ cover: psdPreviewJpeg(), declare: 'meta' })]],
                ['empty.numbers', [...createZip({ 'Index/Document.iwa': 'x' })]],
                ['server.key', [...new TextEncoder().encode('-----BEGIN PRIVATE KEY-----')]],
            ]);
            const near = expected => pixel => pixel.every((value, index) => Math.abs(value - expected[index]) < 15);
            for ( const shown of result.slice(0, 5) ) {
                expect(shown).toMatchObject({ width: 128, height: 64 });
                expect(shown.pixel).toSatisfy(near([255, 0, 0, 255]));
            }
            expect(result.slice(5)).toEqual([null, null]);
            expect(errors).toEqual([]);
        } finally {
            await page.close();
        }
    });

    it.each([false, true])('scales the cover stored in an audio file (bundled: %s)', async (bundled) => {
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        try {
            await page.goto(bundled ? `${origin}/bundled` : origin);
            await page.waitForFunction(() => window.createUploadThumbnailGenerator);
            const result = await page.evaluate(async (files) => {
                const generate = window.createUploadThumbnailGenerator();
                const context = window.defaultGenerator && { defaultGenerator: window.defaultGenerator };
                const thumbnails = await Promise.all(files.map(([name, bytes]) => generate(new File([new Uint8Array(bytes)], name), context)));
                return Promise.all(thumbnails.map(async (thumbnail) => {
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
                }));
            }, [
                ['song.mp3', [...createMp3({ frames: [{ name: 'APIC', data: id3Picture({ data: psdPreviewJpeg(), description: 'Front', encoding: 1 }) }] })]],
                ['song.flac', [...createFlac({ blocks: [{ type: 6, data: flacPicture({ data: psdPreviewJpeg() }) }] })]],
                ['song.m4a', [...createM4a({ cover: psdPreviewJpeg(), audioBytes: 200_000 })]],
                ['plain.mp3', [...createMp3({ frames: [{ name: 'TIT2', data: new Uint8Array([0, 65]) }] })]],
            ]);
            const near = expected => pixel => pixel.every((value, index) => Math.abs(value - expected[index]) < 15);
            // The cover is a 160 x 80 red JPEG.
            for ( const cover of result.slice(0, 3) ) {
                expect(cover).toMatchObject({ width: 128, height: 64 });
                expect(cover.pixel).toSatisfy(near([255, 0, 0, 255]));
            }
            expect(result[3]).toBeNull();
            expect(errors).toEqual([]);
        } finally {
            await page.close();
        }
    });

    it.each([false, true])('takes a frame from a little way into a video (bundled: %s)', async (bundled) => {
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        try {
            await page.goto(bundled ? `${origin}/bundled` : origin);
            await page.waitForFunction(() => window.createUploadThumbnailGenerator);
            const video = [...await readFile(new URL('../../../tests/fixtures/video.mp4', import.meta.url))];
            const result = await page.evaluate(async (video) => {
                const generate = window.createUploadThumbnailGenerator();
                const context = window.defaultGenerator && { defaultGenerator: window.defaultGenerator };
                const [frame, ...skipped] = await Promise.all([
                    new File([new Uint8Array(video)], 'clip.mp4', { type: 'video/mp4' }),
                    new File(['not a video'], 'broken.mp4', { type: 'video/mp4' }),
                    // Cut off in the middle of its index, so the player can't open it.
                    new File([new Uint8Array(video.slice(0, 600))], 'short.mp4'),
                ].map(file => generate(file, context)));
                const image = new Image();
                image.src = frame;
                await image.decode();
                const canvas = document.createElement('canvas');
                canvas.width = image.width;
                canvas.height = image.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(image, 0, 0);
                return {
                    width: image.width,
                    height: image.height,
                    pixel: [...ctx.getImageData(64, 32, 1, 1).data],
                    skipped,
                    videos: document.querySelectorAll('video').length,
                };
            }, video);
            // The video opens on a black frame and is green from 0.1 seconds on.
            expect(result).toMatchObject({ width: 128, height: 64, skipped: [undefined, undefined], videos: 0 });
            expect(result.pixel[1]).toBeGreaterThan(150);
            expect(result.pixel[0] + result.pixel[2]).toBeLessThan(100);
            expect(errors).toEqual([]);
        } finally {
            await page.close();
        }
    });

    it.each([false, true])('draws the start of a source file in color, and a Markdown file as a page (bundled: %s)', async (bundled) => {
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        try {
            await page.goto(bundled ? `${origin}/bundled` : origin);
            await page.waitForFunction(() => window.createUploadThumbnailGenerator);
            const result = await page.evaluate(async () => {
                const generate = window.createUploadThumbnailGenerator();
                // The bundled page has no SDK generator to pass, as with an SDK that predates the callback context.
                const context = window.defaultGenerator && { defaultGenerator: window.defaultGenerator };
                const [script, comment, sheet, markdown, ...skipped] = await Promise.all([
                    // Three lines of keywords, then a line far longer than the page is wide.
                    new File([`${'return return return\n'.repeat(3)}${'W'.repeat(400)}\n`], 'app.js'),
                    new File(['// nothing here but a comment\n'], 'note.mjs'),
                    new File(['a { color: red; }\n'], 'site.css', { type: 'text/css' }),
                    new File([`# Heading\n\n${'W'.repeat(60)}\n`], 'README.md'),
                    new File(['\n\n'], 'blank.js'),
                    new File(['![logo](logo.png)\n'], 'pictures.md'),
                    new File([new Uint8Array(64)], 'binary.css'),
                ].map(file => generate(file, context)));
                const decode = async (thumbnail) => {
                    if ( ! thumbnail ) return null;
                    const image = new Image();
                    image.src = thumbnail;
                    await image.decode();
                    const canvas = document.createElement('canvas');
                    canvas.width = image.width;
                    canvas.height = image.height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(image, 0, 0);
                    // How many pixels of a box are not white, and how many of those are red. Text this small is pale.
                    const inked = (left, top, right, bottom) => {
                        const { data } = ctx.getImageData(left, top, right - left, bottom - top);
                        let count = 0;
                        let red = 0;
                        for ( let at = 0; at < data.length; at += 4 ) {
                            if ( data[at] + data[at + 1] + data[at + 2] < 690 ) count++;
                            if ( data[at] > data[at + 1] + 30 && data[at] > data[at + 2] + 30 ) red++;
                        }
                        return { count, red };
                    };
                    return {
                        width: image.width,
                        height: image.height,
                        corner: [...ctx.getImageData(2, 2, 1, 1).data],
                        top: inked(0, 5, image.width, 22),
                        // The fourth line of the script, and the lines the paragraph wraps onto.
                        middle: inked(0, 22, image.width, 60),
                        rightEdge: inked(image.width - 5, 5, image.width, 60),
                        below: inked(0, 100, image.width, image.height),
                    };
                };
                return {
                    pages: await Promise.all([script, comment, sheet, markdown].map(decode)),
                    skipped,
                };
            });
            const [script, comment, sheet, markdown] = result.pages;
            const near = expected => pixel => pixel.every((value, index) => Math.abs(value - expected[index]) < 15);
            for ( const drawn of result.pages ) {
                expect(drawn).toMatchObject({ width: 99, height: 128, below: { count: 0 } });
                expect(drawn.corner).toSatisfy(near([255, 255, 255, 255]));
                expect(drawn.top.count).toBeGreaterThan(10);
            }
            // Keywords are drawn in red and a comment is not.
            expect(script.top.red).toBeGreaterThan(10);
            expect(comment.top.red).toBe(0);
            expect(sheet.top.red).toBe(0);
            // The script's long line runs off the page, and the page's long word wraps inside its margins.
            expect(script.rightEdge.count).toBeGreaterThan(0);
            expect(markdown.rightEdge.count).toBe(0);
            expect(markdown.middle.count).toBeGreaterThan(script.middle.count);
            expect(result.skipped).toEqual([undefined, undefined, undefined]);
            expect(errors).toEqual([]);
        } finally {
            await page.close();
        }
    });

    it.each([false, true])('draws JSON written on one line indented, and a CSV file as a sheet (bundled: %s)', async (bundled) => {
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        try {
            await page.goto(bundled ? `${origin}/bundled` : origin);
            await page.waitForFunction(() => window.createUploadThumbnailGenerator);
            const result = await page.evaluate(async () => {
                const generate = window.createUploadThumbnailGenerator();
                const context = window.defaultGenerator && { defaultGenerator: window.defaultGenerator };
                const rows = Array.from({ length: 40 }, (_, index) => `row${index},${index * 10}`).join('\n');
                const [minified, csv, ...skipped] = await Promise.all([
                    // One line far wider than the page, which reads as many short lines once indented.
                    new File([JSON.stringify({ items: Array.from({ length: 40 }, (_, index) => ({ id: index })) })], 'data.json'),
                    new File([`name,total\n${rows}\n`], 'table.csv', { type: 'text/csv' }),
                    new File(['\n\n'], 'blank.json'),
                    new File([',,,\n,,\n'], 'empty.csv'),
                    new File([new Uint8Array(64)], 'binary.csv'),
                ].map(file => generate(file, context)));
                const decode = async (thumbnail) => {
                    const image = new Image();
                    image.src = thumbnail;
                    await image.decode();
                    const canvas = document.createElement('canvas');
                    canvas.width = image.width;
                    canvas.height = image.height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(image, 0, 0);
                    // How many pixels of a box are not white.
                    const inked = (left, top, right, bottom) => {
                        const { data } = ctx.getImageData(left, top, right - left, bottom - top);
                        let count = 0;
                        for ( let at = 0; at < data.length; at += 4 ) {
                            if ( data[at] + data[at + 1] + data[at + 2] < 690 ) count++;
                        }
                        return count;
                    };
                    return {
                        width: image.width,
                        height: image.height,
                        corner: [...ctx.getImageData(2, 2, 1, 1).data],
                        top: inked(0, 0, image.width, 20),
                        // Halfway down, where a page of one long line is blank.
                        middle: inked(0, image.height / 2 - 10, image.width, image.height / 2 + 10),
                        bottom: inked(0, image.height - 15, image.width, image.height),
                    };
                };
                return { minified: await decode(minified), csv: await decode(csv), skipped };
            });
            const { minified, csv } = result;
            expect(minified).toMatchObject({ width: 99, height: 128 });
            expect(minified.corner).toEqual([255, 255, 255, 255]);
            expect(minified.top).toBeGreaterThan(10);
            expect(minified.middle).toBeGreaterThan(10);
            // A sheet fills a square to its edges, gridlines and all.
            expect(csv).toMatchObject({ width: 128, height: 128 });
            expect(csv.top).toBeGreaterThan(10);
            expect(csv.bottom).toBeGreaterThan(10);
            expect(result.skipped).toEqual([undefined, undefined, undefined]);
            expect(errors).toEqual([]);
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
            // One pixel a side more than the largest image a page may hold.
            }, { encrypted, oversized: createPdf({ scanned: true, imageSize: 4097 }) });
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
