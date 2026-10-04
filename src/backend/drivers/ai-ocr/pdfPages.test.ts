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
import { buildPdf } from '../../testFixtures/pdf.js';
import { countPdfPages } from './pdfPages.js';

const pdf = (body: string) => Buffer.from(`%PDF-1.7\n${body}`, 'latin1');

describe('countPdfPages', () => {
    it('counts the pages of a multi-page PDF', () => {
        expect(countPdfPages(buildPdf(1))).toBe(1);
        expect(countPdfPages(buildPdf(130))).toBe(130);
    });

    it('reads page objects packed in a compressed object stream', () => {
        const packed = buildPdf(42, { objectStream: true });
        // Nothing about the pages is visible without inflating the stream.
        expect(packed.includes('/Type /Page')).toBe(false);
        expect(countPdfPages(packed)).toBe(42);
    });

    it('reads the total from a nested page tree', () => {
        expect(
            countPdfPages(
                pdf(
                    '1 0 obj\n<< /Type /Pages /Kids [2 0 R 3 0 R] /Count 7 >>\nendobj\n' +
                        '2 0 obj\n<< /Type /Pages /Parent 1 0 R /Kids [4 0 R] /Count 4 >>\nendobj\n' +
                        '3 0 obj\n<< /Type /Pages /Parent 1 0 R /Kids [5 0 R] /Count 3 >>\nendobj\n',
                ),
            ),
        ).toBe(7);
    });

    it('counts page objects when the tree understates them', () => {
        const pages = Array.from(
            { length: 5 },
            (_, i) => `${i + 2} 0 obj\n<</Type/Page/Parent 1 0 R>>\nendobj\n`,
        ).join('');
        expect(
            countPdfPages(
                pdf(`1 0 obj\n<</Type/Pages/Count 1>>\nendobj\n${pages}`),
            ),
        ).toBe(5);
    });

    it('reads names written with # escapes', () => {
        expect(
            countPdfPages(
                pdf(
                    '1 0 obj\n<< /Type /P#61ges /C#6funt 9 >>\nendobj\n' +
                        '2 0 obj\n<< /Type /P#61ge >>\nendobj\n',
                ),
            ),
        ).toBe(9);
    });

    it("can't be shrunk by redefining an object number lower", () => {
        // An unreferenced redefinition trying to pass off a smaller tree;
        // a genuine object number reuse can only raise the count, never lower it.
        expect(
            countPdfPages(
                pdf(
                    '1 0 obj\n<< /Type /Pages /Count 3 >>\nendobj\n' +
                        '2 0 obj\n<< /Type /Page >>\nendobj\n' +
                        '3 0 obj\n<< /Type /Page >>\nendobj\n' +
                        '1 0 obj\n<< /Type /Pages /Count 1 >>\nendobj\n' +
                        '3 0 obj\n<< /Type /Annot >>\nendobj\n',
                ),
            ),
        ).toBe(3);
    });

    it('treats an indirect /Count as unknown rather than reading its reference as the total', () => {
        expect(
            countPdfPages(
                pdf(
                    '1 0 obj\n<< /Type /Pages /Kids [2 0 R 3 0 R] /Count 3 0 R >>\nendobj\n',
                ),
            ),
        ).toBeNull();
    });

    it('counts a kid with no /Type as long as it has no /Kids of its own', () => {
        expect(
            countPdfPages(
                pdf(
                    '1 0 obj\n<< /Type /Pages /Kids [2 0 R 3 0 R] /Count 1 >>\nendobj\n' +
                        '2 0 obj\n<< /Type /Page /Parent 1 0 R >>\nendobj\n' +
                        '3 0 obj\n<< /Parent 1 0 R /MediaBox [0 0 612 792] >>\nendobj\n',
                ),
            ),
        ).toBe(2);
    });

    it("doesn't count untyped objects that aren't page tree kids", () => {
        // Outline items, merged field widgets and name-tree leaves have no
        // /Type and no /Kids either, but no reader takes them for pages.
        expect(
            countPdfPages(
                pdf(
                    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R /Outlines 4 0 R /Names << /Dests 9 0 R >> >>\nendobj\n' +
                        '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n' +
                        '3 0 obj\n<< /Type /Page /Parent 2 0 R /Annots [7 0 R 8 0 R] >>\nendobj\n' +
                        '4 0 obj\n<< /Type /Outlines /First 5 0 R /Last 5 0 R /Count 1 >>\nendobj\n' +
                        '5 0 obj\n<< /Title (A) /Parent 4 0 R /Dest [3 0 R /Fit] >>\nendobj\n' +
                        '6 0 obj\n<< /FT /Btn /T (choice) /Kids [7 0 R 8 0 R] >>\nendobj\n' +
                        '7 0 obj\n<< /Subtype /Widget /Parent 6 0 R /P 3 0 R >>\nendobj\n' +
                        '8 0 obj\n<< /Subtype /Widget /Parent 6 0 R /P 3 0 R >>\nendobj\n' +
                        '9 0 obj\n<< /Kids [10 0 R] >>\nendobj\n' +
                        '10 0 obj\n<< /Names [(a) 3 0 R] /Limits [(a) (a)] >>\nendobj\n',
                ),
            ),
        ).toBe(1);
    });

    it('decodes a # escaped /ObjStm type before deciding whether to unpack it', () => {
        const header = '2 0\n';
        const packedObject = '<< /Type /Page >>';
        const objStm =
            `5 0 obj\n<< /Type /ObjS#74m /N 1 /First ${header.length} >>\n` +
            `stream\n${header}${packedObject}\nendstream\nendobj\n`;
        expect(countPdfPages(pdf(objStm))).toBe(1);
    });

    it("refuses an object stream that claims more objects than it's worth counting", () => {
        const objStm =
            '1 0 obj\n<< /Type /ObjStm /N 100001 /First 4 >>\nstream\n1 0\nendstream\nendobj\n';
        expect(countPdfPages(pdf(objStm))).toBeNull();
    });

    it('refuses an oversized /First without scanning the data behind it', () => {
        // Without a cap this would run a regex match over ~2MB of digits.
        const data = '1 '.repeat(1_000_000);
        const objStm =
            `1 0 obj\n<< /Type /ObjStm /N 1 /First ${data.length} >>\n` +
            `stream\n${data}\nendstream\nendobj\n`;
        const start = Date.now();
        expect(countPdfPages(pdf(objStm))).toBeNull();
        expect(Date.now() - start).toBeLessThan(500);
    });

    it('returns null for bytes that are not a PDF', () => {
        expect(countPdfPages(Buffer.from('PK\x03\x04 not a pdf'))).toBeNull();
        expect(countPdfPages(Buffer.alloc(0))).toBeNull();
    });

    it('returns null when no pages are visible', () => {
        expect(countPdfPages(pdf('garbage'))).toBeNull();
    });

    it('returns null when an object stream cannot be decoded', () => {
        // An encrypted or corrupt stream could hide the page tree.
        const unreadable = pdf(
            '1 0 obj\n<< /Type /Page >>\nendobj\n' +
                '2 0 obj\n<< /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode >>\nstream\n' +
                'not deflate data\nendstream\nendobj\n',
        );
        expect(countPdfPages(unreadable)).toBeNull();

        const otherFilter = pdf(
            '2 0 obj\n<< /Type /ObjStm /N 1 /First 4 /Filter /LZWDecode >>\nstream\n' +
                'data\nendstream\nendobj\n',
        );
        expect(countPdfPages(otherFilter)).toBeNull();
    });

    it('stops at the limit', () => {
        expect(countPdfPages(buildPdf(50), 10)).toBe(10);
        expect(countPdfPages(buildPdf(5), 10)).toBe(5);
    });
});
