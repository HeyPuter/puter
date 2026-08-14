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

import { describe, it, expect } from 'vitest';
import {
    MAX_ATTACHMENTS,
    MAX_ATTACHMENT_BYTES,
    MAX_TOTAL_ATTACHMENT_BYTES,
    base64FromDataUrl,
    checkAttachment,
} from './contact_attachments.js';

const file = (overrides = {}) => ({
    name: 'shot.png',
    type: 'image/png',
    size: 1024,
    ...overrides,
});

describe('checkAttachment', () => {
    it('accepts a screenshot on an empty form', () => {
        expect(checkAttachment(file(), [])).toEqual({ ok: true });
        expect(checkAttachment(file(), undefined)).toEqual({ ok: true });
    });

    it('accepts the screen recording formats each platform produces', () => {
        for ( const type of ['video/mp4', 'video/quicktime', 'video/webm'] ) {
            expect(checkAttachment(file({ type }), [])).toEqual({ ok: true });
        }
    });

    it('rejects types outside the allow-list', () => {
        for ( const type of ['image/svg+xml', 'application/pdf', 'text/html', 'application/zip', ''] ) {
            expect(checkAttachment(file({ type }), [])).toEqual({
                ok: false, error: 'contact_us_attachment_unsupported',
            });
        }
    });

    it('rejects a dropped directory, which arrives as a typeless zero-byte entry', () => {
        expect(checkAttachment(file({ type: '', size: 0 }), [])).toEqual({
            ok: false, error: 'contact_us_attachment_unsupported',
        });
        expect(checkAttachment(undefined, [])).toEqual({
            ok: false, error: 'contact_us_attachment_unsupported',
        });
    });

    it('rejects a file over the per-file cap', () => {
        expect(checkAttachment(file({ size: MAX_ATTACHMENT_BYTES + 1 }), [])).toEqual({
            ok: false, error: 'contact_us_attachment_too_large',
        });
        expect(checkAttachment(file({ size: MAX_ATTACHMENT_BYTES }), [])).toEqual({ ok: true });
    });

    it('rejects one more file than the count cap allows', () => {
        const staged = Array.from({ length: MAX_ATTACHMENTS }, () => file());
        expect(checkAttachment(file(), staged)).toEqual({
            ok: false, error: 'contact_us_attachment_too_many',
        });
        expect(checkAttachment(file(), staged.slice(1))).toEqual({ ok: true });
    });

    it('counts what is already staged toward the total cap', () => {
        const half = Math.floor(MAX_TOTAL_ATTACHMENT_BYTES / 2);
        // Two halves exactly fill the budget; one byte more does not fit.
        expect(checkAttachment(file({ size: half }), [file({ size: half })])).toEqual({ ok: true });
        expect(checkAttachment(file({ size: half + 1 }), [file({ size: half })])).toEqual({
            ok: false, error: 'contact_us_attachment_total_too_large',
        });
    });
});

describe('base64FromDataUrl', () => {
    it('strips the prefix off a base64 data URL', () => {
        expect(base64FromDataUrl('data:image/png;base64,iVBORw0KGgo=')).toBe('iVBORw0KGgo=');
    });

    it('returns null for anything that is not a base64 data URL', () => {
        expect(base64FromDataUrl('data:image/png,rawtext')).toBeNull();
        expect(base64FromDataUrl('data:image/png;base64,')).toBeNull();
        expect(base64FromDataUrl('iVBORw0KGgo=')).toBeNull();
        expect(base64FromDataUrl(null)).toBeNull();
        expect(base64FromDataUrl(undefined)).toBeNull();
    });
});
