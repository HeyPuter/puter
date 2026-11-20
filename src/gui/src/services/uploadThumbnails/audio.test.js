import { afterEach, describe, expect, it, vi } from 'vitest';
import { box, createFlac, createM4a, createMp3, flacPicture, id3Picture } from '../../../tests/fixtures/audio.js';
import { pngHeader } from '../../../tests/fixtures/docx.js';
import { psdPreviewJpeg } from '../../../tests/fixtures/psd.js';
import { AUDIO_COVER_MAX_BYTES, AUDIO_MAX_READ_BYTES } from './config.js';
import { readAudioCover } from './audio.js';

const jpeg = psdPreviewJpeg();
const png = pngHeader(300, 300);
const bytesOf = async blob => new Uint8Array(await blob.arrayBuffer());
const cover = bytes => new File([bytes], 'song');
/** Read a file's cover and check it is the image expected. */
const expectCover = async (bytes, image, type) => {
    const found = await readAudioCover(cover(bytes));
    expect(found).toBeInstanceOf(File);
    expect(found.type).toBe(type);
    expect(await bytesOf(found)).toEqual(image);
};
// Every read the parser makes goes through a slice's arrayBuffer().
const trackReads = () => {
    const read = vi.spyOn(Blob.prototype, 'arrayBuffer');
    return () => read.mock.contexts.reduce((total, blob) => total + blob.size, 0);
};

afterEach(() => vi.restoreAllMocks());

describe('readAudioCover for an MP3', () => {
    it.each([2, 3, 4])('returns the picture in an ID3v2.%i tag', async (version) => {
        const name = version === 2 ? 'PIC' : 'APIC';
        await expectCover(createMp3({ version, frames: [{ name, data: id3Picture({ data: jpeg }, version) }] }), jpeg, 'image/jpeg');
        await expectCover(createMp3({ version, frames: [{ name, data: id3Picture({ data: png, mime: 'image/png' }, version) }] }), png, 'image/png');
    });

    it('steps over the frames before the picture, an extended header and a description in either encoding', async () => {
        const text = name => ({ name, data: new Uint8Array([0, 84, 105, 116, 108, 101]) });
        for ( const version of [3, 4] ) {
            await expectCover(createMp3({
                version,
                extended: true,
                frames: [
                    text('TIT2'), text('TPE1'), { name: 'GEOB', data: new Uint8Array(70_000) },
                    { name: 'APIC', data: id3Picture({ data: jpeg, description: 'Front cover', encoding: 1 }, version) },
                ],
                padding: 512,
            }), jpeg, 'image/jpeg');
        }
        await expectCover(createMp3({ frames: [{ name: 'APIC', data: id3Picture({ data: jpeg, description: 'Front' }) }] }), jpeg, 'image/jpeg');
    });

    it('prefers the front cover to the pictures around it, and takes the first picture when none is marked', async () => {
        const picture = (data, kind) => ({ name: 'APIC', data: id3Picture({ data, kind }) });
        const other = new Uint8Array([...jpeg, 1]);
        await expectCover(createMp3({ frames: [picture(other, 4), picture(jpeg, 3), picture(other, 0)] }), jpeg, 'image/jpeg');
        await expectCover(createMp3({ frames: [picture(jpeg, 0), picture(other, 4)] }), jpeg, 'image/jpeg');
    });

    it('goes by what the image is, not by the type its frame states', async () => {
        await expectCover(createMp3({ frames: [{ name: 'APIC', data: id3Picture({ data: png, mime: 'image/jpeg' }) }] }), png, 'image/png');
        // A frame can hold a link to a picture in place of one.
        const link = id3Picture({ data: new TextEncoder().encode('https://example.com/cover.jpg'), mime: '-->' });
        expect(await readAudioCover(cover(createMp3({ frames: [{ name: 'APIC', data: link }] })))).toBeUndefined();
    });

    it('finds the cover behind large frames without reading them, or the cover itself', async () => {
        const large = new Uint8Array(3_000_000).fill(7);
        large.set(jpeg);
        const file = cover(createMp3({ frames: [{ name: 'GEOB', data: new Uint8Array(2_000_000) }, { name: 'APIC', data: id3Picture({ data: large }) }] }));
        const bytesRead = trackReads();
        const found = await readAudioCover(file);
        expect(bytesRead()).toBeLessThan(200_000);
        expect(found.size).toBe(large.length);
    });

    it.each([
        ['a picture that is compressed or altered', createMp3({ version: 4, frames: [{ name: 'APIC', data: id3Picture({ data: jpeg }, 4), flags: 0x02 }] })],
        ['a tag whose bytes are altered throughout', createMp3({ tagFlags: 0x80, frames: [{ name: 'APIC', data: id3Picture({ data: jpeg }) }] })],
        ['a tag with no picture', createMp3({ frames: [{ name: 'TIT2', data: new Uint8Array([0, 65]) }] })],
        ['a tag of a version not known', createMp3({ version: 5, frames: [{ name: 'APIC', data: id3Picture({ data: jpeg }, 4) }] })],
        ['a picture over the size limit', createMp3({ frames: [{ name: 'APIC', data: id3Picture({ data: new Uint8Array(AUDIO_COVER_MAX_BYTES + 1) }) }] })],
        ['a picture whose description never ends', createMp3({ frames: [{ name: 'APIC', data: concat([0], [...'image/jpeg'].map(c => c.charCodeAt(0)), [0, 3], new Uint8Array(4000).fill(65)) }] })],
        ['an MP3 with no tag at its start', new Uint8Array([0xff, 0xfb, 0x90, 0x00, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])],
        ['an empty file', new Uint8Array(0)],
    ])('returns nothing for %s', async (_label, bytes) => {
        expect(await readAudioCover(cover(bytes))).toBeUndefined();
    });

    it('returns nothing for a tag cut off before the end of its picture', async () => {
        const mp3 = createMp3({ frames: [{ name: 'TIT2', data: new Uint8Array([0, 65]) }, { name: 'APIC', data: id3Picture({ data: jpeg }) }] });
        const pictureEnd = mp3.length - 16;
        expect(await readAudioCover(cover(mp3.subarray(0, pictureEnd)))).toBeInstanceOf(File);
        for ( let length = 0; length < pictureEnd; length += 3 ) {
            expect(await readAudioCover(cover(mp3.subarray(0, length)))).toBeUndefined();
        }
    });

    it('gives up once the read budget is spent', async () => {
        // Each frame is larger than a read window, so each one costs a read.
        const many = count => Array.from({ length: count }, () => ({ name: 'GEOB', data: new Uint8Array(70_000) }));
        const picture = { name: 'APIC', data: id3Picture({ data: jpeg }) };
        expect(await readAudioCover(cover(createMp3({ frames: [...many(8), picture] })))).toBeInstanceOf(File);
        const bytesRead = trackReads();
        expect(await readAudioCover(cover(createMp3({ frames: [...many(40), picture] })))).toBeUndefined();
        expect(bytesRead()).toBeLessThanOrEqual(AUDIO_MAX_READ_BYTES);
    });
});

describe('readAudioCover for a FLAC', () => {
    const pictureBlock = options => ({ type: 6, data: flacPicture(options) });

    it('returns the picture among the blocks before the audio', async () => {
        await expectCover(createFlac({
            blocks: [{ type: 4, data: new Uint8Array(300) }, { type: 3, data: new Uint8Array(90_000) }, pictureBlock({ data: jpeg, description: 'Cover (front)' }), { type: 1, data: new Uint8Array(4096) }],
        }), jpeg, 'image/jpeg');
        await expectCover(createFlac({ blocks: [pictureBlock({ data: png, mime: 'image/png' })] }), png, 'image/png');
    });

    it('prefers the front cover', async () => {
        const other = new Uint8Array([...jpeg, 1]);
        await expectCover(createFlac({ blocks: [pictureBlock({ data: other, kind: 4 }), pictureBlock({ data: jpeg }), pictureBlock({ data: other, kind: 6 })] }), jpeg, 'image/jpeg');
    });

    it('finds the blocks behind an ID3 tag put in front of the file', async () => {
        const tag = createMp3({ frames: [{ name: 'TIT2', data: new Uint8Array([0, 65]) }] }).subarray(0, -16);
        await expectCover(createFlac({ prefix: tag, blocks: [pictureBlock({ data: jpeg })] }), jpeg, 'image/jpeg');
    });

    it.each([
        ['a file with no picture block', createFlac({ blocks: [{ type: 4, data: new Uint8Array(100) }] })],
        ['a picture that runs past its block', (() => {
            const flac = createFlac({ blocks: [pictureBlock({ data: jpeg })] });
            // The image's length is the four bytes before it.
            new DataView(flac.buffer).setUint32(flac.length - 4 - jpeg.length - 4, jpeg.length + 100);
            return flac;
        })()],
    ])('returns nothing for %s', async (_label, bytes) => {
        expect(await readAudioCover(cover(bytes))).toBeUndefined();
    });

    it('returns nothing for a file cut off before the end of its picture', async () => {
        const flac = createFlac({ blocks: [pictureBlock({ data: jpeg })] });
        for ( let length = 0; length < flac.length - 4; length += 3 ) {
            expect(await readAudioCover(cover(flac.subarray(0, length)))).toBeUndefined();
        }
    });
});

describe('readAudioCover for an MP4 audio file', () => {
    it.each([
        ['after the audio', {}],
        ['before the audio', { tagsFirst: true }],
        ['after audio whose size is stated in 64 bits', { large: true }],
    ])('returns the cover kept with the tags %s', async (_label, options) => {
        await expectCover(createM4a({ cover: jpeg, ...options }), jpeg, 'image/jpeg');
        await expectCover(createM4a({ cover: png, kind: 14, ...options }), png, 'image/png');
    });

    it('reaches the tags behind the audio without reading it', async () => {
        const file = cover(createM4a({ cover: jpeg, audioBytes: 5_000_000 }));
        const bytesRead = trackReads();
        expect(await readAudioCover(file)).toBeInstanceOf(File);
        expect(bytesRead()).toBeLessThan(200_000);
    });

    it.each([
        ['a file with tags and no cover', createM4a({})],
        ['a cover that is not an image', createM4a({ cover: new TextEncoder().encode('not an image at all') })],
        ['a file with no tags', concat(box('ftyp', new Uint8Array(12)), box('mdat', new Uint8Array(64)), box('moov', box('mvhd', new Uint8Array(100))))],
        ['a box that claims to be larger than the file', (() => {
            const m4a = createM4a({ cover: jpeg, tagsFirst: true });
            new DataView(m4a.buffer).setUint32(36, m4a.length * 2);
            return m4a;
        })()],
        ['a cover that runs past the box that holds it', (() => {
            const m4a = createM4a({ cover: jpeg, tagsFirst: true });
            // The cover's `data` box follows the eight bytes of the `covr` box around it.
            const covr = m4a.findIndex((_, at) => [99, 111, 118, 114].every((code, index) => m4a[at + index] === code));
            const view = new DataView(m4a.buffer);
            view.setUint32(covr + 4, view.getUint32(covr + 4) + 32);
            return m4a;
        })()],
        ['boxes of no size, which would never end', concat(box('ftyp', new Uint8Array(12)), new Uint8Array(4000))],
    ])('returns nothing for %s', async (_label, bytes) => {
        expect(await readAudioCover(cover(bytes))).toBeUndefined();
    });

    it('returns nothing for a file cut off before the end of its cover', async () => {
        const m4a = createM4a({ cover: jpeg });
        for ( let length = 0; length < m4a.length; length += 5 ) {
            expect(await readAudioCover(cover(m4a.subarray(0, length)))).toBeUndefined();
        }
    });
});

describe('readAudioCover', () => {
    it('returns nothing for a file that is none of the three', async () => {
        expect(await readAudioCover(cover(new TextEncoder().encode('RIFF....WAVEfmt and nothing like a tag')))).toBeUndefined();
    });

    it('stops when the upload is cancelled', async () => {
        const controller = new AbortController();
        controller.abort();
        const picture = { name: 'APIC', data: id3Picture({ data: jpeg }) };
        expect(await readAudioCover(cover(createMp3({ frames: [picture] })), controller.signal)).toBeUndefined();
        expect(await readAudioCover(cover(createFlac({ blocks: [{ type: 6, data: flacPicture({ data: jpeg }) }] })), controller.signal)).toBeUndefined();
        expect(await readAudioCover(cover(createM4a({ cover: jpeg })), controller.signal)).toBeUndefined();
    });
});

function concat (...parts) {
    return Uint8Array.from(parts.flatMap(part => [...part]));
}
