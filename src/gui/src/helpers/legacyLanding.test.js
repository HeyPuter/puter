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
import { legacy_landing } from './legacyLanding.js';
import { parse_url_paths } from './urlPaths.js';

const at = (pathname, search = '') =>
    legacy_landing(parse_url_paths(pathname), new URLSearchParams(search));

describe('legacy_landing', () => {
    it('opens a user\'s public folder from /@<user>', () => {
        expect(at('/@alice')).toEqual({ open_path: '/alice/Public' });
        expect(at('/@alice/site/index.html')).toEqual({
            open_path: '/alice/Public/site/index.html',
        });
    });

    it('decodes the path segments it opens', () => {
        expect(at('/@alice/My%20Site')).toEqual({ open_path: '/alice/Public/My Site' });
        expect(at('/show/alice/Documents/a%20b.txt')).toEqual({
            open_path: '/alice/Documents/a b.txt',
        });
        // a malformed escape is kept as written rather than throwing
        expect(at('/show/alice/100%')).toEqual({ open_path: '/alice/100%' });
    });

    it('refuses a /@ path that names no valid username', () => {
        expect(at('/@al.ice')).toEqual({ invalid_username: true });
        expect(at('/@')).toEqual({ invalid_username: true });
    });

    it('opens /show/<path>', () => {
        expect(at('/show/alice/Documents')).toEqual({ open_path: '/alice/Documents' });
        // /show alone names nothing to open
        expect(at('/show')).toBe(null);
    });

    it('sends /settings to Home', () => {
        expect(at('/settings')).toEqual({ route: { tab: 'home', path: null } });
        expect(at('/settings/account')).toEqual({ route: { tab: 'home', path: null } });
    });

    it('sends ?app=explorer to Files, at its path if it names one', () => {
        expect(at('/', '?app=explorer')).toEqual({ route: { tab: 'files', path: null } });
        expect(at('/', '?app=explorer&path=/alice/Documents')).toEqual({
            route: { tab: 'files', path: '/alice/Documents' },
        });
    });

    it('leaves every other URL to the dashboard', () => {
        expect(at('/')).toBe(null);
        expect(at('/dashboard')).toBe(null);
        expect(at('/app/editor')).toBe(null);
        expect(at('/action/login')).toBe(null);
        expect(at('/', '?app=editor')).toBe(null);
        expect(at('/', '?shared=/alice/x/y')).toBe(null);
    });
});
