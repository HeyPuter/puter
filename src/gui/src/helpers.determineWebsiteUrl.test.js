// @vitest-environment jsdom
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

import { describe, expect, it, vi } from 'vitest';
import jQuery from './lib/jquery-3.6.1/jquery-3.6.1.min.js';

vi.mock('./UI/UIAlert.js', () => ({ default: vi.fn() }));
vi.mock('./UI/UIItem.js', () => ({ default: vi.fn() }));
vi.mock('./UI/UIWindowLogin.js', () => ({ default: vi.fn() }));
vi.mock('./UI/UIWindowProgress.js', () => ({ default: vi.fn() }));
vi.mock('./UI/UIWindowSaveAccount.js', () => ({ default: vi.fn() }));

globalThis.$ = jQuery;
globalThis.jQuery = jQuery;
globalThis.i18n = key => key;
globalThis.def = globalThis.def ?? (value => value);
globalThis.use = globalThis.use ?? (() => class {});
globalThis.html_encode = value => jQuery('<div>').text(value).html();

await import('./helpers.js');

describe('determine_website_url', () => {
    // As puter.hosting.list() returns a site.
    const site = {
        subdomain: 'mysite',
        root_dir: {
            path: '/alice/Site',
            subdomains: [{ subdomain: 'mysite', address: 'https://mysite.puter.site' }],
        },
    };

    it('gives an item under a published folder its address there', () => {
        window.sites = [site];
        expect(window.determine_website_url('/alice/Site/index.html')).toBe('https://mysite.puter.site/index.html');
        expect(window.determine_website_url('/alice/Site/css/a b.css')).toBe('https://mysite.puter.site/css/a b.css');
    });

    it('gives none to the folder itself or to anything outside it', () => {
        window.sites = [site];
        expect(window.determine_website_url('/alice/Site')).toBeNull();
        expect(window.determine_website_url('/alice/Sites/index.html')).toBeNull();
        window.sites = [];
        expect(window.determine_website_url('/alice/Site/index.html')).toBeNull();
    });
});
