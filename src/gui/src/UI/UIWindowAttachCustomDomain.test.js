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

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import jQuery from '../lib/jquery-3.6.1/jquery-3.6.1.min.js';

const { default: UIWindowAttachCustomDomain } = await import('./UIWindowAttachCustomDomain.js');

const pendingDomain = (overrides = {}) => ({
    uuid: 'd1',
    hostname: 'www.example.com',
    site: 'mysite',
    status: 'pending',
    isApex: false,
    records: [{ type: 'CNAME', name: 'www.example.com', value: 'mysite.puter.site', purpose: 'routing', required: true }],
    ...overrides,
});

const json = (status, data) => new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
});

/** Answers the list call with `items`; anything else 200s with `{}`. */
const serve = (items) => vi.fn(async (url, opts = {}) => {
    const path = String(url).split('/custom-domains')[1];
    if ( (opts.method ?? 'GET') === 'GET' && ! path ) return json(200, { items });
    return json(200, {});
});

const flush = () => new Promise((r) => setTimeout(r, 0));
const $ = (sel) => jQuery(sel);
const visiblePane = () => $('.custom-domain-pane').filter((_, el) => el.style.display !== 'none').attr('data-pane');
const pressEscape = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

/** Opens the dialog and waits for the list to load. */
const open = async (items = [pendingDomain()]) => {
    globalThis.fetch = serve(items);
    let result = 'open';
    UIWindowAttachCustomDomain({ subdomain: 'mysite' }).then((r) => {
        result = r;
    });
    await flush();
    await flush();
    return { result: () => result };
};

beforeEach(() => {
    document.body.innerHTML = '';
    globalThis.$ = jQuery;
    globalThis.i18n = (key) => key;
    globalThis.html_encode = (value) => jQuery('<div>').text(value).html();
    globalThis.puter = { authToken: 'token' };
    window.api_origin = 'https://api.puter.test';
    window.hosting_domain = 'puter.site';
});

afterEach(() => {
    $(document).off('keydown');
    vi.useRealTimers();
});

describe('UIWindowAttachCustomDomain', () => {
    it('backs out of the records pane remove confirmation on Escape', async () => {
        const dialog = await open();
        $('.custom-domain-row .custom-domain-use').trigger('click');
        expect(visiblePane()).toBe('records');

        $('.custom-domain-remove-chosen').trigger('click');
        expect($('.custom-domain-remove-chosen').hasClass('custom-domain-confirming')).toBe(true);

        pressEscape();
        expect($('.custom-domain-remove-chosen').hasClass('custom-domain-confirming')).toBe(false);
        expect($('.custom-domain-remove-note').css('display')).toBe('none');
        expect(dialog.result()).toBe('open');

        pressEscape();
        await flush();
        expect(dialog.result()).toMatchObject({ uuid: 'd1' });
    });

    it('starts each step scrolled to the top of the floating modal', async () => {
        await open();
        // jsdom has no layout, so stand in for a modal scrolled down the list.
        const modal = document.querySelector('.custom-domain-modal');
        let scrollTop = 240;
        Object.defineProperty(modal, 'scrollTop', {
            configurable: true,
            get: () => scrollTop,
            set: (value) => {
                scrollTop = value;
            },
        });

        $('.custom-domain-row .custom-domain-use').trigger('click');
        expect(visiblePane()).toBe('records');
        expect(scrollTop).toBe(0);
    });
});
