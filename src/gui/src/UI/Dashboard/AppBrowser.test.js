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
        expect($('.myapps-empty').text()).toBe('app_browser_no_matches');
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

    it('keeps dashboard launches routed through desktop actions', async () => {
        const actions = {
            launchApp: vi.fn(async () => {}),
            beginTileLaunch: vi.fn(),
            settleTileLaunch: vi.fn(),
        };
        await mount({ editable: true, onLaunch: undefined, actions });
        $('.myapps-search').val('editor').trigger('input');
        $('.myapps-tile[data-app-name="editor"]').trigger('click');
        expect(actions.launchApp).toHaveBeenCalledWith({
            name: 'editor', maximized: true,
            window_options: { morph_from_dashboard_tile: true },
        });
        await vi.waitFor(() => expect(actions.settleTileLaunch).toHaveBeenCalledOnce());
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

    it('renders an empty list and an API failure without offering authentication', async () => {
        installed = [];
        recommended = [];
        await mount();
        expect($('.myapps-empty').text()).toBe('app_browser_empty');
        fetch.mockRejectedValue(new Error('unauthorized'));
        browser._apps = null;
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});
        await browser.loadApps($root);
        expect($('.myapps-empty').text()).toBe('app_browser_load_failed');
        expect($('.window, form')).toHaveLength(0);
        log.mockRestore();
    });
});
