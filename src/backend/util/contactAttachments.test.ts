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

import { describe, expect, it } from 'vitest';
import {
    MAX_ATTACHMENTS,
    MAX_ATTACHMENT_BYTES,
    MAX_TOTAL_ATTACHMENT_BYTES,
    attachmentMetadata,
    attachmentSummary,
    sanitizeAttachmentName,
    validateContactAttachments,
} from './contactAttachments.js';

// -- Fixtures --------------------------------------------------------
//
// Real magic numbers with filler bodies. `pad` sizes a payload without
// disturbing the header the sniffer reads.

const pad = (header: Buffer, size: number): Buffer =>
    Buffer.concat([header, Buffer.alloc(Math.max(0, size - header.length), 0x61)]);

const PNG_HEADER = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const GIF_HEADER = Buffer.from('GIF89a', 'latin1');
const WEBP_HEADER = Buffer.concat([
    Buffer.from('RIFF', 'latin1'),
    Buffer.from([0x00, 0x00, 0x00, 0x00]),
    Buffer.from('WEBP', 'latin1'),
]);
const mp4 = (brand: string): Buffer =>
    Buffer.concat([
        Buffer.from([0x00, 0x00, 0x00, 0x18]),
        Buffer.from('ftyp', 'latin1'),
        Buffer.from(brand, 'latin1'),
    ]);
const WEBM_HEADER = Buffer.concat([
    Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
    Buffer.from('\x42\x82\x84webm', 'latin1'),
]);

const png = (size = 64): string => pad(PNG_HEADER, size).toString('base64');
const b64 = (buf: Buffer): string => buf.toString('base64');

describe('validateContactAttachments — accepted shapes', () => {
    it('treats a missing or null field as no attachments', () => {
        expect(validateContactAttachments(undefined)).toEqual({
            ok: true,
            attachments: [],
        });
        expect(validateContactAttachments(null)).toEqual({
            ok: true,
            attachments: [],
        });
        expect(validateContactAttachments([])).toEqual({
            ok: true,
            attachments: [],
        });
    });

    it.each([
        ['png', PNG_HEADER, 'image/png', 'png'],
        ['jpeg', JPEG_HEADER, 'image/jpeg', 'jpg'],
        ['gif', GIF_HEADER, 'image/gif', 'gif'],
        ['webp', WEBP_HEADER, 'image/webp', 'webp'],
        ['mp4', mp4('isom'), 'video/mp4', 'mp4'],
        ['quicktime', mp4('qt  '), 'video/quicktime', 'mov'],
        ['webm', WEBM_HEADER, 'video/webm', 'webm'],
    ])('accepts %s and reports its sniffed type', (_label, header, mime, ext) => {
        const result = validateContactAttachments([
            { name: `capture.${ext}`, data: b64(pad(header, 64)) },
        ]);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.attachments[0].contentType).toBe(mime);
        expect(result.attachments[0].filename).toBe(`capture.${ext}`);
        expect(result.attachments[0].size).toBe(64);
    });

    it('tolerates line-wrapped base64', () => {
        const wrapped = png(256).replace(/(.{40})/g, '$1\n');
        const result = validateContactAttachments([
            { name: 'a.png', data: wrapped },
        ]);
        expect(result.ok).toBe(true);
    });

    it('accepts exactly the maximum number of files', () => {
        const result = validateContactAttachments(
            Array.from({ length: MAX_ATTACHMENTS }, () => ({ data: png() })),
        );
        expect(result.ok).toBe(true);
    });
});

describe('validateContactAttachments — the type allow-list', () => {
    it('rejects SVG, which is script-capable even though it is an image', () => {
        const svg = Buffer.from(
            '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
        );
        const result = validateContactAttachments([
            { name: 'x.png', data: b64(svg) },
        ]);
        expect(result).toMatchObject({
            ok: false,
            reason: expect.stringContaining('not a supported image or video'),
        });
    });

    it.each([
        ['HTML', Buffer.from('<html><body>hi</body></html>')],
        ['a Windows executable', Buffer.from('MZ\x90\x00\x03\x00\x00\x00')],
        ['a zip/office file', Buffer.from('PK\x03\x04nonsense')],
        ['a PDF', Buffer.from('%PDF-1.7\nnonsense')],
        ['plain text', Buffer.from('just some text, nothing to see here')],
        ['HEIC (an ISO container that is not video)', mp4('heic')],
        ['M4A audio (an ISO container that is not video)', mp4('M4A ')],
    ])('rejects %s', (_label, payload) => {
        const result = validateContactAttachments([
            { name: 'evidence.png', data: b64(pad(payload, 64)) },
        ]);
        expect(result.ok).toBe(false);
    });

    it('ignores any type the caller declares and uses the sniffed one', () => {
        const result = validateContactAttachments([
            { name: 'a.mp4', type: 'video/mp4', data: png() },
        ]);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.attachments[0].contentType).toBe('image/png');
        expect(result.attachments[0].filename).toBe('a.png');
    });
});

describe('validateContactAttachments — size and count limits', () => {
    it('rejects more files than the count cap', () => {
        const result = validateContactAttachments(
            Array.from({ length: MAX_ATTACHMENTS + 1 }, () => ({ data: png() })),
        );
        expect(result).toMatchObject({
            ok: false,
            reason: expect.stringContaining('too many attachments'),
        });
    });

    it('rejects a single file over the per-file cap', () => {
        const result = validateContactAttachments([
            { data: png(MAX_ATTACHMENT_BYTES + 1) },
        ]);
        expect(result).toMatchObject({
            ok: false,
            reason: expect.stringContaining('too large'),
        });
    });

    it('rejects an oversized payload without decoding it', () => {
        // Far past the cap; a length check has to catch this, not a decode.
        const result = validateContactAttachments([
            { data: 'A'.repeat(MAX_ATTACHMENT_BYTES * 2) },
        ]);
        expect(result).toMatchObject({
            ok: false,
            reason: expect.stringContaining('too large'),
        });
    });

    it('rejects files that are individually fine but too large together', () => {
        const each = Math.ceil(MAX_TOTAL_ATTACHMENT_BYTES / 2) + 1024;
        const result = validateContactAttachments([
            { data: png(each) },
            { data: png(each) },
        ]);
        expect(result).toMatchObject({
            ok: false,
            reason: expect.stringContaining('in total'),
        });
    });
});

describe('validateContactAttachments — malformed entries', () => {
    it.each([
        ['a non-array field', 'nope' as unknown],
        ['an object field', { data: png() } as unknown],
    ])('rejects %s', (_label, value) => {
        expect(validateContactAttachments(value)).toMatchObject({ ok: false });
    });

    it.each([
        ['a string entry', 'AAAA'],
        ['a null entry', null],
        ['an array entry', ['AAAA']],
    ])('rejects %s', (_label, entry) => {
        expect(validateContactAttachments([entry])).toMatchObject({
            ok: false,
            reason: expect.stringContaining('must be an object'),
        });
    });

    it.each([
        ['missing data', {}],
        ['empty data', { data: '' }],
        ['non-string data', { data: 12345 }],
    ])('rejects an entry with %s', (_label, entry) => {
        expect(validateContactAttachments([entry])).toMatchObject({
            ok: false,
            reason: expect.stringContaining('missing base64'),
        });
    });

    it('rejects base64 with characters smuggled past the alphabet', () => {
        // Buffer.from(..., 'base64') silently drops the junk; the strict
        // round-trip is what has to notice.
        const result = validateContactAttachments([
            { data: `${png()}" onerror=alert(1)` },
        ]);
        expect(result).toMatchObject({
            ok: false,
            reason: expect.stringContaining('not valid base64'),
        });
    });

    it('names the offending file without echoing caller input back', () => {
        const result = validateContactAttachments([
            { data: png() },
            { name: '<img onerror=alert(1)>', data: b64(Buffer.from('nope!!')) },
        ]);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.reason).toContain('attachment 2');
        expect(result.reason).not.toContain('alert');
    });
});

describe('sanitizeAttachmentName', () => {
    it('re-derives the extension from the sniffed type', () => {
        expect(sanitizeAttachmentName('payload.html', 0, 'png')).toBe(
            'payload.png',
        );
        expect(sanitizeAttachmentName('installer.exe', 0, 'mp4')).toBe(
            'installer.mp4',
        );
    });

    it('keeps only the basename of a path', () => {
        expect(sanitizeAttachmentName('../../etc/passwd', 0, 'png')).toBe(
            'passwd.png',
        );
        expect(sanitizeAttachmentName('C:\\Windows\\notes.txt', 0, 'png')).toBe(
            'notes.png',
        );
    });

    it('strips characters that would break out of a header', () => {
        const name = sanitizeAttachmentName(
            'bug\r\nBcc: victim@example.com"; x="y',
            0,
            'png',
        );
        expect(name).not.toMatch(/[\r\n"';\\]/);
        expect(name.endsWith('.png')).toBe(true);
    });

    it('strips bidi overrides used to disguise an extension', () => {
        const name = sanitizeAttachmentName('report\u202Egnp.exe', 0, 'png');
        expect(name).not.toContain('\u202E');
        expect(name.endsWith('.png')).toBe(true);
    });

    it('never produces a leading dot or a traversal segment', () => {
        expect(sanitizeAttachmentName('..', 0, 'png')).toBe('attachment-1.png');
        expect(sanitizeAttachmentName('.bashrc', 0, 'png')).toBe(
            'attachment-1.png',
        );
    });

    it('falls back to a positional name when nothing usable survives', () => {
        expect(sanitizeAttachmentName(undefined, 2, 'mp4')).toBe(
            'attachment-3.mp4',
        );
        expect(sanitizeAttachmentName('   ', 0, 'png')).toBe('attachment-1.png');
        expect(sanitizeAttachmentName(42, 0, 'png')).toBe('attachment-1.png');
    });

    it('bounds the length of a name it keeps', () => {
        const name = sanitizeAttachmentName('x'.repeat(500), 0, 'png');
        expect(name.length).toBeLessThanOrEqual(90);
    });
});

describe('attachment reporting helpers', () => {
    it('records names, types and sizes but never payloads', () => {
        const result = validateContactAttachments([
            { name: 'shot.png', data: png(128) },
        ]);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const meta = attachmentMetadata(result.attachments);
        expect(meta).toEqual([
            { name: 'shot.png', type: 'image/png', size: 128 },
        ]);
        expect(JSON.stringify(meta)).not.toContain('iVBOR');
    });

    it('summarizes what was attached for the email body', () => {
        const result = validateContactAttachments([
            { name: 'shot.png', data: png(2048) },
        ]);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const summary = attachmentSummary(result.attachments);
        expect(summary).toContain('Attachments (1)');
        expect(summary).toContain('shot.png');
        expect(summary).toContain('2.0 KB');
    });
});
