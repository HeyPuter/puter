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

import { PassThrough, Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
    MAX_ATTACHMENTS,
    MAX_ATTACHMENT_BYTES,
    MAX_TOTAL_ATTACHMENT_BYTES,
    type ValidatedAttachment,
    attachmentMetadata,
    attachmentSummary,
    readContactSubmission,
    sanitizeAttachmentName,
    validateAttachment,
} from './contactAttachments.js';

// -- Fixtures --------------------------------------------------------
//
// Real magic numbers with filler bodies. `pad` sizes a payload without
// disturbing the header the sniffer reads.

const pad = (header: Buffer, size: number): Buffer =>
    Buffer.concat([
        header,
        Buffer.alloc(Math.max(0, size - header.length), 0x61),
    ]);

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

const png = (size = 64): Buffer => pad(PNG_HEADER, size);

type Part =
    | { field: string; value: string }
    | { field: string; filename: string; data: Buffer };

const BOUNDARY = '----contact-attachments-test';
const HEADERS = {
    'content-type': `multipart/form-data; boundary=${BOUNDARY}`,
};

const multipart = (parts: Part[]): Buffer =>
    Buffer.concat([
        ...parts.flatMap((part) =>
            'value' in part
                ? [
                      Buffer.from(
                          `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${part.field}"\r\n\r\n${part.value}\r\n`,
                      ),
                  ]
                : [
                      Buffer.from(
                          `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${part.field}"; filename="${part.filename}"\r\nContent-Type: image/png\r\n\r\n`,
                      ),
                      part.data,
                      Buffer.from('\r\n'),
                  ],
        ),
        Buffer.from(`--${BOUNDARY}--\r\n`),
    ]);

const file = (data: Buffer, filename = 'shot.png'): Part => ({
    field: 'attachments',
    filename,
    data,
});

const LIMITS = { maxMessageBytes: 1024, maxBodyBytes: 64 * 1024 * 1024 };

const read = (parts: Part[], headers: Record<string, string> = HEADERS) =>
    readContactSubmission(
        Object.assign(Readable.from([multipart(parts)]), { headers }),
        LIMITS,
    );

const accepted = (attachment: ReturnType<typeof validateAttachment>) => {
    if (!attachment.ok) throw new Error(attachment.reason);
    return attachment.attachment;
};

describe('validateAttachment — the type allow-list', () => {
    it.each([
        ['png', PNG_HEADER, 'image/png', 'png'],
        ['jpeg', JPEG_HEADER, 'image/jpeg', 'jpg'],
        ['gif', GIF_HEADER, 'image/gif', 'gif'],
        ['webp', WEBP_HEADER, 'image/webp', 'webp'],
        ['mp4', mp4('isom'), 'video/mp4', 'mp4'],
        ['quicktime', mp4('qt  '), 'video/quicktime', 'mov'],
        ['webm', WEBM_HEADER, 'video/webm', 'webm'],
    ])(
        'accepts %s and reports its sniffed type',
        (_label, header, mime, ext) => {
            const attachment = accepted(
                validateAttachment(pad(header, 64), `capture.${ext}`, 0),
            );
            expect(attachment.contentType).toBe(mime);
            expect(attachment.filename).toBe(`capture.${ext}`);
            expect(attachment.size).toBe(64);
        },
    );

    it('rejects SVG, which is script-capable even though it is an image', () => {
        const svg = Buffer.from(
            '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
        );
        expect(validateAttachment(svg, 'x.png', 0)).toMatchObject({
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
        expect(validateAttachment(pad(payload, 64), 'evidence.png', 0).ok).toBe(
            false,
        );
    });

    it('rejects an empty file', () => {
        expect(validateAttachment(Buffer.alloc(0), 'a.png', 1)).toEqual({
            ok: false,
            reason: 'attachment 2 is empty',
        });
    });

    it('names the offending file without echoing caller input back', () => {
        const verdict = validateAttachment(
            Buffer.from('nope!!'),
            '<img onerror=alert(1)>',
            1,
        );
        expect(verdict.ok).toBe(false);
        if (verdict.ok) return;
        expect(verdict.reason).toContain('attachment 2');
        expect(verdict.reason).not.toContain('alert');
    });
});

describe('readContactSubmission — accepted shapes', () => {
    it('reads the message and files, typed from their bytes', async () => {
        const result = await read([
            { field: 'message', value: 'it broke' },
            file(png(128), 'a.mp4'),
            file(pad(mp4('isom'), 256), 'screen.mov'),
        ]);
        expect(result).toMatchObject({ ok: true, message: 'it broke' });
        if (!result.ok) return;
        expect(
            result.attachments.map(({ filename, contentType, size }) => ({
                filename,
                contentType,
                size,
            })),
        ).toEqual([
            { filename: 'a.png', contentType: 'image/png', size: 128 },
            { filename: 'screen.mp4', contentType: 'video/mp4', size: 256 },
        ]);
        expect(result.attachments[0].content.equals(png(128))).toBe(true);
    });

    it('accepts a message with no files', async () => {
        expect(await read([{ field: 'message', value: 'hi' }])).toEqual({
            ok: true,
            message: 'hi',
            attachments: [],
        });
    });

    it('leaves a missing message for the caller to reject', async () => {
        const result = await read([file(png())]);
        expect(result).toMatchObject({ ok: true, message: undefined });
    });

    it('accepts exactly the maximum number of files', async () => {
        const result = await read([
            { field: 'message', value: 'hi' },
            ...Array.from({ length: MAX_ATTACHMENTS }, () => file(png())),
        ]);
        expect(result.ok).toBe(true);
    });

    it('accepts a file exactly at the per-file cap', async () => {
        const result = await read([
            { field: 'message', value: 'hi' },
            file(png(MAX_ATTACHMENT_BYTES)),
        ]);
        expect(result.ok).toBe(true);
    });

    it('keeps non-ASCII file names intact', async () => {
        const result = await read([
            { field: 'message', value: 'hi' },
            file(png(), 'captura de pantalla — día 3.png'),
        ]);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.attachments[0].filename).toBe(
            'captura de pantalla — día 3.png',
        );
    });
});

describe('readContactSubmission — limits', () => {
    it('rejects more files than the count cap', async () => {
        const result = await read([
            { field: 'message', value: 'hi' },
            ...Array.from({ length: MAX_ATTACHMENTS + 1 }, () => file(png())),
        ]);
        expect(result).toMatchObject({
            ok: false,
            status: 400,
            reason: expect.stringContaining('too many attachments'),
        });
    });

    it('rejects a single file over the per-file cap', async () => {
        const result = await read([
            { field: 'message', value: 'hi' },
            file(png(MAX_ATTACHMENT_BYTES + 1)),
        ]);
        expect(result).toMatchObject({
            ok: false,
            status: 413,
            reason: 'attachment 1 is too large (max 10 MB per file)',
        });
    });

    it('rejects files that are individually fine but too large together', async () => {
        const each = Math.ceil(MAX_TOTAL_ATTACHMENT_BYTES / 2) + 1024;
        const result = await read([
            { field: 'message', value: 'hi' },
            file(png(each)),
            file(png(each)),
        ]);
        expect(result).toMatchObject({
            ok: false,
            status: 413,
            reason: expect.stringContaining('in total'),
        });
    });

    it('discards the rest of the body after a broken limit', async () => {
        const req = Object.assign(new PassThrough(), { headers: HEADERS });
        const pending = readContactSubmission(req, LIMITS);
        const body = multipart([
            { field: 'message', value: 'hi' },
            file(png(MAX_ATTACHMENT_BYTES + 4096)),
        ]);
        req.write(body.subarray(0, body.length - 1024));
        await expect(pending).resolves.toMatchObject({
            ok: false,
            status: 413,
        });

        // Drained to the end rather than cut off, so the error response can
        // still be delivered.
        const ended = new Promise((resolve) => req.once('end', resolve));
        req.end(body.subarray(body.length - 1024));
        await ended;
        expect(req.readableEnded).toBe(true);
    });

    it('destroys a request that runs past the body budget', async () => {
        const req = Object.assign(new PassThrough(), { headers: HEADERS });
        const pending = readContactSubmission(req, {
            ...LIMITS,
            maxBodyBytes: 4096,
        });
        req.write(
            multipart([{ field: 'message', value: 'hi' }, file(png(8192))]),
        );
        await expect(pending).resolves.toEqual({
            ok: false,
            status: 413,
            reason: 'request body is too large',
        });
        expect(req.destroyed).toBe(true);
    });

    it('accepts a message exactly at the byte budget', async () => {
        const result = await read([
            { field: 'message', value: 'x'.repeat(1024) },
        ]);
        expect(result.ok).toBe(true);
    });

    it('rejects a message past the byte budget', async () => {
        const result = await read([
            { field: 'message', value: 'x'.repeat(1025) },
        ]);
        expect(result).toMatchObject({
            ok: false,
            reason: expect.stringContaining('too long'),
        });
    });
});

describe('readContactSubmission — malformed bodies', () => {
    it('rejects a content type without a boundary', async () => {
        const result = await read([{ field: 'message', value: 'hi' }], {
            'content-type': 'multipart/form-data',
        });
        expect(result).toMatchObject({
            ok: false,
            reason: 'malformed multipart body',
        });
    });

    it.each([
        ['an unknown text field', [{ field: 'note', value: 'x' }]],
        [
            'a duplicate message',
            [
                { field: 'message', value: 'a' },
                { field: 'message', value: 'b' },
            ],
        ],
        [
            'a file under another field name',
            [
                { field: 'message', value: 'hi' },
                { ...file(png()), field: 'file' },
            ],
        ],
    ] as [string, Part[]][])('rejects %s', async (_label, parts) => {
        expect(await read(parts)).toMatchObject({
            ok: false,
            reason: 'unexpected form field',
        });
    });

    it('rejects a body cut off mid-file without throwing', async () => {
        const body = multipart([
            { field: 'message', value: 'hi' },
            file(png(4096)),
        ]);
        const result = await readContactSubmission(
            Object.assign(Readable.from([body.subarray(0, 2048)]), {
                headers: HEADERS,
            }),
            LIMITS,
        );
        expect(result).toMatchObject({ ok: false, status: 400 });
    });

    it('rejects a submission whose file is not an allowed type', async () => {
        const result = await read([
            { field: 'message', value: 'hi' },
            file(png()),
            file(Buffer.from('%PDF-1.7\nnonsense'), 'b.pdf'),
        ]);
        expect(result).toMatchObject({
            ok: false,
            status: 400,
            reason: 'attachment 2 is not a supported image or video',
        });
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
        expect(sanitizeAttachmentName('   ', 0, 'png')).toBe(
            'attachment-1.png',
        );
        expect(sanitizeAttachmentName(42, 0, 'png')).toBe('attachment-1.png');
    });

    it('bounds the length of a name it keeps', () => {
        const name = sanitizeAttachmentName('x'.repeat(500), 0, 'png');
        expect(name.length).toBeLessThanOrEqual(90);
    });
});

describe('attachment reporting helpers', () => {
    const shot = (size: number): ValidatedAttachment =>
        accepted(validateAttachment(png(size), 'shot.png', 0));

    it('records names, types and sizes but never payloads', () => {
        const meta = attachmentMetadata([shot(128)]);
        expect(meta).toEqual([
            { name: 'shot.png', type: 'image/png', size: 128 },
        ]);
        expect(JSON.stringify(meta)).not.toContain('PNG');
    });

    it('summarizes what was attached for the email body', () => {
        const summary = attachmentSummary([shot(2048)]);
        expect(summary).toContain('Attachments (1)');
        expect(summary).toContain('shot.png');
        expect(summary).toContain('2.0 KB');
    });
});
