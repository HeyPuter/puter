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

// The tab's window and dialog plumbing isn't what these tests exercise.
vi.mock('../UIWindow.js', () => ({ default: vi.fn() }));
vi.mock('../UIAlert.js', () => ({ default: vi.fn() }));
vi.mock('../UIWindowProgress.js', () => ({ default: vi.fn() }));
vi.mock('../UIContextMenu.js', () => ({ default: vi.fn() }));

globalThis.$ = jQuery;
globalThis.jQuery = jQuery;
globalThis.def = globalThis.def ?? (value => value);
globalThis.use = globalThis.use ?? (() => class {});
globalThis.html_encode = value => jQuery('<div>').text(value).html();
globalThis.i18n = globalThis.i18n ?? (key => key);
window.icons = {};

const { default: TabFiles } = await import('./TabFiles.js');

const TRASH = '/alice/Trash';

/** A Files tab listing `rows` in `currentPath`, with its footer. */
const mountListing = (rows, currentPath = TRASH) => {
    document.body.innerHTML = `
        <div class="window">
            <div class="files-tab">
                <div class="files">${rows.map(name => `<div class="row item" data-path="${currentPath}/${name}" data-size="10"></div>`).join('')}</div>
                <div class="files-footer">
                    <span class="files-footer-item-count"></span>
                    <span class="files-footer-separator"></span>
                    <span class="files-footer-selected-items"></span>
                </div>
                <div class="files-selection-actions"></div>
            </div>
        </div>`;
    TabFiles.$el_window = $('.window');
    TabFiles.currentPath = currentPath;
    TabFiles.updateFooterStats();
};

const footer = () => $('.files-footer-item-count').text();

describe('TabFiles emptying the Trash', () => {
    beforeEach(() => {
        window.trash_path = TRASH;
        window.byte_format = bytes => `${bytes} B`;
    });

    it('shows the empty notice and a zero count once the Trash is emptied here', async () => {
        mountListing(['a.txt', 'b.txt']);
        expect(footer()).toContain('2 items');
        // What a confirmed empty_trash does to the listing.
        window.empty_trash = vi.fn(async () => {
            $('.item').remove();
        });

        await TabFiles.emptyTrash();

        expect(window.empty_trash).toHaveBeenCalledTimes(1);
        expect($('.files-empty-notice').length).toBe(1);
        expect(footer()).toContain('0 items');
    });

    it('leaves a Trash the user chose not to empty as it was', async () => {
        mountListing(['a.txt']);
        window.empty_trash = vi.fn(async () => {});

        await TabFiles.emptyTrash();

        expect($('.item').length).toBe(1);
        expect($('.files-empty-notice').length).toBe(0);
        expect(footer()).toContain('1 item');
    });

    it('touches nothing when the listing is not the Trash', () => {
        mountListing([], '/alice/Documents');
        $('.files-footer-item-count').text('stale');

        TabFiles.syncEmptiedTrash();

        expect($('.files-empty-notice').length).toBe(0);
        expect(footer()).toBe('stale');
    });
});
