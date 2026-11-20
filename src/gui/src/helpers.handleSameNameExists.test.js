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

import { describe, expect, it, vi } from 'vitest';
import jQuery from './lib/jquery-3.6.1/jquery-3.6.1.min.js';

vi.mock('./UI/UIAlert.js', () => ({ default: vi.fn() }));
vi.mock('./UI/UIItem.js', () => ({ default: vi.fn() }));
vi.mock('./UI/Auth/UIAuthLogin.js', () => ({ default: vi.fn() }));
vi.mock('./UI/UIWindowProgress.js', () => ({ default: vi.fn() }));
vi.mock('./UI/UIWindowSaveAccount.js', () => ({ default: vi.fn() }));

globalThis.$ = jQuery;
globalThis.jQuery = jQuery;
globalThis.i18n = key => key;
globalThis.def = globalThis.def ?? (value => value);
globalThis.use = globalThis.use ?? (() => class {});
globalThis.html_encode = value => jQuery('<div>').text(value).html();

await import('./helpers.js');
const { default: UIAlert } = await import('./UI/UIAlert.js');

describe('handle_same_name_exists', () => {
    it('shows why a confirmed replace failed and reports nothing was written', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        UIAlert.mockReset();
        UIAlert.mockResolvedValueOnce('replace');
        const action = vi.fn(async ({ overwrite }) => {
            throw overwrite
                ? { code: 'conflict', message: 'An entry whose name conflicts with `b.txt` already exists' }
                : { code: 'item_with_same_name_exists', entry_name: 'a.txt' };
        });

        const written = await window.handle_same_name_exists({ action, parent_uuid: 'win-1' });

        expect(written).toBe(false);
        expect(action).toHaveBeenCalledTimes(2);
        expect(UIAlert).toHaveBeenLastCalledWith({
            message: 'An entry whose name conflicts with `b.txt` already exists',
            parent_uuid: 'win-1',
        });
    });

    it('reports a confirmed replace that succeeds as written', async () => {
        UIAlert.mockReset();
        UIAlert.mockResolvedValueOnce('replace');
        const action = vi.fn(async ({ overwrite }) => {
            if ( ! overwrite ) throw { code: 'item_with_same_name_exists', entry_name: 'a.txt' };
        });

        expect(await window.handle_same_name_exists({ action, parent_uuid: 'win-1' })).toBe(true);
        expect(UIAlert).toHaveBeenCalledTimes(1);
    });
});
