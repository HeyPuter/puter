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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import jQuery from '../lib/jquery-3.6.1/jquery-3.6.1.min.js';

vi.mock('./UIWindow.js', () => ({
    default: vi.fn(async ({ body_content }) => {
        const el = document.createElement('div');
        el.className = 'window';
        el.innerHTML = body_content;
        document.body.append(el);
        return el;
    }),
}));
// Every confirmation is answered yes.
vi.mock('./UIAlert.js', () => ({ default: vi.fn(async () => true) }));
vi.mock('../helpers/shareTeams.js', () => ({
    teams_for_sharing: vi.fn(async () => []),
    team_for_share: () => null,
    team_label: (team) => team.name,
}));
vi.mock('../helpers/shareRecipientPicker.js', () => ({
    default: () => ({ destroy () {}, recipient: () => null, setTeams () {}, clear () {}, remember () {} }),
}));

globalThis.$ = jQuery;
globalThis.jQuery = jQuery;
globalThis.i18n = (key) => key;
globalThis.html_encode = (value) => jQuery('<div>').text(value ?? '').html();
globalThis.def = globalThis.def ?? ((value) => value);
globalThis.use = globalThis.use ?? (() => class {});
window.icons = {};

const { default: UIWindowShare } = await import('./UIWindowShare.js');
const { unshareAnswering, allRefused, goneRefused } =
    await import('../../tests/fixtures/sdkUnshare.js');

const settle = async () => {
    for ( let i = 0; i < 5; i++ ) await new Promise((resolve) => setTimeout(resolve, 0));
};

const open = async (shares, unshare) => {
    window.user = { username: 'alice' };
    globalThis.puter = {
        fs: {
            getShares: vi.fn(async () => shares),
            stat: vi.fn(async () => ({ uid: 'u' })),
            unshare,
        },
    };
    await UIWindowShare({ path: '/alice/a.txt' });
    await settle();
};

afterEach(() => {
    document.body.innerHTML = '';
});

describe.each([
    ['is refused', allRefused, 'Held through a team'],
    ['resolves with the pair refused', goneRefused, 'Subject does not exist'],
])('UIWindowShare when the unshare %s', (_, answer, message) => {
    let unshare;
    beforeEach(() => {
        unshare = vi.fn(unshareAnswering(answer));
    });

    it('shows the error instead of confirming the removal', async () => {
        await open([{ holder: 'bob', mode: 'read', issuer: 'alice' }], unshare);

        $('.share-revoke').trigger('click');
        await settle();
        expect(unshare).toHaveBeenCalledWith('/alice/a.txt', 'bob');
        expect($('.form-error-msg').text()).toBe(message);
        expect($('.form-success-msg').text()).toBe('');
        expect($('.share-revoke').prop('disabled')).toBe(false);
    });

    it('shows the error instead of saying the link was closed', async () => {
        await open([{ holder: null, anyone: true, mode: 'read', issuer: 'alice' }], unshare);

        $('.share-link-access').val('restricted').trigger('change');
        await settle();
        expect(unshare).toHaveBeenCalledWith('/alice/a.txt', { anyone: true });
        expect($('.form-error-msg').text()).toBe(message);
        expect($('.form-success-msg').text()).toBe('');
    });

    it('keeps that error when the listing after it fails', async () => {
        await open([{ holder: null, anyone: true, mode: 'read', issuer: 'alice' }], unshare);
        puter.fs.getShares = vi.fn(async () => {
            throw { message: 'Could not list' };
        });

        $('.share-link-access').val('restricted').trigger('change');
        await settle();
        expect($('.form-error-msg').text()).toBe(message);
    });
});
