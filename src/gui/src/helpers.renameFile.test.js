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
vi.mock('./UI/UIWindowLogin.js', () => ({ default: vi.fn() }));
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

describe('rename_file', () => {
    it('says so when the rename never reaches the server, and leaves no rejection behind', async () => {
        const failure = new XMLHttpRequest();
        // Not a vi.fn(), which handles the promises it returns.
        globalThis.puter = { fs: { rename: ({ error }) => {
            error(failure);
            return Promise.reject(failure);
        } } };
        const onDone = vi.fn();
        const unhandled = vi.fn();
        process.on('unhandledRejection', unhandled);

        await window.rename_file({ uid: 'u1', name: 'a.txt', path: '/alice/a.txt' }, 'b.txt', 'a.txt', '/alice/a.txt',
            document.createElement('div'), null, null, null, '', false, onDone);
        await new Promise(resolve => setTimeout(resolve, 0));
        process.off('unhandledRejection', unhandled);

        expect(onDone).toHaveBeenCalledWith(null);
        expect(UIAlert).toHaveBeenCalledWith('error_unknown_cause');
        expect(unhandled).not.toHaveBeenCalled();
    });
});
