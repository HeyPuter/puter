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
import { loginProgressBody } from './loginProgressBody.js';

beforeAll(() => {
    // Same encoder the GUI installs globally (see lib/html-entities.js).
    globalThis.html_encode = str => encode(str);
    // Placeholder substitution only — the caller is responsible for encoding,
    // which is exactly what these tests check.
    globalThis.i18n = (key, vars = {}, encode_html = true) => {
        expect(encode_html).toBe(false);
        return `Logging in as <strong>${vars.identity}</strong>`;
    };
});

describe('loginProgressBody', () => {
    it('shows the email, falling back to the username', () => {
        expect(loginProgressBody({ username: 'alice', email: 'alice@example.com' }, ''))
            .toContain('alice@example.com');
        expect(loginProgressBody({ username: 'alice', email: null }, ''))
            .toContain('<strong>alice</strong>');
    });

    it('encodes an identity carrying markup', () => {
        const h = loginProgressBody({ email: '<img src=x onerror=alert(1)>' }, '');
        expect(h).not.toContain('<img');
        expect(h).toContain('&lt;img src=x onerror=alert(1)&gt;');
    });

    it('encodes a picture URL that tries to escape the style attribute', () => {
        const h = loginProgressBody(
            { username: 'alice' },
            "data:image/svg+xml,'); background: red; x: ('",
        );
        expect(h).not.toContain("'); background: red");
        expect(h).toContain('&apos;); background: red');
    });

    it('renders without a user or a picture', () => {
        const h = loginProgressBody(undefined, undefined);
        expect(h).toContain('<strong></strong>');
        expect(h).toContain("url('')");
    });
});
