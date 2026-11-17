import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPsd, psdPreviewJpeg, psdPreviewResource, psdResource } from '../../../tests/fixtures/psd.js';
import { PSD_PREVIEW_MAX_BYTES, PSD_PREVIEW_MAX_READ_BYTES } from './config.js';
import { readPsdPreview } from './psd.js';

const psdFile = options => new File([createPsd(options)], 'art.psd');
const bytesOf = async blob => blob && new Uint8Array(await blob.arrayBuffer());
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
        ['a document with no resources', createPsd({ resources: [] })],
        ['a document saved without a preview', createPsd({ resources: [psdResource(1005, [1, 2])] })],
        ['a preview that is not a JPEG', createPsd({ resources: [psdPreviewResource({ format: 0 })] })],
        ['a preview with no image data', createPsd({ resources: [psdPreviewResource({ jpeg: [] })] })],
        ['a preview over the size budget', createPsd({
            resources: [psdPreviewResource({ jpeg: new Uint8Array(PSD_PREVIEW_MAX_BYTES + 1) })],
        })],
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
    });
});
