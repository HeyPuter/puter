import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPsd, psdPreviewJpeg, psdPreviewResource, psdResource } from '../../../tests/fixtures/psd.js';
import { PSD_COMPOSITE_MAX_READ_BYTES, PSD_PREVIEW_MAX_BYTES, PSD_PREVIEW_MAX_READ_BYTES } from './config.js';
import { readPsdPreview } from './psd.js';

const psdFile = options => new File([createPsd(options)], 'art.psd');
const bytesOf = async blob => blob && new Uint8Array(await blob.arrayBuffer());
const withoutPreview = options => psdFile({ resources: [], ...options });
// Decode the 24-bit BMP a merged image is returned as into rows of [red, green, blue] pixels, top row first.
const pixelsOf = async (image) => {
    expect(image).toBeInstanceOf(File);
    expect(image.type).toBe('image/bmp');
    const bytes = await bytesOf(image);
    const view = new DataView(bytes.buffer);
    const width = view.getInt32(18, true);
    const height = view.getInt32(22, true);
    const stride = (width * 3 + 3) & ~3;
    expect(String.fromCharCode(bytes[0], bytes[1])).toBe('BM');
    expect(bytes.length).toBe(view.getUint32(10, true) + stride * height);
    return Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => {
        const at = view.getUint32(10, true) + (height - 1 - y) * stride + x * 3;
        return [bytes[at + 2], bytes[at + 1], bytes[at]];
    }));
};
// A 4 x 2 image with runs and single values in every row, so RLE rows mix both packet kinds.
const red = [10, 10, 10, 40, 50, 60, 70, 70];
const green = [1, 2, 3, 4, 9, 9, 9, 9];
const blue = [200, 200, 201, 202, 0, 255, 0, 255];
const artwork = { width: 4, height: 2, channels: [red, green, blue] };
const artworkPixels = [0, 1].map(y => [0, 1, 2, 3].map(x => [red, green, blue].map(channel => channel[y * 4 + x])));
// A document too large to allocate: its real bytes, then zeros up to `size`.
const sparseFile = (head, size) => ({
    size,
    slice: (start, end) => new Blob([
        head.subarray(start, end),
        new Uint8Array(Math.max(0, Math.min(end, size) - Math.max(start, head.length))),
    ]),
});
// Every read the parser makes goes through a slice's arrayBuffer().
const trackReads = () => {
    const read = vi.spyOn(Blob.prototype, 'arrayBuffer');
    return () => read.mock.contexts.reduce((total, blob) => total + blob.size, 0);
};

afterEach(() => vi.restoreAllMocks());

describe('readPsdPreview', () => {
    it.each([1, 2])('returns the embedded JPEG of a version %i document', async (version) => {
        const preview = await readPsdPreview(psdFile({ version }));
        expect(preview).toBeInstanceOf(File);
        expect(preview.type).toBe('image/jpeg');
        expect(await bytesOf(preview)).toEqual(psdPreviewJpeg());
    });

    it('steps over color mode data, named resources and odd-sized resources', async () => {
        const preview = await readPsdPreview(psdFile({
            colorModeData: new Uint8Array(768),
            resources: [
                psdResource(1005, [1, 2, 3]),
                psdResource(1028, [1, 2], { name: 'a' }),
                psdResource(1060, [1], { name: 'ab' }),
                psdResource(1039, [], { name: 'abc' }),
                psdPreviewResource(),
                psdResource(1057, [1, 2, 3, 4]),
            ],
        }));
        expect(await bytesOf(preview)).toEqual(psdPreviewJpeg());
    });

    it('reaches a preview behind large resources without reading them', async () => {
        const file = psdFile({
            resources: [
                psdResource(1060, new Uint8Array(400_000)),
                psdResource(1039, new Uint8Array(600_001)),
                psdPreviewResource(),
            ],
        });
        const bytesRead = trackReads();
        const preview = await readPsdPreview(file);
        expect(bytesRead()).toBeLessThan(200_000);
        expect(await bytesOf(preview)).toEqual(psdPreviewJpeg());
    });

    it('gives up once the read budget is spent', async () => {
        // Each resource is larger than a read window, so each one costs a read.
        const large = count => Array.from({ length: count }, () => psdResource(1060, new Uint8Array(70_000)));
        expect(await readPsdPreview(psdFile({ resources: [...large(8), psdPreviewResource()] }))).toBeInstanceOf(File);

        const file = psdFile({ resources: [...large(24), psdPreviewResource()] });
        const bytesRead = trackReads();
        expect(await readPsdPreview(file)).toBeUndefined();
        expect(bytesRead()).toBe(PSD_PREVIEW_MAX_READ_BYTES);
    });

    it.each([
        ['an empty file', new Uint8Array(0)],
        ['a file that is not a PSD', new TextEncoder().encode('not a Photoshop document, only named like one')],
        ['an unknown document version', createPsd({ version: 3 })],
        ['a corrupt resource block', createPsd({
            resources: [psdResource(1005, [1, 2], { signature: 'XXXX' }), psdPreviewResource()],
        })],
    ])('returns nothing for %s', async (_label, bytes) => {
        expect(await readPsdPreview(new File([bytes], 'art.psd'))).toBeUndefined();
    });

    it('returns nothing for a document cut off anywhere before the end of its preview', async () => {
        const resources = [psdResource(1005, [1, 2, 3], { name: 'a' }), psdPreviewResource()];
        const psd = createPsd({ resources });
        const previewEnd = createPsd({ resources: [] }).length - 9 + resources[0].length + resources[1].length;
        expect(await readPsdPreview(new File([psd.subarray(0, previewEnd)], 'art.psd'))).toBeInstanceOf(File);
        for ( let length = 0; length < previewEnd; length++ ) {
            expect(await readPsdPreview(new File([psd.subarray(0, length)], 'art.psd'))).toBeUndefined();
        }
    });

    it('stops when the upload is cancelled', async () => {
        const controller = new AbortController();
        controller.abort();
        expect(await readPsdPreview(psdFile(), controller.signal)).toBeUndefined();
        expect(await readPsdPreview(withoutPreview(), controller.signal)).toBeUndefined();
    });
});

describe('readPsdPreview without an embedded preview', () => {
    it.each([
        { version: 1, compression: 0 },
        { version: 1, compression: 1 },
        { version: 2, compression: 0 },
        { version: 2, compression: 1 },
    ])('returns the merged image of a document: %j', async (options) => {
        expect(await pixelsOf(await readPsdPreview(withoutPreview({ ...artwork, ...options })))).toEqual(artworkPixels);
    });

    it.each([
        ['has other resources only', [psdResource(1005, [1, 2])]],
        ['has a preview that is not a JPEG', [psdPreviewResource({ format: 0 })]],
        ['has a preview with no image data', [psdPreviewResource({ jpeg: [] })]],
        ['has a preview over the size budget', [
            psdPreviewResource({ jpeg: new Uint8Array(PSD_PREVIEW_MAX_BYTES + 1) }),
        ]],
    ])('returns the merged image when the document %s', async (_label, resources) => {
        expect(await pixelsOf(await readPsdPreview(psdFile({ ...artwork, resources })))).toEqual(artworkPixels);
    });

    it('reads the high byte of 16-bit samples', async () => {
        const preview = await readPsdPreview(withoutPreview({
            width: 2,
            depth: 16,
            channels: [[0x12, 0x34, 0xab, 0xcd], [0, 0xff, 0xff, 0], [0x80, 0, 0x7f, 0xff]],
        }));
        expect(await pixelsOf(preview)).toEqual([[[0x12, 0, 0x80], [0xab, 0xff, 0x7f]]]);
    });

    it('shows a grayscale document in gray', async () => {
        const preview = await readPsdPreview(withoutPreview({ width: 2, colorMode: 1, channels: [[0, 200]] }));
        expect(await pixelsOf(preview)).toEqual([[[0, 0, 0], [200, 200, 200]]]);
    });

    it.each([0, 1])('flattens transparency onto white (compression %i)', async (compression) => {
        const document = {
            width: 3,
            compression,
            channels: [[100, 100, 100], [0, 0, 0], [200, 200, 200], [255, 0, 51]],
        };
        expect(await pixelsOf(await readPsdPreview(withoutPreview({ ...document, layerCount: -1 }))))
            .toEqual([[[100, 0, 200], [255, 255, 255], [224, 204, 244]]]);
        // With a positive layer count the fourth channel is a saved selection, not transparency.
        expect(await pixelsOf(await readPsdPreview(withoutPreview({ ...document, layerCount: 1 }))))
            .toEqual([[[100, 0, 200], [100, 0, 200], [100, 0, 200]]]);
    });

    it('flattens a transparent grayscale document', async () => {
        const preview = await readPsdPreview(withoutPreview({
            version: 2,
            width: 2,
            colorMode: 1,
            channels: [[50, 50], [255, 0]],
            layerCount: -2,
        }));
        expect(await pixelsOf(preview)).toEqual([[[50, 50, 50], [255, 255, 255]]]);
    });

    it.each([0, 1])('scales a large image down, reading only the rows it needs (compression %i)', async (compression) => {
        const width = 3000;
        const height = 1500;
        const plane = value => Uint8Array.from({ length: width * height }, (_, index) => value(index % width, Math.floor(index / width)));
        // Noise in the red channel keeps RLE rows long, so the rows stay far apart in the file.
        const channels = [plane((x, y) => (x * 31 + y * 17) % 251), plane(x => x % 256), plane((_x, y) => y % 256)];
        const file = withoutPreview({ width, height, channels, compression });
        const bytesRead = trackReads();
        const pixels = await pixelsOf(await readPsdPreview(file));
        expect(bytesRead()).toBeLessThan(file.size / 4);
        expect(pixels).toHaveLength(128);
        expect(pixels[0]).toHaveLength(256);
        for ( const [outX, outY] of [[0, 0], [255, 127], [100, 60]] ) {
            const x = Math.floor((outX + 0.5) * width / 256);
            const y = Math.floor((outY + 0.5) * height / 128);
            expect(pixels[outY][outX]).toEqual([(x * 31 + y * 17) % 251, x % 256, y % 256]);
        }
    });

    it('gives up when the rows need more than the read budget', async () => {
        const document = side => {
            const head = createPsd({ resources: [], channels: [[], [], []] });
            new DataView(head.buffer).setUint32(14, side);
            new DataView(head.buffer).setUint32(18, side);
            return sparseFile(head, head.length + side * side * 3);
        };
        expect(await pixelsOf(await readPsdPreview(document(20_000)))).toHaveLength(256);

        const bytesRead = trackReads();
        expect(await readPsdPreview(document(30_000))).toBeUndefined();
        expect(bytesRead()).toBeLessThanOrEqual(PSD_PREVIEW_MAX_READ_BYTES + PSD_COMPOSITE_MAX_READ_BYTES);
    });

    it.each([
        ['a CMYK document', { colorMode: 4, channels: [[0], [0], [0], [0]] }],
        ['an indexed-color document', { colorMode: 2, channels: [[0]] }],
        ['32-bit samples', { depth: 32 }],
        ['an RGB document with too few channels', { channels: [[0], [0]] }],
        ['ZIP compression', { compression: 2 }],
        ['a zero-width document', { width: 0 }],
        ['a document wider than the format allows', { width: 300_001, channels: [[], [], []] }],
    ])('returns nothing for %s', async (_label, options) => {
        expect(await readPsdPreview(withoutPreview(options))).toBeUndefined();
    });

    it.each([
        { version: 1, compression: 0, layerCount: 0 },
        { version: 1, compression: 1, layerCount: -1 },
        { version: 2, compression: 1, layerCount: -1 },
    ])('returns nothing for a document cut off anywhere before the end of its image: %j', async (options) => {
        const psd = createPsd({ ...artwork, channels: [...artwork.channels, red], resources: [], ...options });
        expect(await readPsdPreview(new File([psd], 'art.psd'))).toBeInstanceOf(File);
        // The last channel is only read when the layer count marks it as transparency.
        const needed = options.layerCount ? psd.length : psd.length - red.length;
        for ( let length = 0; length < needed; length++ ) {
            expect(await readPsdPreview(new File([psd.subarray(0, length)], 'art.psd'))).toBeUndefined();
        }
    });

    it('survives RLE rows that are cut short or overrun their width', async () => {
        const psd = createPsd({ ...artwork, resources: [], compression: 1 });
        // Rewrite every packet header as a 128-byte repeat or a 128-byte copy.
        for ( const header of [129, 127] ) {
            const corrupt = psd.slice();
            corrupt.fill(header, psd.length - 20);
            expect((await pixelsOf(await readPsdPreview(new File([corrupt], 'art.psd')))).flat()).toHaveLength(8);
        }
    });
});
