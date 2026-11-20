// Audio files with cover art in their tags, generated without a tagging library. The audio itself is a few bytes
// that stand in for it: nothing here is played.
const ascii = text => Uint8Array.from(text, character => character.charCodeAt(0));
const concat = (...parts) => {
    const bytes = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
    let offset = 0;
    for ( const part of parts ) {
        bytes.set(part, offset);
        offset += part.length;
    }
    return bytes;
};
const u32 = value => [value >>> 24 & 255, value >>> 16 & 255, value >>> 8 & 255, value & 255];
const u24 = value => u32(value).slice(1);
// A size stored seven bits to a byte.
const syncsafe = value => [value >>> 21 & 127, value >>> 14 & 127, value >>> 7 & 127, value & 127];
const STAND_IN_AUDIO = new Uint8Array([0xff, 0xfb, 0x90, 0x00, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

/**
 * The content of an ID3 picture frame. `encoding` 1 stores the description as UTF-16 with a byte order mark.
 * Version 2.2 names the image's format in three letters where later versions give a MIME type.
 */
export const id3Picture = ({ data, kind = 3, mime = 'image/jpeg', description = '', encoding = 0 }, version = 3) => concat(
    [encoding],
    version === 2 ? ascii(mime.endsWith('png') ? 'PNG' : 'JPG') : [...ascii(mime), 0],
    [kind],
    encoding === 1
        ? [0xff, 0xfe, ...[...description].flatMap(character => [character.charCodeAt(0) & 255, character.charCodeAt(0) >> 8]), 0, 0]
        : [...ascii(description), 0],
    data,
);

/**
 * An MP3 that starts with an ID3v2 tag of the given `version` (2, 3 or 4). `frames` are `{ name, data, flags }` in
 * order; a picture frame is named `APIC` (`PIC` in version 2) and holds `id3Picture()` content. `extended` adds an
 * extended header, `tagFlags` are added to the tag's, and `padding` is zero bytes after the frames.
 */
export const createMp3 = ({ version = 3, frames = [], extended = false, tagFlags = 0, padding = 0 } = {}) => {
    const body = concat(
        // An extended header: its size, then flags and the size of the padding.
        ...(extended ? [version === 4 ? [...syncsafe(6), 1, 0] : [...u32(6), 0, 0, ...u32(padding)]] : []),
        ...frames.map(({ name, data, flags = 0 }) => (version === 2
            ? concat(ascii(name), u24(data.length), data)
            : concat(ascii(name), version === 4 ? syncsafe(data.length) : u32(data.length), [0, flags], data))),
        new Uint8Array(padding),
    );
    return concat(ascii('ID3'), [version, 0, tagFlags | (extended ? 0x40 : 0)], syncsafe(body.length), body, STAND_IN_AUDIO);
};

/** A FLAC picture block's content. */
export const flacPicture = ({ data, kind = 3, mime = 'image/jpeg', description = '' }) => concat(
    u32(kind), u32(mime.length), ascii(mime), u32(description.length), ascii(description),
    u32(160), u32(80), u32(24), u32(0), u32(data.length), data,
);

/**
 * A FLAC file: the stream's description, then `blocks` of `{ type, data }` in order (a picture is type 6, with
 * `flacPicture()` content), then stand-in audio. `prefix` goes in front of the file, as an ID3 tag sometimes does.
 */
export const createFlac = ({ blocks = [], prefix = new Uint8Array(0) } = {}) => {
    // 44.1 kHz, two channels, 16 bits, no samples counted and no checksum.
    const streamInfo = new Uint8Array(34);
    streamInfo.set([0x10, 0x00, 0x10, 0x00, 0, 0, 0, 0, 0, 0, 0x0a, 0xc4, 0x42, 0xf0]);
    const all = [{ type: 0, data: streamInfo }, ...blocks];
    return concat(prefix, ascii('fLaC'), ...all.map(({ type, data }, index) =>
        concat([type | (index === all.length - 1 ? 0x80 : 0)], u24(data.length), data)), [0xff, 0xf8, 0xc9, 0x18]);
};

/** An MP4 box. A `large` one states its size in 64 bits. */
export const box = (type, content, { large = false } = {}) => (large
    ? concat(u32(1), ascii(type), u32(0), u32(content.length + 16), content)
    : concat(u32(content.length + 8), ascii(type), content));

/**
 * An MP4 audio file. `cover` is the image kept at `moov` / `udta` / `meta` / `ilst` / `covr`, with `kind` 13 for a
 * JPEG and 14 for a PNG. `audioBytes` is the size of the audio box, which comes before the tags unless
 * `tagsFirst`, and `large` gives it a 64-bit size.
 */
export const createM4a = ({ cover, kind = 13, audioBytes = 64, tagsFirst = false, large = false, tags } = {}) => {
    const items = concat(
        box('©nam', box('data', concat(u32(1), u32(0), ascii('Song')))),
        ...(cover ? [box('covr', box('data', concat(u32(kind), u32(0), cover)))] : []),
    );
    const meta = box('meta', concat(u32(0), box('hdlr', concat(u32(0), u32(0), ascii('mdirappl'), new Uint8Array(9))), box('ilst', tags ?? items)));
    const movie = box('moov', concat(box('mvhd', new Uint8Array(100)), box('trak', box('tkhd', new Uint8Array(84))), box('udta', meta)));
    const audio = box('mdat', new Uint8Array(audioBytes), { large });
    return concat(box('ftyp', concat(ascii('M4A '), u32(0), ascii('M4A mp42isom'))), ...(tagsFirst ? [movie, audio] : [audio, movie]));
};
