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

vi.mock('./launchApp.js', () => ({ default: vi.fn() }));
vi.mock('../UI/UIAlert.js', () => ({ default: vi.fn() }));

globalThis.$ = jQuery;
globalThis.jQuery = jQuery;
globalThis.html_encode = value => jQuery('<div>').text(value).html();
globalThis.i18n = key => key;

const { default: launch_app } = await import('./launchApp.js');
const { default: UIAlert } = await import('../UI/UIAlert.js');
const { openAppInNewTab } = await import('./dashboardAppLaunch.js');

describe('openAppInNewTab', () => {
    let opened;

    beforeEach(() => {
        opened = { closed: false };
        vi.spyOn(window, 'open').mockImplementation(() => opened);
        launch_app.mockResolvedValue({ launchResult: { launched: true } });
        jQuery.fn.focusWindow = vi.fn();
        jQuery.fn.showWindow = vi.fn();
        document.body.innerHTML = '';
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.clearAllMocks();
    });

    it('opens the app in a new tab, kept connected so the app can ask it for its token', async () => {
        await openAppInNewTab('notes');
        expect(window.open).toHaveBeenCalledWith('', '_blank');
        expect(launch_app).toHaveBeenCalledWith({ name: 'notes', newTab: opened });
    });

    it('ignores a second click while the first launch is loading', async () => {
        let finish;
        launch_app.mockReturnValueOnce(new Promise((resolve) => {
            finish = resolve;
        }));
        const first = openAppInNewTab('notes');
        openAppInNewTab('notes');
        expect(window.open).toHaveBeenCalledTimes(1);

        finish();
        await first;
        await openAppInNewTab('notes');
        expect(window.open).toHaveBeenCalledTimes(2);
    });

    it('brings back an open window when the browser refuses the tab', async () => {
        window.open.mockReturnValue(null);
        document.body.innerHTML = '<div class="window" data-app="notes"></div>';
        await openAppInNewTab('notes');
        expect(jQuery.fn.focusWindow).toHaveBeenCalled();
        expect(launch_app).not.toHaveBeenCalled();
    });

    it('opens the app in this page when the browser refuses the tab', async () => {
        window.open.mockReturnValue(null);
        await openAppInNewTab('notes');
        expect(launch_app).toHaveBeenCalledWith({ name: 'notes', maximized: true });
    });

    it('tells the user when the launch fails', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        launch_app.mockRejectedValueOnce(new Error('offline'));
        await openAppInNewTab('notes');
        expect(UIAlert).toHaveBeenCalledWith('something_went_wrong');
    });
});
