import { describe, expect, it } from 'vitest';
import { pngHeader } from '../../../tests/fixtures/docx.js';
import { psdPreviewJpeg } from '../../../tests/fixtures/psd.js';
import { imageTypeOf, pixelSizeOf } from './images.js';

const viewOf = bytes => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

/** The start of a WebP whose first chunk is `chunk`, holding `data`. */
const webp = (chunk, data) => {
    const bytes = new Uint8Array(20 + data.length);
    const view = viewOf(bytes);
    bytes.set(new TextEncoder().encode(`RIFF....WEBP${chunk}`));
    view.setUint32(4, 12 + data.length, true);
    view.setUint32(16, data.length, true);
    bytes.set(data, 20);
    return bytes;
};
const u16 = value => [value & 0xff, value >> 8 & 0xff];
const u24 = value => [...u16(value), value >> 16 & 0xff];
const u32 = value => [...u16(value), ...u16(value >>> 16)];

describe('pixelSizeOf', () => {
    it.each([
        // A lossy frame: its tag, its start code, then each dimension in 14 bits under 2 bits of scaling.
        ['a lossy WebP', webp('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, ...u16(1234 | 1 << 14), ...u16(567 | 2 << 14), 0, 0])],
        // A lossless one: its signature, then each dimension less one in 14 bits.
        ['a lossless WebP', webp('VP8L', [0x2f, ...u32(1233 | 566 << 14)])],
        // An extended one: flags, then the canvas's dimensions less one in 24 bits.
        ['an extended WebP', webp('VP8X', [0x10, 0, 0, 0, ...u24(1233), ...u24(566)])],
    ])('reads the size %s states', (_label, bytes) => {
        expect(imageTypeOf(viewOf(bytes))).toBe('image/webp');
        expect(pixelSizeOf(viewOf(bytes))).toEqual({ width: 1234, height: 567 });
    });

    it('reads the size of a large extended WebP canvas', () => {
        expect(pixelSizeOf(viewOf(webp('VP8X', [0, 0, 0, 0, ...u24(39_999), ...u24(29_999)])))).toEqual({ width: 40_000, height: 30_000 });
    });

    it.each([
        ['a lossy WebP without its start code', webp('VP8 ', [0, 0, 0, 0, 0, 0, 1, 0, 1, 0])],
        ['a lossless WebP without its signature', webp('VP8L', [0, 1, 0, 0, 0, 0, 0, 0, 0, 0])],
        ['a WebP whose first chunk is metadata', webp('EXIF', new Array(10).fill(0))],
        ['an extended WebP cut off before its size', webp('VP8X', [0, 0, 0, 0, 1]).slice(0, 26)],
        ['a lossless WebP cut off before its size', webp('VP8L', [0x2f, 1, 2])],
        ['a lossy WebP cut off before its size', webp('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, 1])],
    ])('reads nothing from %s', (_label, bytes) => {
        expect(pixelSizeOf(viewOf(bytes))).toBeUndefined();
    });

    it('reads the size of PNG and JPEG pictures', () => {
        expect(pixelSizeOf(viewOf(pngHeader(256, 192)))).toEqual({ width: 256, height: 192 });
        expect(pixelSizeOf(viewOf(psdPreviewJpeg()))).toEqual({ width: 160, height: 80 });
    });
});
