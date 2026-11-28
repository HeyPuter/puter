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

vi.mock('../UIWindowSaveAccount.js', () => ({ default: vi.fn() }));
vi.mock('../UIWindow.js', () => ({ default: vi.fn() }));
vi.mock('../UIContextMenu.js', () => ({ default: vi.fn() }));
vi.mock('../../helpers/dashboardAppLaunch.js', () => ({
    DESKTOP_URL: 'https://desktop.puter.com/',
    openAppInNewTab: vi.fn(),
    openRecentFileInNewTab: vi.fn(),
    openSiteInNewTab: vi.fn(),
}));

globalThis.$ = jQuery;
globalThis.jQuery = jQuery;
globalThis.html_encode = value => jQuery('<div>').text(value).html();
globalThis.i18n = key => key;
window.icons = { 'file.svg': 'file.svg', 'file-text.svg': 'file-text.svg' };
window.launch_apps = { recent: [] };

const { default: TabHome, formatTrialEnd } = await import('./TabHome.js');
const { openAppInNewTab, openRecentFileInNewTab, openSiteInNewTab } = await import('../../helpers/dashboardAppLaunch.js');
const { default: UIContextMenu } = await import('../UIContextMenu.js');
const { RECENT_FILES_KEY, resetRecentFilesCache } = await import('../../helpers/recentFiles.js');

describe('TabHome recently used', () => {
    const mount = () => {
        document.body.innerHTML = '<div class="window"><div class="bento-recent-apps-container"></div></div>';
        return $('.window');
    };

    it("doesn't call the list empty before it has loaded, and says when it couldn't", async () => {
        const $el_window = mount();
        $el_window.find('.bento-recent-apps-container').html(TabHome.html());
        expect($el_window.text()).not.toContain('no_recent_apps');

        $.ajax = vi.fn(() => Promise.reject(new Error('offline')));
        vi.spyOn(console, 'error').mockImplementation(() => {});
        await TabHome.loadRecentApps($el_window);
        expect($el_window.text()).toContain('apps_load_failed');

        $.ajax = vi.fn(async () => ({ recent: [] }));
        await TabHome.loadRecentApps($el_window);
        expect($el_window.text()).toContain('no_recent_apps');
    });
});

describe('TabHome launch apps request', () => {
    it('shares the in-flight request until it settles', async () => {
        document.body.innerHTML =
            '<div class="window"><div class="bento-recent-apps-container"></div></div>';
        let answer;
        const request = new Promise((resolve) => {
            answer = resolve;
        });
        $.ajax = vi.fn(() => request);

        const loading = TabHome.loadRecentApps($('.window'));
        expect(window.launch_apps_request).toBe(request);
        answer({ recommended: [], recent: [] });
        await loading;
        expect(window.launch_apps_request).toBeNull();
    });
});

describe('TabHome recent app clicks', () => {
    it('opens an app in a new tab at its own URL, and a website shortcut at its site', () => {
        window.launch_apps = { recent: [
            { name: 'notes', title: 'Notes', target_link: '' },
            { name: 'site', title: 'Site', target_link: 'https://site.example/' },
        ] };
        document.body.innerHTML = `<div class="window">${TabHome.html()}</div>`;
        const $el_window = $('.window');
        $.ajax = vi.fn(() => new Promise(() => {}));
        vi.spyOn(TabHome, 'loadUsageData').mockImplementation(async () => {});
        vi.spyOn(window, 'open').mockImplementation(() => null);
        TabHome.init($el_window);

        $el_window.find('.bento-recent-app[data-app-name="notes"]')[0].click();
        expect(openAppInNewTab).toHaveBeenCalledWith('notes');
        expect(window.open).not.toHaveBeenCalled();

        $el_window.find('.bento-recent-app[data-app-name="site"]')[0].click();
        expect(window.open).toHaveBeenCalledWith('https://site.example/', '_blank', 'noopener,noreferrer');
        expect(openAppInNewTab).toHaveBeenCalledTimes(1);
    });
});

describe('TabHome Open Desktop card', () => {
    const mount = () => {
        document.body.innerHTML = `<div class="window">${TabHome.html()}</div>`;
        const $el_window = $('.window');
        $.ajax = vi.fn(() => new Promise(() => {}));
        vi.spyOn(TabHome, 'loadUsageData').mockImplementation(async () => {});
        TabHome.init($el_window);
        return $el_window.find('.bento-desktop')[0];
    };
    const click = (card, init) => {
        const event = new MouseEvent('click', { bubbles: true, cancelable: true, ...init });
        card.dispatchEvent(event);
        return event;
    };

    it('links to the desktop and opens it signed in on a plain click', () => {
        openSiteInNewTab.mockReturnValue(Promise.resolve());
        const card = mount();
        expect(card.getAttribute('href')).toBe('https://desktop.puter.com/');

        expect(click(card).defaultPrevented).toBe(true);
        expect(openSiteInNewTab).toHaveBeenCalledTimes(1);
        expect(openSiteInNewTab).toHaveBeenCalledWith('https://desktop.puter.com/');
    });

    it('stays a plain link on a modified click, or when the tab was refused', () => {
        openSiteInNewTab.mockReset();
        const card = mount();
        expect(click(card, { metaKey: true }).defaultPrevented).toBe(false);
        expect(openSiteInNewTab).not.toHaveBeenCalled();

        openSiteInNewTab.mockReturnValue(null);
        expect(click(card).defaultPrevented).toBe(false);
    });
});

describe('formatTrialEnd', () => {
    const at = (day, hour) => new Date(2026, 10, day, hour).getTime();

    it('counts calendar days, so the countdown agrees with the date', () => {
        // Ends at 3pm today: today, not "1 day left".
        expect(formatTrialEnd(at(8, 15), at(8, 9)).days).toBe(0);
        // Ends tomorrow at 11am: one day, not two.
        expect(formatTrialEnd(at(9, 11), at(8, 9)).days).toBe(1);
        expect(formatTrialEnd(at(9, 11), at(8, 23)).days).toBe(1);
        expect(formatTrialEnd(at(15, 0), at(8, 23)).days).toBe(7);
    });

    it('reads an end that has passed as today', () => {
        expect(formatTrialEnd(at(7, 12), at(8, 9)).days).toBe(0);
    });

    it('has nothing to say without an end date', () => {
        expect(formatTrialEnd(undefined)).toBeNull();
        expect(formatTrialEnd(NaN)).toBeNull();
    });
});

describe('TabHome recently opened files', () => {
    const recent = (uid, name, openedAt = Date.now()) => ({
        uid,
        path: `/u/Documents/${name}`,
        name,
        appName: 'editor',
        openedAt,
    });
    let store;

    const mount = () => {
        document.body.innerHTML = `<div class="window">${TabHome.html()}</div>`;
        const $el_window = $('.window');
        TabHome.init($el_window);
        return $el_window;
    };
    const settle = () => new Promise(resolve => setTimeout(resolve, 0));

    beforeEach(() => {
        resetRecentFilesCache();
        store = new Map();
        globalThis.puter = {
            kv: {
                get: vi.fn(async key => store.get(key) ?? null),
                set: vi.fn(async (key, value) => {
                    store.set(key, value);
                    return true;
                }),
            },
        };
        $.ajax = vi.fn(async () => ({ recent: [] }));
        globalThis.fetch = vi.fn(async () => ({ ok: false, status: 500 }));
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.clearAllMocks();
        delete globalThis.puter;
    });

    it('says when there are no files, or when they could not be read', async () => {
        globalThis.puter.kv.get = vi.fn(async () => {
            throw new Error('offline');
        });
        const $el_window = mount();
        await settle();
        expect($el_window.text()).toContain('recent_files_load_failed');

        globalThis.puter.kv.get = vi.fn(async () => null);
        await TabHome.loadRecentFiles($el_window);
        await settle();
        expect($el_window.text()).toContain('no_recent_files');
        expect($el_window.find('.bento-recent-files-menu').prop('hidden')).toBe(true);
    });

    it('lists the stored files, newest first, and opens one on click', async () => {
        store.set(RECENT_FILES_KEY, [recent('a', 'notes.txt'), recent('b', 'report.pdf')]);
        const $el_window = mount();
        await settle();

        const $rows = $el_window.find('.bento-recent-file');
        expect($rows.map((_, el) => $(el).find('.bento-recent-file-name').text()).get())
            .toEqual(['notes.txt', 'report.pdf']);
        expect($el_window.find('.bento-recent-files-menu').prop('hidden')).toBe(false);

        $rows.first().trigger('click');
        expect(openRecentFileInNewTab).toHaveBeenCalledWith(recent('a', 'notes.txt', store.get(RECENT_FILES_KEY)[0].openedAt));
    });

    it('shows at most five files', async () => {
        store.set(RECENT_FILES_KEY, Array.from({ length: 8 }, (_, i) => recent(`f${i}`, `f${i}.txt`)));
        const $el_window = mount();
        await settle();
        expect($el_window.find('.bento-recent-file')).toHaveLength(5);
    });

    it('clears the history from the card menu', async () => {
        store.set(RECENT_FILES_KEY, [recent('a', 'notes.txt')]);
        const $el_window = mount();
        await settle();

        $el_window.find('.bento-recent-files-menu').trigger('click');
        const { items } = UIContextMenu.mock.calls.at(-1)[0];
        expect(items.map(item => item.html)).toEqual(['clear_history']);
        items[0].onClick();
        await settle();
        await settle();

        expect(store.get(RECENT_FILES_KEY)).toEqual([]);
        expect($el_window.text()).toContain('no_recent_files');
    });

    it('removes one file from its context menu', async () => {
        store.set(RECENT_FILES_KEY, [recent('a', 'notes.txt'), recent('b', 'report.pdf')]);
        const $el_window = mount();
        await settle();

        $el_window.find('.bento-recent-file').first().trigger('contextmenu');
        const { items } = UIContextMenu.mock.calls.at(-1)[0];
        expect(items.map(item => item.html)).toEqual(['remove_from_list']);
        items[0].onClick();
        await settle();
        await settle();

        expect(store.get(RECENT_FILES_KEY).map(f => f.uid)).toEqual(['b']);
        expect($el_window.find('.bento-recent-file')).toHaveLength(1);
    });

    it('shows the save-session banner to a temporary account only', () => {
        window.user = { is_temp: true };
        expect($(`<div>${TabHome.html()}</div>`).find('.bento-save-account-warning')).toHaveLength(1);
        window.user = { is_temp: false };
        expect($(`<div>${TabHome.html()}</div>`).find('.bento-save-account-warning')).toHaveLength(0);
        delete window.user;
    });
});
