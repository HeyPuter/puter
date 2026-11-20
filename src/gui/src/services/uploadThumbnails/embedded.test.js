import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDocx, createZip, pngHeader } from '../../../tests/fixtures/docx.js';
import { createEpub } from '../../../tests/fixtures/packages.js';
import { psdPreviewJpeg } from '../../../tests/fixtures/psd.js';
import { EMBEDDED_PREVIEW_MAX_BYTES, EMBEDDED_PREVIEW_MAX_PIXELS } from './config.js';
import { readEmbeddedPreview } from './embedded.js';

const jpeg = psdPreviewJpeg();
const other = new Uint8Array([...jpeg, 1]);
const png = new Uint8Array([...pngHeader(256, 192), 1, 2, 3, 4]);
// An image one byte over the size limit.
const oversized = new Uint8Array(EMBEDDED_PREVIEW_MAX_BYTES + 1);
oversized.set(jpeg);
const bytesOf = async blob => new Uint8Array(await blob.arrayBuffer());
/** Read a package's preview and check it is the image expected. */
const expectPreview = async (bytes, image, type, name = 'file') => {
    const found = await readEmbeddedPreview(new File([bytes], name));
    expect(found).toBeInstanceOf(File);
    expect(found.type).toBe(type);
    expect(await bytesOf(found)).toEqual(image);
};

afterEach(() => vi.restoreAllMocks());

describe('readEmbeddedPreview', () => {
    it('returns the preview a Pages, Numbers or Keynote file keeps of itself, the full one first', async () => {
        const parts = { 'Index/Document.iwa': 'x', 'Metadata/Properties.plist': 'x' };
        await expectPreview(createZip({ ...parts, 'preview-micro.jpg': other, 'preview-web.jpg': other, 'preview.jpg': jpeg }), jpeg, 'image/jpeg');
        await expectPreview(createZip({ ...parts, 'preview-micro.jpg': other, 'preview-web.jpg': jpeg }), jpeg, 'image/jpeg');
        // A file from before 2013 keeps one for Quick Look.
        await expectPreview(createZip({ 'index.xml': '<x/>', 'QuickLook/Thumbnail.jpg': jpeg, 'QuickLook/Preview.pdf': '%PDF' }), jpeg, 'image/jpeg');
    });

    it('does not use a preview too small to show', async () => {
        expect(await readEmbeddedPreview(new File([createZip({ 'Index/Document.iwa': 'x', 'preview-micro.jpg': jpeg })], 'note.pages'))).toBeUndefined();
    });

    it('returns the thumbnail an OpenDocument file holds', async () => {
        const parts = { mimetype: 'application/vnd.oasis.opendocument.text', 'content.xml': '<x/>', 'META-INF/manifest.xml': '<x/>' };
        await expectPreview(createZip({ ...parts, 'Thumbnails/thumbnail.png': png }, { stored: ['mimetype'] }), png, 'image/png');
        await expectPreview(createZip({ ...parts, 'Thumbnails/thumbnail.jpg': jpeg }), jpeg, 'image/jpeg');
    });

    it('returns the preview a Sketch file holds', async () => {
        await expectPreview(createZip({ 'document.json': '{}', 'meta.json': '{}', 'previews/preview.png': png }), png, 'image/png');
    });

    it.each([[['preview.jpg']], [[]]])('reads a preview whether it is stored or deflated (stored: %j)', async (stored) => {
        await expectPreview(createZip({ 'preview.jpg': jpeg }, { stored }), jpeg, 'image/jpeg');
    });

    it('goes by what the image is, and moves on from an entry that is not one or is too large', async () => {
        await expectPreview(createZip({ 'preview.jpg': png }), png, 'image/png');
        await expectPreview(createZip({ 'preview.jpg': 'not an image at all', 'preview-web.jpg': jpeg }), jpeg, 'image/jpeg');
        await expectPreview(createZip({ 'preview.jpg': oversized, 'preview-web.jpg': jpeg }), jpeg, 'image/jpeg');
    });

    it('moves on from a picture that states more pixels than the limit', async () => {
        // A square one pixel wider than the limit allows, in a few bytes.
        const side = Math.sqrt(EMBEDDED_PREVIEW_MAX_PIXELS);
        const huge = new Uint8Array([...pngHeader(side + 1, side), 1, 2, 3, 4]);
        const largest = new Uint8Array([...pngHeader(side, side), 1, 2, 3, 4]);
        await expectPreview(createZip({ 'preview.jpg': huge, 'preview-web.jpg': jpeg }), jpeg, 'image/jpeg');
        await expectPreview(createZip({ 'preview.jpg': largest }), largest, 'image/png');
        expect(await readEmbeddedPreview(new File([createEpub({ cover: huge, coverHref: 'images/cover.png' })], 'book.epub'))).toBeUndefined();
    });

    it('returns a WebP picture, whose size it reads too', async () => {
        // A lossless WebP of 100 x 50 pixels: its signature, then each dimension less one in 14 bits.
        const webp = new Uint8Array([...new TextEncoder().encode('RIFF\x1a\0\0\0WEBPVP8L\x0d\0\0\0'), 0x2f, 0x63, 0x40, 0x0c, 0, 1, 2, 3, 4]);
        await expectPreview(createZip({ 'Thumbnails/thumbnail.png': webp }), webp, 'image/webp');
    });

    it('reads only the directory and the preview of a large package', async () => {
        const file = new File([createZip({ 'Data/movie.mov': new Uint8Array(5_000_000), 'preview.jpg': jpeg }, { stored: ['Data/movie.mov'] })], 'deck.key');
        const read = vi.spyOn(Blob.prototype, 'arrayBuffer');
        expect(await readEmbeddedPreview(file)).toBeInstanceOf(File);
        expect(read.mock.contexts.reduce((total, blob) => total + blob.size, 0)).toBeLessThan(200_000);
    });

    it.each([
        ['an empty file', new Uint8Array(0)],
        // A private key is a text file with the name a Keynote file has.
        ['a file that is not an archive', new TextEncoder().encode('-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----\n')],
        ['a package with no preview', createZip({ 'Index/Document.iwa': 'x' })],
        ['a Word document, which keeps its thumbnail elsewhere', createDocx({ thumbnail: jpeg })],
        ['a package whose preview is encrypted', createZip({ 'preview.jpg': jpeg }, { flags: 1 })],
    ])('returns nothing for %s', async (_label, bytes) => {
        expect(await readEmbeddedPreview(new File([bytes], 'server.key'))).toBeUndefined();
    });

    it('returns nothing for a package cut off anywhere', async () => {
        const zip = createZip({ 'Index/Document.iwa': 'x', 'preview.jpg': jpeg });
        for ( let length = 0; length < zip.length; length += 3 ) {
            expect(await readEmbeddedPreview(new File([zip.subarray(0, length)], 'note.pages'))).toBeUndefined();
        }
    });

    it('stops when the upload is cancelled', async () => {
        const controller = new AbortController();
        controller.abort();
        expect(await readEmbeddedPreview(new File([createZip({ 'preview.jpg': jpeg })], 'note.pages'), controller.signal)).toBeUndefined();
        expect(await readEmbeddedPreview(new File([createEpub({ cover: jpeg })], 'book.epub'), controller.signal)).toBeUndefined();
    });
});

describe('readEmbeddedPreview for an EPUB', () => {
    it.each([
        // Neither file is called a cover, so only the declaration finds it.
        ['an EPUB 3 property on the file', { declare: 'property', coverId: 'img7', coverHref: 'images/front.jpg' }],
        ['an EPUB 2 entry in the metadata', { declare: 'meta', coverId: 'img7', coverHref: 'images/front.jpg' }],
        ['its name alone', { declare: 'none', coverId: 'img1', coverHref: 'images/Cover.jpg' }],
        ['its id alone', { declare: 'none', coverId: 'cover', coverHref: 'images/front.jpg' }],
    ])('returns the cover the package document points to by %s', async (_label, options) => {
        await expectPreview(createEpub({ cover: jpeg, ...options }), jpeg, 'image/jpeg', 'book.epub');
    });

    it('finds the cover whatever the package document is called and wherever it puts the image', async () => {
        await expectPreview(createEpub({ cover: jpeg, packageName: 'content.opf', coverHref: 'cover.jpg' }), jpeg, 'image/jpeg');
        await expectPreview(createEpub({ cover: jpeg, packageName: 'EPUB/text/package.opf', coverHref: '../images/front%20cover.jpg' }), jpeg, 'image/jpeg');
        await expectPreview(createEpub({ cover: jpeg, prefix: 'opf:' }), jpeg, 'image/jpeg');
        await expectPreview(createEpub({ cover: png, declare: 'meta' }), png, 'image/png');
    });

    it('reads the paths in the container and the package document as XML, with their entities', async () => {
        await expectPreview(createZip({
            mimetype: 'application/epub+zip',
            'META-INF/container.xml': '<container><rootfiles><rootfile full-path="Q&amp;A/content.opf"/></rootfiles></container>',
            'Q&A/content.opf': '<package><manifest><item id="c" href="images/Tom%20&amp;%20Jerry&#x27;s.jpg" ' +
                'media-type="image/jpeg" properties="cover-image"/></manifest></package>',
            "Q&A/images/Tom & Jerry's.jpg": jpeg,
        }, { stored: ['mimetype'] }), jpeg, 'image/jpeg', 'book.epub');
    });

    it('goes by the book\'s own cover, not by a preview entry it happens to hold', async () => {
        await expectPreview(createEpub({ cover: jpeg, extra: { 'preview.jpg': other, 'Thumbnails/thumbnail.png': other } }), jpeg, 'image/jpeg');
    });

    it.each([
        ['a book that names no cover', createEpub({ cover: jpeg, declare: 'none', coverId: 'img1', coverHref: 'images/front.jpg' })],
        ['a book whose cover file is missing', createEpub({ declare: 'property' })],
        ['a book whose cover is not an image', createEpub({ cover: '<svg xmlns="http://www.w3.org/2000/svg"/>' })],
        ['a book whose cover is over the size limit', createEpub({ cover: oversized })],
        ['a container that names no package document', createZip({ 'META-INF/container.xml': '<container><rootfiles/></container>', 'preview.jpg': jpeg })],
        ['a container whose package document is missing', createZip({ 'META-INF/container.xml': '<container><rootfiles><rootfile full-path="gone.opf"/></rootfiles></container>' })],
    ])('returns nothing for %s', async (_label, bytes) => {
        expect(await readEmbeddedPreview(new File([bytes], 'book.epub'))).toBeUndefined();
    });

    it('reads a package document with a long list of files without slowing down', async () => {
        // Ten thousand files make a list of about 600 KB, inside what is read of a part.
        const items = Array.from({ length: 10_000 }, (_, index) => `<item id="i${index}" href="images/${index}.png" media-type="image/png"/>`).join('');
        const started = performance.now();
        const book = createZip({
            'META-INF/container.xml': '<container><rootfiles><rootfile full-path="content.opf"/></rootfiles></container>',
            'content.opf': `<package><manifest>${items}<item id="art" href="art.jpg" media-type="image/jpeg" properties="nav cover-image"/></manifest></package>`,
            'art.jpg': jpeg,
        });
        await expectPreview(book, jpeg, 'image/jpeg');
        expect(performance.now() - started).toBeLessThan(2000);
    });
});
