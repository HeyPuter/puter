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
import { authLogoHeader, isUsableFavicon, openerFaviconUrl, wireAuthLogoHeader } from './authLogoHeader.js';

beforeAll(() => {
    // Same encoder the GUI installs globally (see lib/html-entities.js).
    globalThis.html_encode = str => encode(str);
});

const LOGO = '/images/logo-white.svg';

describe('openerFaviconUrl', () => {
    it('sends only the origin to the favicon service', () => {
        const url = new URL(openerFaviconUrl('https://app.example.com/secret/path?token=abc'));
        expect(url.origin + url.pathname).toBe('https://t3.gstatic.com/faviconV2');
        expect(url.searchParams.get('url')).toBe('https://app.example.com');
        expect(url.searchParams.get('size')).toBe('256');
        expect(url.searchParams.get('fallback_opts')).toBe('TYPE,SIZE,URL');
        expect(url.search).not.toContain('secret');
        expect(url.search).not.toContain('token');
    });

    it('is empty for a non-URL', () => {
        expect(openerFaviconUrl('not a url')).toBe('');
        expect(openerFaviconUrl('')).toBe('');
    });
});

describe('authLogoHeader', () => {
    it('renders only the Puter logo outside a popup', () => {
        const h = authLogoHeader({ logoSrc: LOGO });
        expect(h).toContain('class="auth-logo"');
        expect(h).not.toContain('auth-opener-logo');
        expect(h).not.toContain('auth-logo-connector');
        expect(h).not.toContain('cursor: pointer');
    });

    it('adds the pointer cursor when the logo is clickable', () => {
        expect(authLogoHeader({ logoSrc: LOGO, logoClickable: true })).toContain('cursor: pointer');
    });

    it('pairs the opener favicon with the Puter logo through a connector', () => {
        const h = authLogoHeader({ logoSrc: LOGO, openerOrigin: 'https://example.com' });
        const opener = h.indexOf('auth-opener-logo');
        const connector = h.indexOf('auth-logo-connector');
        const puter = h.indexOf('class="auth-logo"');
        expect(opener).toBeGreaterThan(-1);
        expect(connector).toBeGreaterThan(opener);
        expect(puter).toBeGreaterThan(connector);
        expect(h).toContain('url=https%3A%2F%2Fexample.com');
        expect(h).toContain('auth-logo-header-connected');
    });

    it('puts the generic website icon under the favicon as a fallback', () => {
        const h = authLogoHeader({ logoSrc: LOGO, openerOrigin: 'https://example.com', openerFallbackSrc: '/icons/world.svg' });
        const fallback = h.indexOf('class="auth-opener-logo-fallback"');
        const favicon = h.indexOf('class="auth-opener-logo-img"');
        expect(h).toContain('src="/icons/world.svg"');
        expect(fallback).toBeGreaterThan(-1);
        expect(favicon).toBeGreaterThan(fallback);
        expect(h).toContain('title="example.com"');
    });

    it('encodes an opener origin carrying markup', () => {
        const h = authLogoHeader({ logoSrc: LOGO, openerOrigin: 'https://a.com/"><img src=x onerror=alert(1)>' });
        expect(h).not.toContain('<img src=x');
        expect(h).toContain('url=https%3A%2F%2Fa.com');
    });
});

describe('isUsableFavicon', () => {
    it('rejects the 16px placeholder and accepts a real icon', () => {
        expect(isUsableFavicon({ naturalWidth: 16, naturalHeight: 16 })).toBe(false);
        expect(isUsableFavicon({ naturalWidth: 0, naturalHeight: 0 })).toBe(false);
        expect(isUsableFavicon({ naturalWidth: 32, naturalHeight: 32 })).toBe(true);
        expect(isUsableFavicon({ naturalWidth: 180, naturalHeight: 180 })).toBe(true);
    });
});

describe('wireAuthLogoHeader', () => {
    const fakeImg = (size = 0) => {
        const handlers = {};
        return {
            complete: false,
            naturalWidth: size,
            naturalHeight: size,
            removed: false,
            addEventListener(type, handler) { handlers[type] = handler; },
            remove() { this.removed = true; },
            fire(type) { handlers[type](); },
        };
    };

    it('removes the favicon once it fails to load', () => {
        const img = fakeImg();
        wireAuthLogoHeader({ querySelectorAll: () => [img] });
        expect(img.removed).toBe(false);
        img.fire('error');
        expect(img.removed).toBe(true);
    });

    it('removes a placeholder-sized favicon after it loads', () => {
        const img = fakeImg();
        wireAuthLogoHeader({ querySelectorAll: () => [img] });
        img.naturalWidth = img.naturalHeight = 16;
        img.fire('load');
        expect(img.removed).toBe(true);
    });

    it('keeps a real favicon', () => {
        const img = fakeImg();
        wireAuthLogoHeader({ querySelectorAll: () => [img] });
        img.naturalWidth = img.naturalHeight = 180;
        img.fire('load');
        expect(img.removed).toBe(false);
    });

    it('handles a cached placeholder that finished before wiring', () => {
        const img = fakeImg(16);
        img.complete = true;
        wireAuthLogoHeader({ querySelectorAll: () => [img] });
        expect(img.removed).toBe(true);
    });
});
