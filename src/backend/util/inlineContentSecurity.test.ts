/**
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

import type { Response } from 'express';
import { describe, expect, it } from 'vitest';
import { applyInlineContentSecurity } from './inlineContentSecurity.js';

const makeRes = () => {
    const headers: Record<string, string> = {};
    return {
        res: {
            setHeader: (k: string, v: string) => {
                headers[k.toLowerCase()] = v;
            },
        } as unknown as Response,
        headers,
    };
};

describe('applyInlineContentSecurity', () => {
    it.each([
        'text/html',
        'text/html; charset=utf-8',
        'image/svg+xml',
        'application/xhtml+xml',
        'application/xml',
        'text/xml',
        'TEXT/HTML',
    ])('sandboxes active-document type %s', (ct) => {
        const { res, headers } = makeRes();
        expect(applyInlineContentSecurity(res, ct)).toBe(true);
        expect(headers['content-security-policy']).toBe(
            "default-src 'none'; sandbox;",
        );
        expect(headers['x-content-type-options']).toBe('nosniff');
    });

    it.each([
        'image/png',
        'image/jpeg',
        'audio/mpeg',
        'video/mp4',
        'application/octet-stream',
        'application/pdf',
        'text/plain',
    ])('leaves inert type %s untouched', (ct) => {
        const { res, headers } = makeRes();
        expect(applyInlineContentSecurity(res, ct)).toBe(false);
        expect(headers['content-security-policy']).toBeUndefined();
    });

    it('no-ops on null/undefined content type', () => {
        const { res, headers } = makeRes();
        expect(applyInlineContentSecurity(res, null)).toBe(false);
        expect(applyInlineContentSecurity(res, undefined)).toBe(false);
        expect(headers['content-security-policy']).toBeUndefined();
    });
});
