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

import { afterEach, describe, expect, it } from 'vitest';
import { ipc_target_window } from './ipcTargetWindow.js';

const add_window = (element_uuid, attrs = {}) => {
    const el = document.createElement('div');
    el.className = 'window';
    el.setAttribute('data-element_uuid', element_uuid);
    for ( const [name, value] of Object.entries(attrs) ) {
        el.setAttribute(`data-${name}`, value);
    }
    document.body.appendChild(el);
    return el;
};

afterEach(() => {
    document.body.innerHTML = '';
});

describe('ipc_target_window', () => {
    it("returns the caller's own window when no window_id is given", () => {
        const own = add_window('app-1');
        expect(ipc_target_window('app-1', undefined)).toBe(own);
        expect(ipc_target_window('app-1', 'app-1')).toBe(own);
    });

    it('returns a window the caller created', () => {
        add_window('app-1');
        const created = add_window('win-1', { parent_uuid: 'app-1' });
        expect(ipc_target_window('app-1', 'win-1')).toBe(created);
    });

    it('rejects the window of an app the caller launched', () => {
        add_window('app-1');
        add_window('child-1', { parent_uuid: 'null', parent_instance_id: 'app-1' });
        expect(ipc_target_window('app-1', 'child-1')).toBeNull();
    });

    it("rejects another app's window and its created windows", () => {
        add_window('app-1');
        add_window('app-2');
        add_window('win-2', { parent_uuid: 'app-2' });
        expect(ipc_target_window('app-1', 'app-2')).toBeNull();
        expect(ipc_target_window('app-1', 'win-2')).toBeNull();
    });

    it('returns null for an unknown or selector-shaped window_id', () => {
        add_window('app-1');
        expect(ipc_target_window('app-1', 'missing')).toBeNull();
        expect(ipc_target_window('app-1', '"], .window, [x="')).toBeNull();
    });
});
