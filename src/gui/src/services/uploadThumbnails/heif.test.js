import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRecordingCanvas } from '../../../tests/fixtures/canvas.js';
import {
    HEVC_CONFIGURATION,
    HEVC_PICTURE,
    box,
    createHeif,
    createHeifGrid,
    gridLayout,
    property,
} from '../../../tests/fixtures/heif.js';
import { HEIF_DECODE_TIMEOUT_MS, HEIF_MAX_PIXELS, HEIF_MAX_TILES, HEIF_META_MAX_BYTES } from './config.js';
import { readHeifPreview } from './heif.js';

const heifFile = bytes => new File([bytes], 'photo.heic');
const picture = (id, properties = [1, 2], data = HEVC_PICTURE) => ({ id, type: 'hvc1', data, properties });
let drawn;
let decoders;
// What the device's decoder does with the pictures it is given.
let behavior;

beforeEach(() => {
    const canvas = createRecordingCanvas();
    drawn = canvas.drawn;
    decoders = [];
    behavior = { supported: true, outcome: 'decode' };
    vi.stubGlobal('OffscreenCanvas', canvas.Canvas);
    // The browser's video decoder, as far as the reader uses it. No test here decodes HEVC.
    vi.stubGlobal('VideoDecoder', class {
        static isConfigSupported = vi.fn(async () => ({ supported: behavior.supported }));
        state = 'unconfigured';
        chunks = [];
        constructor (init) {
            this.init = init;
            decoders.push(this);
        }

        configure (config) {
            this.config = config;
            this.state = 'configured';
        }

        decode (chunk) {
            this.chunks.push(chunk);
        }

        async flush () {
            if ( behavior.outcome === 'hang' ) return new Promise(() => {});
            if ( behavior.outcome === 'error' ) return this.init.error(new Error('decode failed'));
            if ( behavior.outcome === 'reject' ) throw new Error('flush failed');
            this.frames = this.chunks.slice(0, behavior.outcome === 'short' ? -1 : undefined).map((chunk) => {
                const frame = { timestamp: chunk.timestamp, close: vi.fn() };
                this.init.output(frame);
                return frame;
            });
        }

        close () {
            this.state = 'closed';
        }
    });
    vi.stubGlobal('EncodedVideoChunk', class {
        constructor (init) {
            Object.assign(this, init);
        }
    });
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('readHeifPreview', () => {
    it.each([false, true])('gives the device\'s decoder the photo\'s picture and its configuration (wide numbers: %s)', async (wide) => {
        const preview = await readHeifPreview(heifFile(createHeif({ wide })));
        expect(preview).toBeInstanceOf(File);
        expect(preview.type).toBe('image/jpeg');
        const [decoder] = decoders;
        // Main Still Picture profile, compatible with the two profiles after it, level 3.
        expect(decoder.config).toMatchObject({ codec: 'hvc1.3.E.L30.B0', codedWidth: 128, codedHeight: 64 });
        expect(decoder.config.description).toEqual(HEVC_CONFIGURATION);
        expect(decoder.chunks).toHaveLength(1);
        expect(decoder.chunks[0]).toMatchObject({ type: 'key', timestamp: 0 });
        expect(decoder.chunks[0].data).toEqual(HEVC_PICTURE);
        // A picture smaller than the limit is not enlarged.
        expect(drawn).toMatchObject({ width: 128, height: 64 });
        expect(drawn.images).toEqual([{ image: decoder.frames[0], x: 0, y: 0, width: 128, height: 64 }]);
        expect(decoder.frames[0].close).toHaveBeenCalledOnce();
        expect(decoder.state).toBe('closed');
    });

    it('writes the codec of other profiles, tiers and constraints as a decoder expects it', async () => {
        const codecOf = async (change) => {
            const configuration = HEVC_CONFIGURATION.slice();
            change(new DataView(configuration.buffer));
            decoders.length = 0;
            await readHeifPreview(heifFile(createHeif({ properties: [property.configuration(configuration), property.size(128, 64)] })));
            return decoders[0].config.codec;
        };
        // Main profile, compatible with itself and Main 10, at level 4.1 with no constraints stated.
        expect(await codecOf((view) => {
            view.setUint8(1, 1);
            view.setUint32(2, 0x60000000);
            view.setUint8(6, 0);
            view.setUint8(12, 123);
        })).toBe('hvc1.1.6.L123');
        // The high tier of Main 10 in profile space A, with constraints in its first and third bytes.
        expect(await codecOf((view) => {
            view.setUint8(1, 0x40 | 0x20 | 2);
            view.setUint32(2, 0x20000000);
            view.setUint8(6, 0x90);
            view.setUint8(8, 0x0c);
        })).toBe('hvc1.A2.4.H30.90.0.C');
    });

    it('prefers the small copy of the photo the file stores, and never reads the photo itself', async () => {
        const photo = new Uint8Array(3_000_000).fill(9);
        const file = heifFile(createHeif({
            items: [picture(1, [1, 3], photo), picture(2), { id: 3, type: 'Exif', data: new Uint8Array(40), properties: [] }],
            properties: [property.configuration(), property.size(128, 64), property.size(4032, 3024)],
            references: [{ type: 'cdsc', from: 3, to: [1] }, { type: 'thmb', from: 2, to: [1] }],
        }));
        const read = vi.spyOn(Blob.prototype, 'arrayBuffer');
        expect(await readHeifPreview(file)).toBeInstanceOf(File);
        expect(decoders[0].chunks.map(chunk => chunk.data)).toEqual([HEVC_PICTURE]);
        expect(read.mock.contexts.reduce((total, blob) => total + blob.size, 0)).toBeLessThan(200_000);
    });

    it('draws a photo stored as a grid of tiles, each where it goes, cut off at the photo\'s size', async () => {
        // Six tiles of 128 x 64 in three columns, for a photo of 350 x 100: scaled by 256 / 350.
        expect(await readHeifPreview(heifFile(createHeifGrid({ rows: 2, columns: 3, width: 350, height: 100 })))).toBeInstanceOf(File);
        const scale = 256 / 350;
        expect(drawn).toMatchObject({ width: 256, height: Math.round(100 * scale) });
        expect(decoders[0].chunks.map(chunk => chunk.timestamp)).toEqual([0, 1, 2, 3, 4, 5]);
        expect(drawn.images.map(({ x, y, width, height }) => [x, y, width, height].map(value => Math.round(value * 100) / 100))).toEqual(
            [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1]].map(([column, row]) =>
                [column * 128 * scale, row * 64 * scale, 128 * scale, 64 * scale].map(value => Math.round(value * 100) / 100)),
        );
    });

    it('places each tile by the position the decoder gives back, whatever order they come out in', async () => {
        behavior.outcome = 'decode';
        const flush = VideoDecoder.prototype.flush;
        VideoDecoder.prototype.flush = async function () {
            this.chunks.reverse();
            return flush.call(this);
        };
        await readHeifPreview(heifFile(createHeifGrid({ rows: 1, columns: 2 })));
        expect(drawn.images.map(image => image.x)).toEqual([128, 0]);
    });

    it.each([
        ['a quarter turn', [property.turn(1)], true, [['rotate', -Math.PI / 2]]],
        ['a half turn', [property.turn(2)], false, [['rotate', -Math.PI]]],
        ['a mirror image, left to right', [property.mirror(0)], false, [['scale', -1, 1]]],
        ['a mirror image, top to bottom', [property.mirror(1)], false, [['scale', 1, -1]]],
        // The turn is listed first, so it is applied to the photo first, which on a canvas means it is set last.
        ['a turn and then a mirror image', [property.turn(3), property.mirror(0)], true, [['scale', -1, 1], ['rotate', -3 * Math.PI / 2]]],
    ])('shows a photo with %s as its properties say', async (_label, changes, sideways, transforms) => {
        await readHeifPreview(heifFile(createHeif({
            properties: [property.configuration(), property.size(128, 64), ...changes],
            items: [picture(1, [1, 2, ...changes.map((_, index) => index + 3)])],
        })));
        expect(drawn).toMatchObject(sideways ? { width: 64, height: 128 } : { width: 128, height: 64 });
        expect(drawn.transforms.filter(([kind]) => kind !== 'translate')).toEqual(transforms);
        // The picture itself is always drawn the way it is stored.
        expect(drawn.images[0]).toMatchObject({ x: 0, y: 0, width: 128, height: 64 });
    });

    it('reads a picture stored in several stretches, and item locations without a storage method', async () => {
        await readHeifPreview(heifFile(createHeif({ items: [{ ...picture(1), extents: 3 }], locationVersion: 0, before: box('free', new Uint8Array(100)) })));
        expect(decoders[0].chunks[0].data).toEqual(HEVC_PICTURE);
    });

    it('asks whether the device can decode the photo before reading any of it', async () => {
        behavior.supported = false;
        const photo = new Uint8Array(3_000_000).fill(9);
        const file = heifFile(createHeif({ items: [picture(1, [1, 2], photo)] }));
        const read = vi.spyOn(Blob.prototype, 'arrayBuffer');
        expect(await readHeifPreview(file)).toBeUndefined();
        expect(VideoDecoder.isConfigSupported).toHaveBeenCalledWith(expect.objectContaining({ codec: 'hvc1.3.E.L30.B0' }));
        expect(decoders).toHaveLength(0);
        expect(read.mock.contexts.reduce((total, blob) => total + blob.size, 0)).toBeLessThan(200_000);
    });

    it('returns nothing in a browser with no video decoder, without reading the file', async () => {
        vi.stubGlobal('VideoDecoder', undefined);
        const read = vi.spyOn(Blob.prototype, 'arrayBuffer');
        expect(await readHeifPreview(heifFile(createHeif()))).toBeUndefined();
        expect(read).not.toHaveBeenCalled();
    });

    it.each(['error', 'reject', 'short'])('returns nothing when the decoder ends in %s, and closes it', async (outcome) => {
        behavior.outcome = outcome;
        expect(await readHeifPreview(heifFile(createHeifGrid()))).toBeUndefined();
        expect(decoders[0].state).toBe('closed');
    });

    it('gives up on a decoder that does not answer, or when the upload is cancelled', async () => {
        vi.useFakeTimers();
        behavior.outcome = 'hang';
        const stuck = readHeifPreview(heifFile(createHeif()));
        await vi.advanceTimersByTimeAsync(HEIF_DECODE_TIMEOUT_MS);
        expect(await stuck).toBeUndefined();
        expect(decoders[0].state).toBe('closed');
        const controller = new AbortController();
        const cancelled = readHeifPreview(heifFile(createHeif()), controller.signal);
        await vi.advanceTimersByTimeAsync(10);
        controller.abort();
        expect(await cancelled).toBeUndefined();
        expect(decoders[1].state).toBe('closed');
        expect(vi.getTimerCount()).toBe(0);
        controller.abort();
        expect(await readHeifPreview(heifFile(createHeif()), controller.signal)).toBeUndefined();
    });
});

describe('readHeifPreview with files it does not show', () => {
    it.each([
        ['an empty file', new Uint8Array(0)],
        ['a file that is not a HEIF file', new TextEncoder().encode('not a photo, only named like one')],
        ['a file with no index', box('ftyp', new Uint8Array(12))],
        ['a photo in a codec other than HEVC', createHeif({ items: [{ id: 1, type: 'av01', data: HEVC_PICTURE, properties: [1, 2] }] })],
        ['a photo with no configuration for its decoder', createHeif({ items: [picture(1, [2])] })],
        ['a photo that states no size', createHeif({ items: [picture(1, [1])] })],
        ['a photo whose primary item is missing', createHeif({ primary: 9 })],
        ['a photo of more pixels than the limit', createHeif({ properties: [property.configuration(), property.size(HEIF_MAX_PIXELS / 1024 + 1, 1024)] })],
        ['a picture whose data is past the end of the file', (() => {
            const heif = createHeif();
            // The picture's offset is the eight bytes before the end of the index.
            const view = new DataView(heif.buffer);
            view.setUint32(heif.length - HEVC_PICTURE.length - 8 - 8, heif.length);
            return heif;
        })()],
        ['a grid that states a photo of more pixels than the limit', createHeifGrid({ width: 8192, height: 4096 })],
        ['a grid with more tiles than the limit', createHeifGrid({ rows: 1, columns: HEIF_MAX_TILES + 1 })],
        ['a grid with fewer tiles than its layout needs', (() => {
            const tiles = [picture(1), picture(2), picture(3)];
            return createHeif({
                items: [...tiles, { id: 4, type: 'grid', data: gridLayout(2, 2, 256, 128), properties: [3], inIndex: true }],
                properties: [property.configuration(), property.size(128, 64), property.size(256, 128)],
                primary: 4,
                references: [{ type: 'dimg', from: 4, to: [1, 2, 3] }],
            });
        })()],
        ['a grid one of whose tiles is missing', createHeifGrid({ references: [{ type: 'dimg', from: 5, to: [1, 2, 3, 8] }] })],
        ['an index larger than the limit', createHeif({ properties: [property.configuration(), property.size(128, 64), box('free', new Uint8Array(HEIF_META_MAX_BYTES))] })],
    ])('returns nothing for %s', async (_label, bytes) => {
        expect(await readHeifPreview(heifFile(bytes))).toBeUndefined();
        expect(decoders).toHaveLength(0);
    });

    it('returns nothing for a file cut off anywhere before the end of its picture', async () => {
        const heif = createHeifGrid();
        expect(await readHeifPreview(heifFile(heif))).toBeInstanceOf(File);
        for ( let length = 0; length < heif.length; length += 3 ) {
            expect(await readHeifPreview(heifFile(heif.subarray(0, length)))).toBeUndefined();
        }
    });

    it('returns nothing, and does not throw, for an index with any one byte changed to point elsewhere', async () => {
        const heif = createHeifGrid();
        const indexEnd = heif.length - 4 * HEVC_PICTURE.length - 8;
        for ( let at = 28; at < indexEnd; at++ ) {
            const changed = heif.slice();
            changed[at] = 0xff;
            const preview = await readHeifPreview(heifFile(changed));
            expect(preview === undefined || preview instanceof File).toBe(true);
        }
    });
});
