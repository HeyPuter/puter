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
import jQuery from '../../lib/jquery-3.6.1/jquery-3.6.1.min.js';

vi.mock('./ContextMenu/ContextMenu.js', () => ({ isTouchPrimaryDevice: () => false }));
vi.mock('../../helpers/itemIcon.js', () => ({ default: vi.fn(async () => ({ image: 'icon.svg' })) }));
vi.mock('../../helpers/shareTeams.js', () => ({ teams_for_sharing: vi.fn(async () => []) }));
// The field's choice, and the dialog's hook into it, for tests to drive.
const picked = { recipient: null, onChange: null };
vi.mock('../../helpers/shareRecipientPicker.js', () => ({
    default: ({ onChange }) => {
        picked.onChange = onChange;
        return { destroy () {}, recipient: () => picked.recipient, setTeams () {}, clear () {}, remember () {} };
    },
}));

globalThis.$ = jQuery;
globalThis.jQuery = jQuery;
globalThis.i18n = (key, args) => (args && ! Array.isArray(args) ? `${key}:${JSON.stringify(args)}` : key);
globalThis.html_encode = (value) => String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
window.html_encode = globalThis.html_encode;
window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
globalThis.def = globalThis.def ?? (value => value);
globalThis.use = globalThis.use ?? (() => class {});

const { default: UIShareModal } = await import('./UIShareModal.js');

const settle = async () => {
    for ( let i = 0; i < 5; i++ ) await new Promise(resolve => setTimeout(resolve, 0));
};

beforeEach(() => {
    picked.recipient = null;
    window.user = { username: 'alice' };
    globalThis.puter = {
        fs: {
            getShares: vi.fn(async () => []),
            share: vi.fn(async ({ paths }) => paths.map(p => ({ path: p }))),
            unshare: vi.fn(async () => ({})),
            stat: vi.fn(async () => ({ uid: 'u' })),
        },
    };
});

afterEach(() => {
    document.body.innerHTML = '';
});

describe('UIShareModal general access', () => {
    const items = (count) => Array.from({ length: count }, (_, i) => ({ path: `/alice/f${i}.txt` }));

    it("doesn't call a selection too large to list restricted, and lets either choice apply", async () => {
        UIShareModal({ items: items(51) });
        await settle();

        expect($('.share-modal-link-access')[0].value).toBe('unchecked');
        expect($('.share-modal-general-note').html()).toBe(i18n('share_link_unchecked_note', { total: 51 }));
        expect(puter.fs.getShares).not.toHaveBeenCalled();

        $('.share-modal-link-access').val('restricted').trigger('change');
        await settle();
        expect(puter.fs.unshare).toHaveBeenCalledTimes(2);
        expect($('.share-modal-link-access').val()).toBe('restricted');
    });

    it('shows a listed selection as the listings say', async () => {
        UIShareModal({ items: items(2) });
        await settle();
        expect($('.share-modal-link-access').val()).toBe('restricted');
        expect(puter.fs.getShares).toHaveBeenCalledTimes(2);
    });
});

describe('UIShareModal extending a grant', () => {
    const bob = (mode) => ({ holder: 'bob', mode, issuer: 'alice' });

    it('offers it on the items listed, not on one whose listing failed', async () => {
        puter.fs.getShares = vi.fn(async (target) => {
            if ( target === '/alice/b.txt' ) throw new Error('Network hiccup');
            return [bob('read')];
        });
        UIShareModal({ items: [{ path: '/alice/a.txt' }, { path: '/alice/b.txt' }] });
        await settle();
        expect($('.share-modal-row-mode').length).toBe(1);
        expect($('.share-modal-row-link').length).toBe(0);
    });

    it('offers it on the items bob is missing', async () => {
        puter.fs.getShares = vi.fn(async (target) => (target === '/alice/a.txt' ? [bob('read')] : []));
        UIShareModal({ items: [{ path: '/alice/a.txt' }, { path: '/alice/b.txt' }] });
        await settle();
        $('.share-modal-row-link').trigger('click');
        await settle();
        expect(puter.fs.share).toHaveBeenCalledWith({ paths: ['/alice/b.txt'], recipient: 'bob', mode: 'read' });
    });
});

describe('UIShareModal removing access', () => {
    it("doesn't look cancelled by an Escape while the removal is under way", async () => {
        puter.fs.getShares = vi.fn(async () => [{ holder: 'bob', mode: 'read', issuer: 'alice' }]);
        let finish;
        puter.fs.unshare = vi.fn(() => new Promise((resolve) => {
            finish = resolve;
        }));
        UIShareModal({ path: '/alice/a.txt' });
        await settle();

        $('.share-modal-row-mode').val('__remove').trigger('change');
        $('.share-modal-confirm-remove').trigger('click');
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

        expect($('.share-modal-row-confirm').length).toBe(1);
        expect($('.share-modal-overlay').length).toBe(1);
        finish();
        await settle();
    });

    it('asks before removing, and removes nothing until confirmed', async () => {
        puter.fs.getShares = vi.fn(async () => [{ holder: 'bob', mode: 'read', issuer: 'alice' }]);
        UIShareModal({ path: '/alice/a.txt' });
        await settle();

        $('.share-modal-row-mode').val('__remove').trigger('change');
        expect(puter.fs.share).not.toHaveBeenCalled();
        expect(puter.fs.unshare).not.toHaveBeenCalled();
        expect($('.share-modal-row-confirm').length).toBe(1);

        $('.share-modal-confirm-cancel').trigger('click');
        expect($('.share-modal-row-confirm').length).toBe(0);
        expect($('.share-modal-row-mode').val()).toBe('read');

        $('.share-modal-row-mode').val('__remove').trigger('change');
        $('.share-modal-confirm-remove').trigger('click');
        await settle();
        expect(puter.fs.unshare).toHaveBeenCalledWith({ paths: ['/alice/a.txt'], recipient: 'bob' });
    });

    it('offers cancelling an invitation from its menu', async () => {
        puter.fs.getShares = vi.fn(async () => [
            { holder: null, recipientEmail: 'carol@example.com', pending: true, mode: 'write', issuer: 'alice' },
        ]);
        UIShareModal({ path: '/alice/a.txt' });
        await settle();

        const $menu = $('.share-modal-row-mode');
        expect($menu.length).toBe(1);
        expect($menu.find('option[value="__remove"]').text()).toBe(i18n('share_cancel_invite'));
    });
});

describe('UIShareModal footer', () => {
    it('offers the link for one item even while it is restricted', async () => {
        UIShareModal({ path: '/alice/a.txt' });
        await settle();
        expect($('.share-modal-copy-link').prop('hidden')).toBe(false);
        expect($('.share-modal-link-access').val()).toBe('restricted');
    });

    it('has no link to copy for several items', async () => {
        UIShareModal({ items: [{ path: '/alice/a.txt' }, { path: '/alice/b.txt' }] });
        await settle();
        expect($('.share-modal-copy-link').length).toBe(0);
    });

    it('closes on Done', async () => {
        UIShareModal({ path: '/alice/a.txt' });
        await settle();
        $('.share-modal-done').trigger('click');
        expect($('.share-modal-overlay').hasClass('share-modal-show')).toBe(false);
    });
});

describe('UIShareModal adding people', () => {
    it('shows the level and Share only once someone is entered', async () => {
        UIShareModal({ path: '/alice/a.txt' });
        await settle();
        expect($('.share-modal-add-actions').prop('hidden')).toBe(true);

        picked.recipient = { value: 'bob', label: 'bob' };
        picked.onChange();
        expect($('.share-modal-add-actions').prop('hidden')).toBe(false);

        picked.recipient = null;
        picked.onChange();
        expect($('.share-modal-add-actions').prop('hidden')).toBe(true);
    });

    it('keeps Share down while a share is on its way, though the name is edited', async () => {
        let finish;
        puter.fs.share = vi.fn(() => new Promise((resolve) => {
            finish = resolve;
        }));
        UIShareModal({ path: '/alice/a.txt' });
        await settle();
        picked.recipient = { value: 'bob', label: 'bob' };
        picked.onChange();
        expect($('.share-modal-submit').prop('disabled')).toBe(false);

        $('.share-modal-add').trigger('submit');
        picked.recipient = { value: 'bobby', label: 'bobby' };
        picked.onChange();
        expect($('.share-modal-submit').prop('disabled')).toBe(true);
        $('.share-modal-add').trigger('submit');
        expect(puter.fs.share).toHaveBeenCalledTimes(1);

        finish([{ path: '/alice/a.txt' }]);
        await settle();
        expect($('.share-modal-submit').prop('disabled')).toBe(false);
    });
});
