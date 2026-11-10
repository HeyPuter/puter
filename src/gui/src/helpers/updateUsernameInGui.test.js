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
import jQuery from '../lib/jquery-3.6.1/jquery-3.6.1.min.js';

globalThis.$ = jQuery;
globalThis.jQuery = jQuery;

const { default: update_username_in_gui } = await import('./updateUsernameInGui.js');

beforeEach(() => {
    globalThis.puter = { _cache: { flushall: vi.fn() } };
    document.body.innerHTML = `
        <div class="item" data-path="/alice/Documents/a.txt"></div>
        <div class="item" data-path="/alice"></div>
        <div class="item" data-path="/alicex/b.txt"></div>
        <div class="window" data-item-path="/alice/Pictures"></div>
        <div class="shortcut" data-shortcut_to_path="/alice/Videos"></div>
        <span class="username">alice</span>
        <span class="username">alice</span>`;
});

describe('update_username_in_gui', () => {
    it('rewrites the paths under the old username and every username label', () => {
        window.user = { username: 'alice' };

        update_username_in_gui('bob');

        const paths = $('[data-path]').toArray().map(el => el.dataset.path);
        expect(paths).toEqual(['/bob/Documents/a.txt', '/bob', '/alicex/b.txt']);
        expect($('.window').attr('data-item-path')).toBe('/bob/Pictures');
        expect($('.shortcut').attr('data-shortcut_to_path')).toBe('/bob/Videos');
        expect($('.username').toArray().map(el => el.textContent)).toEqual(['bob', 'bob']);
        expect(window.home_path).toBe('/bob');
    });

    it('only sets the labels while signing in, with no earlier username', () => {
        window.user = undefined;

        update_username_in_gui('bob');

        expect($('.item').first().attr('data-path')).toBe('/alice/Documents/a.txt');
        expect($('.username').first().text()).toBe('bob');
    });
});
