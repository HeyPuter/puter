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

import { describe, it, expect, afterEach } from 'vitest';
import { get_oidc_return_to } from './authRedirect.js';

const at = (pathname, search = '') => {
    globalThis.window = { location: { pathname, search } };
    return get_oidc_return_to();
};

const SHARE_UUID = '11111111-2222-3333-4444-555555555555';
const shared_path = (name) => `/alice/${SHARE_UUID}/${name}`;

/** `window.location.search` for a page opened by a share link. */
const share_search = (...paths) => {
    const params = new URLSearchParams();
    for ( const path of paths ) params.append('shared', path);
    return `?${params.toString()}`;
};

afterEach(() => {
    delete globalThis.window;
});

describe('get_oidc_return_to', () => {
    it('returns the interface pages the backend whitelists', () => {
        expect(at('/desktop')).toBe('/desktop');
        expect(at('/dashboard')).toBe('/dashboard');
    });

    it('returns app landings, normalizing a trailing slash', () => {
        expect(at('/app/editor')).toBe('/app/editor');
        expect(at('/app/editor/')).toBe('/app/editor');
    });

    it('keeps a desktop app landing on the desktop', () => {
        expect(at('/desktop/app/editor')).toBe('/desktop/app/editor');
        expect(at('/desktop/app/editor/')).toBe('/desktop/app/editor');
    });

    it('carries a share link so the item survives the round trip', () => {
        expect(at('/', share_search(shared_path('Report.pdf')))).toBe(
            `/${share_search(shared_path('Report.pdf'))}`,
        );
        expect(at('/desktop', share_search(shared_path('Report.pdf')))).toBe(
            `/desktop${share_search(shared_path('Report.pdf'))}`,
        );
        expect(
            at('/', share_search(shared_path('a.txt'), shared_path('b.txt'))),
        ).toBe(`/${share_search(shared_path('a.txt'), shared_path('b.txt'))}`);
    });

    it('leaves behind everything that is not a share link', () => {
        // a hand-edited value the backend would refuse anyway
        expect(at('/', share_search('/alice/Documents/Report.pdf'))).toBe(null);
        expect(at('/', '?shared=')).toBe(null);
        // other parameters are not ours to carry
        expect(at('/desktop', '?app=editor')).toBe('/desktop');
        expect(
            at('/desktop', `${share_search(shared_path('a.txt'))}&app=editor`),
        ).toBe(`/desktop${share_search(shared_path('a.txt'))}`);
    });

    it('returns null for anything the backend would reject', () => {
        expect(at('/')).toBe(null);
        expect(at('/settings')).toBe(null);
        expect(at('/action/login')).toBe(null);
        expect(at('/app/editor/extra')).toBe(null);
        expect(at('/desktop/app/editor/extra')).toBe(null);
        expect(at('/dashboard/app/editor')).toBe(null);
    });
});
