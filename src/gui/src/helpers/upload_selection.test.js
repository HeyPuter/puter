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

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import jQuery from '../lib/jquery-3.6.1/jquery-3.6.1.min.js';
import { select_uploaded_items, select_added_item_if_pending } from './upload_selection.js';

const make_item = ({ path, uid = `uid-${path}`, disabled = false }) => {
    const el = document.createElement('div');
    el.className = `item${disabled ? ' item-disabled' : ''}`;
    el.setAttribute('data-path', path);
    el.setAttribute('data-uid', uid);
    el.setAttribute('data-is_dir', '0');
    return el;
};

const make_container = (dir_path) => {
    const el = document.createElement('div');
    el.className = 'item-container';
    el.setAttribute('data-path', dir_path);
    document.body.appendChild(el);
    return el;
};

beforeAll(() => {
    globalThis.$ = jQuery;
    // jsdom doesn't implement scrollIntoView
    Element.prototype.scrollIntoView = () => {};
});

beforeEach(() => {
    document.body.innerHTML = '';
    window.update_explorer_footer_selected_items_count = vi.fn();
});

afterEach(() => {
    vi.useRealTimers();
});

const selected_paths = (container) =>
    [...container.querySelectorAll('.item-selected')].map(el => el.getAttribute('data-path'));

describe('select_uploaded_items', () => {
    it('replaces the selection with the uploaded items already in the container', () => {
        const container = make_container('/user/Desktop');
        const old = make_item({ path: '/user/Desktop/old.txt' });
        old.classList.add('item-selected');
        container.append(
            old,
            make_item({ path: '/user/Desktop/a.txt' }),
            make_item({ path: '/user/Desktop/b.txt' }),
            make_item({ path: '/user/Desktop/unrelated.txt' }),
        );

        select_uploaded_items('/user/Desktop', ['/user/Desktop/a.txt', '/user/Desktop/b.txt']);

        expect(selected_paths(container)).toEqual(['/user/Desktop/a.txt', '/user/Desktop/b.txt']);
    });

    it('matches paths case-insensitively and only in containers showing the destination', () => {
        const container = make_container('/User/Desktop');
        const other = make_container('/user/Documents');
        container.append(make_item({ path: '/User/Desktop/A.TXT' }));
        other.append(make_item({ path: '/user/Documents/a.txt' }));

        select_uploaded_items('/user/desktop', ['/user/desktop/a.txt']);

        expect(selected_paths(container)).toEqual(['/User/Desktop/A.TXT']);
        expect(selected_paths(other)).toEqual([]);
    });

    it('never selects disabled items (e.g. filtered out by a dialog file-type filter)', () => {
        const container = make_container('/user/Desktop');
        container.append(make_item({ path: '/user/Desktop/a.txt', disabled: true }));

        select_uploaded_items('/user/Desktop', ['/user/Desktop/a.txt']);

        expect(selected_paths(container)).toEqual([]);
    });

    it('enables the Open button of an open-file dialog when a file lands selected', () => {
        const el_window = document.createElement('div');
        el_window.className = 'window';
        el_window.setAttribute('data-is_openFileDialog', 'true');
        el_window.innerHTML = '<button class="openfiledialog-open-btn disabled"></button>';
        document.body.appendChild(el_window);
        const container = make_container('/user/Desktop');
        el_window.appendChild(container);
        container.append(make_item({ path: '/user/Desktop/a.txt' }));

        select_uploaded_items('/user/Desktop', ['/user/Desktop/a.txt']);

        expect(el_window.querySelector('.openfiledialog-open-btn').classList.contains('disabled')).toBe(false);
        expect(window.update_explorer_footer_selected_items_count).toHaveBeenCalled();
    });
});

describe('select_added_item_if_pending', () => {
    it('selects an item whose element is created after the upload finished, exactly once', () => {
        const container = make_container('/user/Desktop');
        select_uploaded_items('/user/Desktop', ['/user/Desktop/late.txt']);

        const late = make_item({ path: '/user/Desktop/late.txt', uid: 'late-uid' });
        container.append(late);
        select_added_item_if_pending({ path: '/user/Desktop/late.txt', uid: 'late-uid' }, $(container));
        expect(selected_paths(container)).toEqual(['/user/Desktop/late.txt']);

        // the entry is consumed — a later item.added for the same path stays unselected
        late.classList.remove('item-selected');
        select_added_item_if_pending({ path: '/user/Desktop/late.txt', uid: 'late-uid' }, $(container));
        expect(selected_paths(container)).toEqual([]);
    });

    it('adds to the selection made when the upload finished instead of replacing it', () => {
        const container = make_container('/user/Desktop');
        container.append(make_item({ path: '/user/Desktop/a.txt' }));
        select_uploaded_items('/user/Desktop', ['/user/Desktop/a.txt', '/user/Desktop/late.txt']);

        container.append(make_item({ path: '/user/Desktop/late.txt', uid: 'late-uid' }));
        select_added_item_if_pending({ path: '/user/Desktop/late.txt', uid: 'late-uid' }, $(container));

        expect(selected_paths(container)).toEqual(['/user/Desktop/a.txt', '/user/Desktop/late.txt']);
    });

    it('forgets a pending path once its TTL passes', () => {
        vi.useFakeTimers();
        const container = make_container('/user/Desktop');
        select_uploaded_items('/user/Desktop', ['/user/Desktop/late.txt']);

        vi.advanceTimersByTime(11_000);

        container.append(make_item({ path: '/user/Desktop/late.txt', uid: 'late-uid' }));
        select_added_item_if_pending({ path: '/user/Desktop/late.txt', uid: 'late-uid' }, $(container));
        expect(selected_paths(container)).toEqual([]);
    });
});
