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

import { describe, it, expect, beforeAll } from 'vitest';
import { encode } from 'html-entities';
import { templateMenuItem } from './templateMenuItem.js';

beforeAll(() => {
    globalThis.html_encode = str => encode(str);
});

describe('templateMenuItem', () => {
    it('labels a template by extension and name', () => {
        expect(templateMenuItem('/alice/Templates', 'report.docx')).toEqual({
            path: '/alice/Templates/report.docx',
            html: 'DOCX report',
            extension: 'docx',
            name: 'report.docx',
        });
    });

    it('labels .txt files as TEXT and files without an extension by name', () => {
        expect(templateMenuItem('/alice/Templates', 'notes.txt').html).toBe('TEXT notes');
        expect(templateMenuItem('/alice/Templates', 'Makefile').html).toBe(' Makefile');
    });

    it('encodes markup in the extension and the name', () => {
        const item = templateMenuItem('/alice/Templates', '<i>x.<img src=x onerror=alert(1)>');
        expect(item.html).not.toContain('<');
        expect(item.html).toBe('&lt;IMG SRC=X ONERROR=ALERT(1)&gt; &lt;i&gt;x');
    });
});
