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

// The tab's window and dialog plumbing isn't what these tests exercise.
vi.mock('../UIWindow.js', () => ({ begin_dashboard_tile_launch: vi.fn(), settle_dashboard_tile_launch: vi.fn() }));
vi.mock('../UIAlert.js', () => ({ default: vi.fn() }));
vi.mock('../UIContextMenu.js', () => ({ default: vi.fn() }));
vi.mock('../../helpers/launchApp.js', () => ({ default: vi.fn() }));

globalThis.$ = jQuery;
globalThis.jQuery = jQuery;
globalThis.html_encode = value => jQuery('<div>').text(value).html();
globalThis.i18n = globalThis.i18n ?? (key => key);
window.icons = {};

const { default: TabApps } = await import('./TabApps.js');

afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
});

describe('TabApps.beginDeepLinkLaunch', () => {
    it("doesn't wait for a tile the search has left off the grid", async () => {
        vi.useFakeTimers();
        document.body.innerHTML = `
            <div class="window">
                <input class="myapps-search" value="zzz">
                <div class="dashboard-section-apps active"><div class="myapps-container"></div></div>
            </div>`;
        window.animate_window_opening = true;
        window.puter = { kv: { get: vi.fn(async () => null) } };
        window.matchMedia = () => ({ matches: false });
        TabApps._apps = [{ name: 'app-center', title: 'App Center' }];
        TabApps._loadPromise = null;

        let settled = false;
        const intro = TabApps.beginDeepLinkLaunch('app-center', $('.window')).then((tile) => {
            settled = true;
            return tile;
        });
        await vi.advanceTimersByTimeAsync(500);

        expect(settled).toBe(true);
        expect(await intro).toBe(null);
        TabApps._launchingApps.delete('app-center');
    });
});
