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
import { appLaunchUrl, appendLaunchContext } from './appLaunchUrl.js';

const base = { appInstanceID: 'instance-1', guiOrigin: 'https://puter.test', appDomain: 'puter.test' };

describe('appLaunchUrl', () => {
    it('keeps the index_url\'s own params and names the launch after them', () => {
        const url = appLaunchUrl({ ...base, app: { uid: 'app-1', name: 'notes', index_url: 'https://notes.example.com/?mode=1' } });
        expect([...url.searchParams]).toEqual([
            ['mode', '1'],
            ['puter.app_instance_id', 'instance-1'],
            ['puter.app.id', 'app-1'],
            ['puter.app.name', 'notes'],
        ]);
    });

    it('drops launch params the index_url sets itself', () => {
        const url = appLaunchUrl({ ...base, app: { uid: 'app-1', name: 'notes', index_url: 'https://notes.example.com/?puter.api_origin=https://evil.example&puter.auth.token=x&mode=1' } });
        appendLaunchContext(url, {
            appDomain: 'puter.test',
            pageUrl: 'https://puter.test/',
            apiOrigin: 'https://api.puter.test',
            locale: 'en',
            surface: 'desktop',
        });
        expect(url.searchParams.getAll('puter.api_origin')).toEqual(['https://api.puter.test']);
        expect(url.searchParams.has('puter.auth.token')).toBe(false);
        expect(url.searchParams.get('mode')).toBe('1');
    });

    it('serves a built-in app from the GUI', () => {
        const url = appLaunchUrl({ ...base, app: { uid: 'app-1', name: 'settings', index_url: 'https://builtins.namespaces.puter.com/settings' } });
        expect(`${url.origin}${url.pathname}`).toBe('https://puter.test/builtin/settings');
    });

    it('falls back to the app\'s subdomain without an index_url', () => {
        const url = appLaunchUrl({ ...base, app: { uid: 'app-1', name: 'notes' } });
        expect(`${url.origin}${url.pathname}`).toBe('https://notes.puter.test/index.html');
    });
});

describe('appendLaunchContext', () => {
    it('tells the app where the GUI and API are', () => {
        const url = new URL('https://notes.example.com/');
        appendLaunchContext(url, {
            appDomain: 'puter.test',
            pageUrl: 'http://puter.test:4100/embed/apps',
            apiOrigin: 'http://api.puter.test:4100',
            params: { extra: 'x' },
            locale: 'en',
            args: { a: 1 },
            surface: 'dashboard',
        });
        expect(Object.fromEntries(url.searchParams)).toMatchObject({
            'puter.domain': 'puter.test',
            'puter.origin': 'http://puter.test:4100',
            'puter.hostname': 'puter.test',
            'puter.port': '4100',
            'puter.protocol': 'http',
            'puter.api_origin': 'http://api.puter.test:4100',
            'extra': 'x',
            'puter.locale': 'en',
            'puter.args': '{"a":1}',
            'utm_source': 'puter.com',
            'utm_medium': 'referral',
            'utm_campaign': 'dashboard',
        });
        expect(url.searchParams.has('utm_content')).toBe(false);
    });

    it('names what the user did and the site that sent them', () => {
        const url = new URL('https://notes.example.com/');
        appendLaunchContext(url, {
            appDomain: 'puter.test',
            pageUrl: 'https://puter.test/embed/apps',
            locale: 'en',
            surface: 'app_browser_embed',
            trigger: 'open_with',
            source: 'builder.puter.test',
        });
        expect(Object.fromEntries(url.searchParams)).toMatchObject({
            'utm_source': 'builder.puter.test',
            'utm_medium': 'referral',
            'utm_campaign': 'app_browser_embed',
            'utm_content': 'open_with',
        });
    });
});
