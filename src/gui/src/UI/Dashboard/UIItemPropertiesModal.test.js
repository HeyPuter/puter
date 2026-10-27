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
import { afterEach, describe, expect, it, vi } from 'vitest';
import jQuery from '../../lib/jquery-3.6.1/jquery-3.6.1.min.js';

vi.mock('../UIAlert.js', () => ({ default: vi.fn() }));
vi.mock('../../helpers/itemIcon.js', () => ({ default: vi.fn(async () => ({ image: 'icon.svg' })) }));

globalThis.$ = jQuery;
globalThis.jQuery = jQuery;
globalThis.i18n = (key) => key;
globalThis.html_encode = (value) => String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
window.html_encode = globalThis.html_encode;
window.requestAnimationFrame = (fn) => setTimeout(fn, 0);

const { default: UIItemPropertiesModal } = await import('./UIItemPropertiesModal.js');

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

afterEach(() => {
    document.body.innerHTML = '';
    delete globalThis.puter;
});

describe('UIItemPropertiesModal', () => {
    it('leaves a folder whose website is disassociated publishable again', async () => {
        const fsentry = { uid: 'u1', name: 'site', path: '/alice/site', is_dir: true, has_website: true };
        const $row = $('<div class="item" data-uid="u1" data-has_website="1"><img class="item-has-website-badge"></div>')
            .data('fsentry', fsentry).appendTo('body');
        window.extractSubdomain = () => 'mysite';
        window.update_sites_cache = vi.fn();
        globalThis.puter = {
            fs: { stat: vi.fn(({ success }) => {
                success({ ...fsentry, id: 'u1', modified: 1700000000, created: 1700000000, subdomains: [{ uuid: 's1', address: 'https://mysite.puter.site' }] });
                return Promise.resolve();
            }) },
            hosting: { update: vi.fn(async () => ({})) },
            fsCacheKey: (kind, path) => `${kind}:${path}`,
            _cache: { del: vi.fn() },
        };

        UIItemPropertiesModal({ name: 'site', path: '/alice/site', uid: 'u1' });
        await tick();
        $('.item-props-disassociate').trigger('click');
        await tick();

        expect(puter.hosting.update).toHaveBeenCalledWith('mysite', null);
        expect($row.attr('data-has_website')).toBe('0');
        expect(fsentry.has_website).toBe(false);
        expect(window.update_sites_cache).toHaveBeenCalled();
        expect(puter._cache.del).toHaveBeenCalledWith('readdir:/alice');
    });
});
