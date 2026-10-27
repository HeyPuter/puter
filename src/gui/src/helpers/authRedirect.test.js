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
import { get_oidc_return_to, takeOidcLoginChallenge } from './authRedirect.js';

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
    delete globalThis.document;
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

    it('carries the intended account through the OIDC round trip', () => {
        const search = `${share_search(shared_path('Report.pdf'))}&user_uuid=aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee`;
        expect(at('/', search)).toBe(`/${search}`);
    });

    it('drops an invalid intended-account hint', () => {
        const shared = share_search(shared_path('Report.pdf'));
        expect(at('/', `${shared}&user_uuid=recipient`)).toBe(`/${shared}`);
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


describe('provider second-factor return context', () => {
    const bootAt = (href) => {
        globalThis.document = { title: 'Puter' };
        const location = { href };
        let replaced = false;
        globalThis.window = { location, history: { replaceState: (_state, _title, target) => {
            location.href = new URL(target, location.href).href;
            replaced = true;
        } } };
        const result = takeOidcLoginChallenge();
        return { result, location, replaced };
    };

    it.each(['/action/oidc-2fa', '/desktop/action/oidc-2fa', '/?action=oidc-2fa'])(
        'scrubs the first-factor token before boot can retain %s', path => {
            const retry = 'https://puter.test/?action=login&embedded_in_popup=true&msg_id=123&opener_state=retry-proof';
            const { result, location, replaced } = bootAt(`https://puter.test${path}#${new URLSearchParams({ token: 'first-factor-proof', retryUrl: retry })}`);
            expect(result).toEqual({ token: 'first-factor-proof', retryUrl: retry });
            expect(replaced).toBe(true);
            expect(location.href).not.toContain('first-factor-proof');
            expect(location.href).not.toContain('retry-proof');
            window.url = location.href;
            expect(window.url).not.toContain('#');
        },
    );

    it.each(['https://other.test/?action=login', 'javascript:alert(1)', 'https://puter.test/?action=authme', '%'])('refuses an unsafe cancellation target %s', retryUrl => {
        const { result } = bootAt(`https://puter.test/action/oidc-2fa#${new URLSearchParams({ token: 'challenge', retryUrl })}`);
        expect(result.retryUrl).toBe('/action/login');
    });

    it('keeps ordinary app URL fragments intact', () => {
        const { result, location, replaced } = bootAt('https://puter.test/app/editor#document=123');
        expect(result).toBeNull();
        expect(replaced).toBe(false);
        expect(location.href).toContain('#document=123');
    });

    it('returns to ordinary login when a challenge link has no retry context', () => {
        const { result } = bootAt('https://puter.test/action/oidc-2fa#token=challenge');
        expect(result).toEqual({ token: 'challenge', retryUrl: '/action/login' });
    });
});
