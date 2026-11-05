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

    describe('keyboard focus', () => {
        const otherSite = (uuid, hostname) => pendingDomain({ uuid, hostname, site: 'other' });

        it('moves into the dialog when the focused control\'s step is hidden', async () => {
            await open();
            const use = document.querySelector('.custom-domain-use');
            use.focus();
            $(use).trigger('click');
            expect(visiblePane()).toBe('records');
            expect(document.activeElement).toBe(document.querySelector('.custom-domain-modal'));
        });

        it('returns to the button that asked when a row confirmation is backed out', async () => {
            await open([otherSite('a', 'a.example.com')]);
            const $row = $('.custom-domain-row');
            $row.find('.custom-domain-use').trigger('click');
            expect(document.activeElement).toBe($row.find('.custom-domain-confirm-go').get(0));
            pressEscape();
            expect(document.activeElement).toBe($row.find('.custom-domain-use').get(0));

            $row.find('.custom-domain-remove').trigger('click');
            $row.find('.custom-domain-confirm-cancel').trigger('click');
            expect(document.activeElement).toBe($row.find('.custom-domain-remove').get(0));
        });

        it('comes back to the clicked button once a request finishes', async () => {
            await open();
            $('.custom-domain-row .custom-domain-use').trigger('click');
            const check = document.querySelector('.custom-domain-check');
            check.focus();
            // A browser drops focus to the page once the focused control is
            // disabled; jsdom doesn't, so drop it by hand.
            globalThis.fetch = vi.fn(async () => {
                const elsewhere = document.createElement('input');
                document.body.append(elsewhere);
                elsewhere.focus();
                elsewhere.remove();
                return json(200, pendingDomain());
            });
            $(check).trigger('click');
            await flush();
            await flush();
            expect(check.disabled).toBe(false);
            expect(document.activeElement).toBe(check);
        });

        it('moves to the next row when a row is removed', async () => {
            await open([otherSite('a', 'a.example.com'), otherSite('b', 'b.example.com')]);
            const [rowA, rowB] = $('.custom-domain-row').toArray();
            $(rowA).find('.custom-domain-remove').trigger('click');
            $(rowA).find('.custom-domain-confirm-go').trigger('click');
            await flush();
            await flush();
            expect(document.activeElement).toBe($(rowB).find('.custom-domain-remove').get(0));
        });
    });

    describe('copy buttons', () => {
        afterEach(() => {
            delete navigator.clipboard;
            delete document.execCommand;
        });

        const copyCnameValue = async () => {
            await open();
            $('.custom-domain-row .custom-domain-use').trigger('click');
            const $btn = $('[data-pane="records"] .custom-domain-copy').eq(1);
            $btn.trigger('click');
            await flush();
            return $btn;
        };

        it('copy with the clipboard API', async () => {
            const writeText = vi.fn(async () => {});
            Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
            const $btn = await copyCnameValue();
            expect(writeText).toHaveBeenCalledWith('mysite.puter.site');
            expect($btn.hasClass('is-copied')).toBe(true);
        });

        it('fall back to selecting and copying when there is no clipboard API', async () => {
            document.execCommand = vi.fn(() => true);
            const $btn = await copyCnameValue();
            expect(document.execCommand).toHaveBeenCalledWith('copy');
            expect(window.getSelection().toString()).toBe('mysite.puter.site');
            expect($btn.hasClass('is-copied')).toBe(true);
        });

        it('leave the value selected when nothing can copy it', async () => {
            const $btn = await copyCnameValue();
            expect(window.getSelection().toString()).toBe('mysite.puter.site');
            expect($btn.hasClass('is-copied')).toBe(false);
        });
    });

    describe('empty state', () => {
        const shown = (sel) => $(sel).get(0).style.display !== 'none';

        it('puts the add button in the empty state instead of the footer', async () => {
            await open([]);
            expect(shown('.custom-domain-empty')).toBe(true);
            expect(shown('.custom-domain-list-add')).toBe(false);

            $('.custom-domain-empty-add').trigger('click');
            expect(visiblePane()).toBe('add');
        });

        it('keeps the add button in the footer while there are domains', async () => {
            await open();
            expect(shown('.custom-domain-empty')).toBe(false);
            expect(shown('.custom-domain-list-add')).toBe(true);
        });

        it('moves the button and focus to the empty state when the last domain is removed', async () => {
            vi.useFakeTimers({ toFake: ['setTimeout'] });
            const ready = open([pendingDomain({ site: 'other' })]);
            await vi.runAllTimersAsync();
            await ready;
            const row = document.querySelector('.custom-domain-row');
            $(row).find('.custom-domain-remove').trigger('click');
            $(row).find('.custom-domain-confirm-go').trigger('click');
            await vi.runAllTimersAsync();

            expect(row.isConnected).toBe(false);
            expect(shown('.custom-domain-empty')).toBe(true);
            expect(shown('.custom-domain-list-add')).toBe(false);
            expect(document.activeElement).toBe($('.custom-domain-empty-add').get(0));
        });
    });

    it('takes no more input on a removed row while it fades out', async () => {
        await open([pendingDomain({ site: 'other' })]);
        const row = document.querySelector('.custom-domain-row');
        $(row).find('.custom-domain-remove').trigger('click');
        $(row).find('.custom-domain-confirm-go').trigger('click');
        await flush();
        await flush();
        expect(row.isConnected).toBe(true);
        expect(row.hasAttribute('inert')).toBe(true);
    });
});
