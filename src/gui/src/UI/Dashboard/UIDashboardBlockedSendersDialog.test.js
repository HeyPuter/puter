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
import { beforeEach, describe, expect, it, vi } from 'vitest';
import jQuery from '../../lib/jquery-3.6.1/jquery-3.6.1.min.js';

globalThis.$ = jQuery;
globalThis.jQuery = jQuery;
globalThis.i18n = (key, values = []) => [key, ...Object.values(values)].join(' ');
globalThis.html_encode = (value) => String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
window.html_encode = globalThis.html_encode;
window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
window.matchMedia = () => ({ matches: false });
globalThis.puter = { authToken: 'tok-1' };

const { default: UIDashboardBlockedSendersDialog } = await import('./UIDashboardBlockedSendersDialog.js');

const settle = async () => {
    for ( let i = 0; i < 10; i++ ) await new Promise(resolve => setTimeout(resolve, 0));
};
const status = () => $('.dashboard-form-status').text();
const blocked = () => $('.dashboard-blocked-who').map((_, el) => el.textContent).get();
const allSwitch = () => $('.dashboard-form-input[name="all"]');

/** The server's block list; the fetch stub reads and edits it. */
let server;
/** Set to make the next write fail with this message. */
let failWith;

const open = async (opts) => {
    const dialog = UIDashboardBlockedSendersDialog(opts);
    await settle();
    return dialog;
};

beforeEach(() => {
    document.body.innerHTML = '';
    window.api_origin = 'https://api.puter.test';
    server = { all: false, items: [{ username: 'mallory' }] };
    failWith = null;
    globalThis.fetch = vi.fn(async (url, { method, body }) => {
        const payload = body ? JSON.parse(body) : {};
        if ( method !== 'GET' && failWith ) {
            return new Response(JSON.stringify({ message: failWith }), { status: 400 });
        }
        if ( method === 'POST' && payload.all ) server.all = true;
        if ( method === 'DELETE' && payload.all ) server.all = false;
        if ( method === 'POST' && payload.username ) server.items.push({ username: payload.username });
        if ( method === 'DELETE' && payload.username ) {
            server.items = server.items.filter(item => item.username !== payload.username);
        }
        return new Response(JSON.stringify(server), { status: 200 });
    });
});

describe('Blocked people dialog', () => {
    it('opens as a dashboard dialog card, not a window, listing who is blocked', async () => {
        const $container = $('<div class="host"></div>').appendTo('body');
        await open({ $container });
        expect($('.host > .dashboard-dialog-overlay .dashboard-blocked-dialog').length).toBe(1);
        expect($('.window').length).toBe(0);
        expect(fetch).toHaveBeenCalledWith('https://api.puter.test/share/blocks', expect.objectContaining({
            method: 'GET',
            headers: expect.objectContaining({ Authorization: 'Bearer tok-1' }),
        }));
        expect(blocked()).toEqual(['mallory']);
        expect(allSwitch().prop('checked')).toBe(false);
        expect($('.dashboard-blocked-list').attr('aria-busy')).toBe('false');
    });

    it('says so when nobody is blocked', async () => {
        server.items = [];
        await open();
        expect($('.dashboard-blocked-empty').text()).toBe('blocked_none');
    });

    it('says so, and stops reporting the list as loading, when it cannot be loaded', async () => {
        fetch.mockImplementationOnce(async () => new Response(JSON.stringify({ message: 'Try again later' }), { status: 500 }));
        await open();
        expect(status()).toBe('Try again later');
        expect($('.dashboard-blocked-list').attr('aria-busy')).toBe('false');
    });

    it('blocks the typed username and lists it', async () => {
        await open();
        $('.dashboard-blocked-username').val('  eve  ');
        $('.dashboard-blocked-add').trigger('submit');
        await settle();
        expect(blocked()).toEqual(['mallory', 'eve']);
        expect($('.dashboard-blocked-username').val()).toBe('');
        expect(status()).toBe('blocked_added eve');
        expect($('.dashboard-form-status').hasClass('dashboard-form-status-info')).toBe(true);
    });

    it('sends nothing for an empty username', async () => {
        await open();
        fetch.mockClear();
        $('.dashboard-blocked-add').trigger('submit');
        await settle();
        expect(fetch).not.toHaveBeenCalled();
    });

    it('shows the server\'s reason when a block is refused, keeping what was typed', async () => {
        await open();
        failWith = 'No such user';
        $('.dashboard-blocked-username').val('nobody');
        $('.dashboard-blocked-add').trigger('submit');
        await settle();
        expect(status()).toBe('No such user');
        expect($('.dashboard-form-status').hasClass('dashboard-form-status-error')).toBe(true);
        expect($('.dashboard-blocked-username').val()).toBe('nobody');
        expect($('.dashboard-blocked-add-btn').prop('disabled')).toBe(false);
    });

    it('unblocks a person and keeps focus inside the card', async () => {
        await open();
        const $unblock = $('.dashboard-blocked-unblock');
        $unblock.get(0).focus();
        $unblock.trigger('click');
        await settle();
        expect(blocked()).toEqual([]);
        expect(status()).toBe('blocked_removed mallory');
        expect(document.activeElement).toBe($('.dashboard-blocked-dialog').get(0));
    });

    it('takes an unblocked person off the list even when the list cannot be reloaded', async () => {
        server.items.push({ username: 'eve' });
        await open();
        const respond = fetch.getMockImplementation();
        fetch.mockImplementation(async (url, opts) => (opts.method === 'GET'
            ? new Response('{}', { status: 500 })
            : respond(url, opts)));
        const $unblock = $('.dashboard-blocked-unblock[data-username="mallory"]');
        $unblock.get(0).focus();
        $unblock.trigger('click');
        await settle();
        expect(server.items).toEqual([{ username: 'eve' }]);
        expect(blocked()).toEqual(['eve']);
        expect($('.dashboard-blocked-unblock').prop('disabled')).toBe(false);
        expect(document.activeElement).toBe($('.dashboard-blocked-dialog').get(0));

        $('.dashboard-blocked-unblock').trigger('click');
        await settle();
        expect($('.dashboard-blocked-empty').length).toBe(1);
    });

    it('gives the Unblock button back when unblocking is refused', async () => {
        await open();
        failWith = 'Try again later';
        $('.dashboard-blocked-unblock').trigger('click');
        await settle();
        expect(blocked()).toEqual(['mallory']);
        expect(status()).toBe('Try again later');
        expect($('.dashboard-blocked-unblock').prop('disabled')).toBe(false);
    });

    it('refuses everyone with the switch, and accepts again when switched off', async () => {
        await open();
        allSwitch().prop('checked', true).trigger('change');
        await settle();
        expect(server.all).toBe(true);
        expect(status()).toBe('blocked_all_on');

        allSwitch().prop('checked', false).trigger('change');
        await settle();
        expect(server.all).toBe(false);
        expect(status()).toBe('blocked_all_off');
        expect(allSwitch().prop('disabled')).toBe(false);
    });

    it('gives focus back to the control that was used once it is usable again', async () => {
        await open();
        // jsdom keeps focus on a control that gets disabled; a browser drops it.
        const dropFocus = () => {
            $('.dashboard-blocked-dialog').get(0).focus();
            document.activeElement.blur();
        };

        allSwitch().get(0).focus();
        allSwitch().prop('checked', true).trigger('change');
        dropFocus();
        await settle();
        expect(document.activeElement).toBe(allSwitch().get(0));

        $('.dashboard-blocked-username').val('eve');
        $('.dashboard-blocked-add-btn').get(0).focus();
        $('.dashboard-blocked-add').trigger('submit');
        dropFocus();
        await settle();
        expect(document.activeElement).toBe($('.dashboard-blocked-add-btn').get(0));

        failWith = 'Try again later';
        const $unblock = $('.dashboard-blocked-unblock').first();
        $unblock.get(0).focus();
        $unblock.trigger('click');
        dropFocus();
        await settle();
        expect(document.activeElement).toBe($unblock.get(0));
    });

    it('puts the switch back when the change fails', async () => {
        await open();
        failWith = 'Try again later';
        allSwitch().prop('checked', true).trigger('change');
        await settle();
        expect(allSwitch().prop('checked')).toBe(false);
        expect(status()).toBe('Try again later');
    });

    it('keeps the switch as it was set when the list requested before it arrives after', async () => {
        const list = Promise.withResolvers();
        fetch.mockImplementationOnce(async () => {
            const stale = JSON.stringify(server);
            await list.promise;
            return new Response(stale, { status: 200 });
        });
        UIDashboardBlockedSendersDialog();
        allSwitch().prop('checked', true).trigger('change');
        await settle();
        expect(server.all).toBe(true);

        list.resolve();
        await settle();
        expect(allSwitch().prop('checked')).toBe(true);
        expect(blocked()).toEqual(['mallory']);
    });

    it('ignores a list that arrives after a newer one', async () => {
        server.items.push({ username: 'eve' });
        await open();
        // The list read after the first unblock is answered last.
        const first_list = Promise.withResolvers();
        const respond = fetch.getMockImplementation();
        let lists = 0;
        fetch.mockImplementation(async (url, opts) => {
            if ( opts.method !== 'GET' || ++lists > 1 ) return respond(url, opts);
            const stale = JSON.stringify(server);
            await first_list.promise;
            return new Response(stale, { status: 200 });
        });
        $('.dashboard-blocked-unblock[data-username="mallory"]').trigger('click');
        await settle();
        $('.dashboard-blocked-unblock[data-username="eve"]').trigger('click');
        await settle();
        expect(blocked()).toEqual([]);

        first_list.resolve();
        await settle();
        expect(blocked()).toEqual([]);
    });

    it('closes on Done and hands focus back to the opener', async () => {
        const opener = $('<button type="button">Manage</button>').appendTo('body').get(0);
        await open({ returnFocusTo: opener });
        $('.dashboard-blocked-done').trigger('click');
        expect($('.dashboard-dialog-overlay').hasClass('dashboard-dialog-show')).toBe(false);
        expect(document.activeElement).toBe(opener);
    });
});
