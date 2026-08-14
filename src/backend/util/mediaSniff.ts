/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

// Content-based identification of user-supplied media, plus the strict base64
// decoder that gets us from a wire payload to bytes worth sniffing. A MIME type
// or a file extension supplied by a caller describes nothing — only the bytes
// do — so every write path that accepts uploaded media resolves the type here.

const BASE64_CHARS_REGEX = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * Cap on how far into a payload we look for the `<svg` root element. SVG is the
 * one recognized type without a fixed-offset magic number; a file that buries
 * its root past this much leading comment/PI text is not something we need to
 * accept.
 */
const SVG_SNIFF_WINDOW = 8 * 1024;

/**
 * How far into an EBML stream we look for the DocType string. The DocType
 * element lives in the EBML header, which precedes the first cluster and in
 * practice sits within the first few dozen bytes.
 */
const EBML_SNIFF_WINDOW = 64;

/**
 * ISO Base Media brands we treat as MP4 video. The same `ftyp` box fronts HEIF
 * images (`heic`, `mif1`), audio (`M4A `) and JPEG 2000, so the brand — not the
 * box — is what decides, and anything unlisted is left unidentified.
 */
const MP4_BRANDS = new Set([
    'avc1',
    'dash',
    'iso2',
    'iso4',
    'iso5',
    'iso6',
    'isom',
    'mmp4',
    'mp41',
    'mp42',
    'mp71',
    'M4V ',
    'M4VH',
    'M4VP',
    'M4P ',
]);

/**
 * Decode strict base64 — no whitespace, correct padding, and byte-for-byte
 * round-trip. `Buffer.from(s, 'base64')` silently skips characters it doesn't
 * recognise, so `iVBORw0KGgo=" onerror=alert(1)` decodes without complaint; the
 * round-trip is what rejects it.
 */
export function decodeStrictBase64(value: string): Buffer | null {
    if (!BASE64_CHARS_REGEX.test(value)) return null;
    if (value.length === 0 || value.length % 4 !== 0) return null;
    try {
        const decoded = Buffer.from(value, 'base64');
        if (decoded.length === 0) return null;
        const stripped = value.replace(/=+$/, '');
        const reencoded = decoded.toString('base64').replace(/=+$/, '');
        return stripped === reencoded ? decoded : null;
    } catch {
        return null;
    }
}

function looksLikeSvg(bytes: Buffer): boolean {
    let head = bytes.subarray(0, SVG_SNIFF_WINDOW).toString('utf8');
    if (head.charCodeAt(0) === 0xfeff) head = head.slice(1);
    // Must open as markup (rules out arbitrary text that merely mentions
    // `<svg` somewhere), and must actually contain an `<svg` root.
    if (!head.trimStart().startsWith('<')) return false;
    return /<svg[\s/>]/i.test(head);
}

/**
 * Identify image bytes by content, returning a canonical MIME type or null.
 * Signature-based: a MIME type that came in alongside the payload is caller
 * input and cannot be trusted to describe it.
 *
 * Recognizing a type is not the same as accepting it — `image/svg+xml` is
 * script-capable, so callers allow-list what they want rather than taking
 * whatever comes back.
 */
export function sniffImageMime(bytes: Buffer): string | null {
    if (
        bytes.length >= 8 &&
        bytes[0] === 0x89 &&
        bytes[1] === 0x50 &&
        bytes[2] === 0x4e &&
        bytes[3] === 0x47 &&
        bytes[4] === 0x0d &&
        bytes[5] === 0x0a &&
        bytes[6] === 0x1a &&
        bytes[7] === 0x0a
    ) {
        return 'image/png';
    }
    if (
        bytes.length >= 3 &&
        bytes[0] === 0xff &&
        bytes[1] === 0xd8 &&
        bytes[2] === 0xff
    ) {
        return 'image/jpeg';
    }
    if (bytes.length >= 6) {
        const head = bytes.subarray(0, 6).toString('latin1');
        if (head === 'GIF87a' || head === 'GIF89a') return 'image/gif';
    }
    if (
        bytes.length >= 12 &&
        bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
        bytes.subarray(8, 12).toString('latin1') === 'WEBP'
    ) {
        return 'image/webp';
    }
    if (looksLikeSvg(bytes)) return 'image/svg+xml';
    return null;
}

/**
 * Identify video bytes by content, returning a canonical MIME type or null.
 * Covers what the platforms people report bugs from actually record: MP4
 * (Windows, Android), QuickTime (macOS/iOS screen recording) and WebM (Chrome's
 * MediaRecorder).
 */
export function sniffVideoMime(bytes: Buffer): string | null {
    // ISO Base Media: a `ftyp` box at offset 4, major brand at offset 8.
    if (
        bytes.length >= 12 &&
        bytes.subarray(4, 8).toString('latin1') === 'ftyp'
    ) {
        const brand = bytes.subarray(8, 12).toString('latin1');
        if (brand === 'qt  ') return 'video/quicktime';
        return MP4_BRANDS.has(brand) ? 'video/mp4' : null;
    }
    // EBML container. Matroska and WebM share the magic number and are told
    // apart by the DocType string in the header.
    if (
        bytes.length >= 4 &&
        bytes[0] === 0x1a &&
        bytes[1] === 0x45 &&
        bytes[2] === 0xdf &&
        bytes[3] === 0xa3
    ) {
        const head = bytes.subarray(0, EBML_SNIFF_WINDOW).toString('latin1');
        if (head.includes('webm')) return 'video/webm';
        if (head.includes('matroska')) return 'video/x-matroska';
    }
    return null;
}
