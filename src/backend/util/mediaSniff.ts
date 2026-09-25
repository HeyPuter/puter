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

// Identify uploaded media by its bytes. A caller-supplied MIME type or file
// extension is never trusted.

const BASE64_CHARS_REGEX = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * How far into a payload to look for an `<svg` root; SVG has no fixed magic
 * number.
 */
export const SVG_SNIFF_WINDOW = 8 * 1024;

/** How far into an EBML header to look for the DocType string. */
const EBML_SNIFF_WINDOW = 64;

/**
 * ISO Base Media brands treated as MP4 video. HEIF, M4A audio and JPEG 2000
 * share the `ftyp` box, so the brand decides.
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
 * Decode base64 that round-trips byte for byte. `Buffer.from(s, 'base64')`
 * silently skips characters outside the alphabet; the round-trip rejects them.
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
    // Must open as markup, not just mention `<svg` somewhere in text.
    if (!head.trimStart().startsWith('<')) return false;
    return /<svg[\s/>]/i.test(head);
}

/**
 * Canonical image MIME type for `bytes`, or null. Recognized is not accepted:
 * this can return script-capable `image/svg+xml`, so callers allow-list.
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
 * Canonical video MIME type for `bytes` (MP4, QuickTime, WebM, Matroska), or
 * null.
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
    // EBML: Matroska and WebM share the magic; the DocType tells them apart.
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
