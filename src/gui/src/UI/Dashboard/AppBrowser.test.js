// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import jQuery from '../../lib/jquery-3.6.1/jquery-3.6.1.min.js';
import { encode } from 'html-entities';
import { createAppBrowser } from './AppBrowser.js';
import { APPS_ORDER_KV_KEY } from './appOrder.js';
import { APP_GROUPS_KV_KEY } from './appGroups.js';
import { REMOVED_APPS_KV_KEY } from './removedApps.js';

let installed;
let recommended;
let saved;
let browser;
let $root;
const onLaunch = vi.fn();

beforeEach(() => {
    globalThis.$ = globalThis.jQuery = jQuery;
    globalThis.html_encode = value => encode(String(value ?? ''));
    globalThis.i18n = key => key;
    window.icons = {};
    window.api_origin = 'https://api.test.local';
    window.auth_token = 'test-session';
    window.matchMedia = () => ({ matches: false });
    globalThis.ResizeObserver = class { observe () {} disconnect () {} };
    HTMLElement.prototype.scrollTo = function ({ left }) { this.scrollLeft = left; };
    installed = [
        { name: 'sheet', title: 'Spreadsheet' },
        { name: 'notes', title: 'Notes' },
        { name: 'editor', title: 'Editor' },
    ];
    recommended = [{ name: 'camera', title: 'Camera' }];
    saved = new Map([
        [APPS_ORDER_KV_KEY, JSON.stringify(['notes', 'sheet', 'camera', 'editor'])],
        [APP_GROUPS_KV_KEY, JSON.stringify([{ id: 'work', name: 'Work', apps: ['notes', 'sheet'] }])],
        [REMOVED_APPS_KV_KEY, JSON.stringify(['camera'])],
    ]);
    vi.stubGlobal('fetch', vi.fn(async url => ({
        json: async () => String(url).includes('/installedApps') ? installed : { recommended },
    })));
    vi.stubGlobal('puter', {
        authToken: 'test-session',
        kv: { get: async key => saved.get(key), set: vi.fn() },
    });
    onLaunch.mockClear();
});

afterEach(() => {
    browser?._resizeObserver?.disconnect();
    $(document).off('keydown.myapps-keyboard');
    $(document).off('keydown.myapps-group');
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

async function mount (options = {}) {
    browser = createAppBrowser({ editable: false, onLaunch, ...options });
    document.body.innerHTML = `<main><section class="dashboard-section-apps active">${browser.html()}</section></main>`;
    $root = $('main');
    const container = document.querySelector('.myapps-container');
    Object.defineProperties(container, {
        clientWidth: { value: 600 },
        clientHeight: { value: 400 },
    });
    browser.init($root);
    await browser.loadApps($root);
}

describe('shared app browser', () => {
    it('keeps an app off the grid while its uninstall is still on its way to the server', async () => {
        const actions = { showAlert: vi.fn(), revokeAppSessions: vi.fn(async () => {}) };
        await mount({ editable: true, actions });
        let finishRevoke;
        puter.perms = { revokeApp: vi.fn(() => new Promise(resolve => { finishRevoke = resolve; })) };
        // The app's windows are closed first; the test has none.
        $.fn.close ??= function () { return this; };
        window.matchMedia = () => ({ matches: true });
        browser._setReorderMode($root, true);
        $('.myapps-tile[data-app-name="editor"] .myapps-tile-remove').trigger('click');
        $('.myapps-modal-confirm').trigger('click');
        expect(puter.perms.revokeApp).toHaveBeenCalled();

        // A refresh before the revoke lands still lists the app as installed.
        await browser.loadApps($root);
        expect(browser._apps.map(app => app.name)).not.toContain('editor');

        installed = installed.filter(app => app.name !== 'editor');
        finishRevoke({});
        await vi.waitFor(() => expect(browser._pendingUninstalls.size).toBe(0));
        await browser.loadApps($root);
        expect(browser._apps.map(app => app.name)).not.toContain('editor');
        expect(actions.showAlert).not.toHaveBeenCalled();
    });

    it('saves one layout at a time, sending only the newest once the last write lands', async () => {
        await mount({ editable: true });
        const writes = [];
        puter.kv.set = vi.fn((key, value) => new Promise(resolve => writes.push({ key, value, resolve })));
        const orderWrites = () => writes.filter(w => w.key === APPS_ORDER_KV_KEY);

        browser._apps = [{ name: 'a' }, { name: 'b' }];
        browser.saveOrder();
        browser._apps = [{ name: 'b' }, { name: 'a' }];
        browser.saveOrder();
        browser._apps = [{ name: 'a' }, { name: 'b' }, { name: 'c' }];
        browser.saveOrder();
        expect(orderWrites()).toHaveLength(1);

        orderWrites()[0].resolve();
        await vi.waitFor(() => expect(orderWrites()).toHaveLength(2));
        expect(orderWrites()[1].value).toBe(JSON.stringify(browser._savedOrderNames));
        expect(orderWrites()[1].value).not.toBe(orderWrites()[0].value);
        orderWrites()[1].resolve();
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(orderWrites()).toHaveLength(2);
    });

    it('leaves the app request form open on an Escape that ends an IME composition', async () => {
        await mount({ editable: true });
        $('.myapps-add-tile').trigger('click');
        $('.myapps-add-option[data-add-option="request"]').trigger('click');
        const pane = () => $('.myapps-add-pane:not([hidden])').attr('data-pane');
        expect(pane()).toBe('request');

        $('.myapps-add-message')[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true }));
        expect(pane()).toBe('request');
        $('.myapps-add-message')[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(pane()).toBe('options');
        $(document).off('keydown.add-app-modal');
    });

    it('lets Tab reach the delete-data option in the Uninstall dialog', async () => {
        // jsdom lays nothing out; the focus trap skips elements with no offsetParent.
        vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockReturnValue(document.body);
        await mount({ editable: true });
        browser._setReorderMode($root, true);
        $('.myapps-tile[data-app-name="editor"] .myapps-tile-remove').trigger('click');
        const $overlay = $('.myapps-modal-overlay');
        expect(document.activeElement.classList.contains('myapps-modal-cancel')).toBe(true);

        // Tab from the last control wraps to the first, the checkbox.
        $overlay.find('.myapps-modal-confirm')[0].focus();
        $overlay.trigger($.Event('keydown', { key: 'Tab', shiftKey: false }));
        expect(document.activeElement.classList.contains('myapps-modal-delete-data')).toBe(true);
        // Shift+Tab from it wraps back to the last.
        $overlay.trigger($.Event('keydown', { key: 'Tab', shiftKey: true }));
        expect(document.activeElement.classList.contains('myapps-modal-confirm')).toBe(true);
    });

    it('uses saved order, folders, and removed recommendations in read-only mode', async () => {
        await mount();
        expect(browser._apps.map(app => app.name)).toEqual(['notes', 'sheet', 'editor']);
        expect($('.myapps-group-tile')).toHaveLength(1);
        expect($('.myapps-reorder-btn, .myapps-add-tile')).toHaveLength(0);
        expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer test-session');
    });

    it('searches inside folders and delegates launches without desktop actions', async () => {
        await mount();
        $('.myapps-search').val('spread').trigger('input');
        expect($('.myapps-tile')).toHaveLength(1);
        $('.myapps-tile').trigger('click');
        expect(onLaunch).toHaveBeenCalledWith({ appName: 'sheet', targetLink: '' });
        expect($('.window')).toHaveLength(0);
        $('.myapps-search').val('missing').trigger('input');
        expect($('.myapps-empty').text()).toBe('no_apps_match');
        expect(browser._page).toBe(0);
        expect($('.myapps-add-tile')).toHaveLength(0);
    });

    it('opens folders but cannot rename, reorder, remove, or persist changes', async () => {
        await mount();
        $('.myapps-group-tile').trigger('click');
        expect($('.myapps-group-name').prop('readOnly')).toBe(true);
        expect($('.myapps-group-panel .myapps-tile')).toHaveLength(2);
        $('.myapps-group-name').val('Changed').trigger('blur');
        browser._setReorderMode($root, true);
        $('.myapps-tile').first().trigger($.Event('pointerdown', { button: 0, pointerType: 'mouse' }));
        $('.myapps-tile').first().trigger('contextmenu');
        browser.saveOrder();
        browser.saveGroups();
        expect(browser._reorderMode).toBe(false);
        expect(browser._drag).toBeNull();
        expect(browser._groups[0].name).toBe('Work');
        expect(puter.kv.set).not.toHaveBeenCalled();
        $('.myapps-group-panel .myapps-tile').first().trigger('click');
        expect(onLaunch).toHaveBeenCalled();
    });

    it('retains the dashboard editing controls and isolates component state', async () => {
        await mount({ editable: true });
        expect($('.myapps-reorder-btn, .myapps-add-tile')).toHaveLength(2);
        browser._setReorderMode($root, true);
        expect(browser._reorderMode).toBe(true);
        const other = createAppBrowser({ editable: false });
        expect(other._apps).toBeNull();
        expect(other._groups).toEqual([]);
        expect(other._launchingApps).not.toBe(browser._launchingApps);
    });

    it('opens dashboard launches in a new tab through desktop actions', async () => {
        const tab = { close: vi.fn() };
        vi.spyOn(window, 'open').mockReturnValue(tab);
        const actions = {
            launchApp: vi.fn(async () => ({ launchResult: { launched: true } })),
        };
        await mount({ editable: true, onLaunch: undefined, actions });
        $('.myapps-search').val('editor').trigger('input');
        $('.myapps-tile[data-app-name="editor"]').trigger('click');
        expect(window.open).toHaveBeenCalledWith('', '_blank');
        expect(actions.launchApp).toHaveBeenCalledWith({ name: 'editor', newTab: tab });
        await vi.waitFor(() => expect(browser._launchingApps.size).toBe(0));
        expect($('.window')).toHaveLength(0);
    });

    it('launches in-page when the browser refuses the tab', async () => {
        vi.spyOn(window, 'open').mockReturnValue(null);
        const actions = {
            launchApp: vi.fn(async () => ({ launchResult: { launched: true } })),
            beginTileLaunch: vi.fn(),
            settleTileLaunch: vi.fn(),
        };
        await mount({ editable: true, onLaunch: undefined, actions });
        $('.myapps-search').val('editor').trigger('input');
        const tile = $('.myapps-tile[data-app-name="editor"]').get(0);
        $(tile).trigger('click');
        expect(actions.launchApp).toHaveBeenCalledWith({
            name: 'editor', maximized: true,
            window_options: { morph_from_dashboard_tile: true },
        });
        expect(actions.beginTileLaunch).toHaveBeenCalledWith(tile);
        await vi.waitFor(() => expect(actions.settleTileLaunch).toHaveBeenCalledWith(tile));
        expect(browser._launchingApps.size).toBe(0);
    });

    it('launches the app store from the dashboard add-app dialog', async () => {
        const actions = {
            launchApp: vi.fn(async () => {}),
            settleTileLaunch: vi.fn(),
        };
        puter.apps = { get: async name => ({ name, title: name }) };
        await mount({ editable: true, onLaunch: undefined, actions });
        $('.myapps-add-tile').trigger('click');
        $('.myapps-add-option[data-add-option="browse"]').trigger('click');
        await vi.waitFor(() => expect(actions.launchApp).toHaveBeenCalledWith(
            expect.objectContaining({ name: 'app-center', maximized: true }),
        ));
        expect($('.myapps-add-modal')).toHaveLength(0);
    });

    it('shows only the guest apps, without reading the user\'s apps or layout', async () => {
        const kvGet = vi.spyOn(puter.kv, 'get');
        await mount({ guestApps: [
            { name: 'camera', title: 'Camera', uuid: 'app-camera', index_url: 'https://camera.test/' },
            { name: 'notes', title: 'Notes' },
        ] });
        expect(browser._apps.map(app => app.name)).toEqual(['camera', 'notes']);
        expect(browser._apps[0]).toMatchObject({ uid: 'app-camera', index_url: 'https://camera.test/' });
        expect($('.myapps-group-tile')).toHaveLength(0);
        expect(fetch).not.toHaveBeenCalled();
        expect(kvGet).not.toHaveBeenCalled();
        $('.myapps-tile[data-app-name="notes"]').trigger('click');
        expect(onLaunch).toHaveBeenCalledWith({ appName: 'notes', targetLink: '' });
    });

    it('renders an empty list and an API failure without offering authentication', async () => {
        installed = [];
        recommended = [];
        await mount();
        expect($('.myapps-empty').text()).toBe('no_apps_installed');
        fetch.mockRejectedValue(new Error('unauthorized'));
        browser._apps = null;
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});
        await browser.loadApps($root);
        expect($('.myapps-empty').text()).toBe('apps_load_failed');
        expect($('.window, form')).toHaveLength(0);
        log.mockRestore();
    });
});
