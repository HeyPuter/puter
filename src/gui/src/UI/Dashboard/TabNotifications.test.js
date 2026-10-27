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

globalThis.$ = jQuery;
globalThis.jQuery = jQuery;
globalThis.html_encode = (value) => String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
window.html_encode = globalThis.html_encode;
// Echoes the key and any named values, encoded the way the real one encodes.
globalThis.i18n = (key, vars, encode = true) => {
    const named = vars && typeof vars === 'object' && !Array.isArray(vars) ? Object.values(vars) : [];
    const text = [key, ...named].join(' ');
    return encode ? html_encode(text) : text;
};
window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
window.api_origin = 'https://api.puter.test';
window.auth_token = 'tok-1';

const settle = async () => {
    for ( let i = 0; i < 10; i++ ) await new Promise(resolve => setTimeout(resolve, 0));
};

const reply = (status, data = {}) => new Response(JSON.stringify(data), { status });

/** Answers each `METHOD path` from `routes`; anything else is a 404. */
const serve = (routes) => {
    globalThis.fetch = vi.fn(async (url, init = {}) => {
        const path = new URL(url).pathname;
        const handler = routes[`${init.method ?? 'GET'} ${path}`];
        if ( ! handler ) return reply(404, { code: 'not_found' });
        return typeof handler === 'function' ? handler(init) : reply(200, handler);
    });
};

const calls = () => fetch.mock.calls.map(([url, init]) => `${init?.method ?? 'GET'} ${new URL(url).pathname}`);

const device = (fields = {}) => ({
    uid: 'dev-1',
    platform: 'web',
    label: 'Work laptop',
    user_agent: null,
    created_at: 1_700_000_000,
    last_seen_at: Math.floor(Date.now() / 1000) - 120,
    current: false,
    ...fields,
});

const fakeClient = (status = { permission: 'default', registered: false }) => ({
    enable: vi.fn(async () => ({ deviceUid: 'dev-new' })),
    disable: vi.fn(async () => {}),
    status: vi.fn(async () => status),
});

let tab;
let pushClient;

/** Renders the tab the way the dashboard does and activates it. */
const open = async () => {
    document.body.innerHTML = '<div class="win"><div class="dashboard-section dashboard-section-notifications active"></div></div>';
    $('.dashboard-section-notifications').html(tab.html());
    tab.init($('.win'));
    await tab.onActivate($('.win'));
    await settle();
};

const browserCard = () => $('.push-browser-card');
// A closed dialog stays in the DOM while it fades out.
const dialog = (selector) => $('.dashboard-dialog-overlay.dashboard-dialog-show').find(selector);
const dialogButton = (label) => dialog('.dashboard-dialog-btn').filter((_, el) => $(el).text() === label);

beforeEach(async () => {
    vi.resetModules();
    pushClient = await import('../../helpers/pushClient.js');
    tab = (await import('./TabNotifications.js')).default;
    serve({
        'GET /push/devices': { devices: [] },
        'GET /push/apps': { apps: [] },
        'GET /push/preferences': { puter: true },
    });
});

describe('notifications tab visibility', () => {
    it('is shown only when the server has push enabled', async () => {
        const { notificationsTabEnabled } = await import('./TabNotifications.js');
        expect(notificationsTabEnabled({ pushEnabled: true })).toBe(true);
        expect(notificationsTabEnabled({ pushEnabled: false })).toBe(false);
        expect(notificationsTabEnabled(undefined)).toBe(false);
    });
});

describe('this browser', () => {
    it('says push is not available when no client is registered', async () => {
        await open();
        expect(browserCard().hasClass('push-browser-unavailable')).toBe(true);
        expect(browserCard().text()).toContain('push_browser_unavailable');
        expect(browserCard().find('button')).toHaveLength(0);
    });

    it('offers Turn on when this browser is not registered', async () => {
        pushClient.registerPushClient(fakeClient());
        await open();
        expect(browserCard().hasClass('push-browser-off')).toBe(true);
        expect(browserCard().find('.push-turn-on')).toHaveLength(1);
    });

    it('offers Turn off when this browser is registered', async () => {
        pushClient.registerPushClient(fakeClient({ permission: 'granted', registered: true, deviceUid: 'dev-1' }));
        await open();
        expect(browserCard().hasClass('push-browser-on')).toBe(true);
        expect(browserCard().find('.push-turn-off')).toHaveLength(1);
    });

    it('says notifications are blocked when the browser denied them', async () => {
        pushClient.registerPushClient(fakeClient({ permission: 'denied', registered: false }));
        await open();
        expect(browserCard().hasClass('push-browser-blocked')).toBe(true);
        expect(browserCard().find('button')).toHaveLength(0);
    });

    it('redraws when a client registers after the tab opened', async () => {
        await open();
        pushClient.registerPushClient(fakeClient());
        await settle();
        expect(browserCard().hasClass('push-browser-off')).toBe(true);
    });

    it('turns on, sends a test push to that device, then asks whether it showed up', async () => {
        const client = fakeClient();
        pushClient.registerPushClient(client);
        const test = vi.fn(() => reply(200, { sent: true }));
        serve({
            'GET /push/devices': { devices: [] },
            'GET /push/apps': { apps: [] },
            'GET /push/preferences': { puter: true },
            'POST /push/devices/dev-new/test': test,
        });
        await open();
        client.status.mockResolvedValue({ permission: 'granted', registered: true, deviceUid: 'dev-new' });

        $('.push-turn-on').trigger('click');
        await settle();

        expect(client.enable).toHaveBeenCalledTimes(1);
        expect(test).toHaveBeenCalledTimes(1);
        expect(client.enable.mock.invocationCallOrder[0]).toBeLessThan(fetch.mock.invocationCallOrder[calls().indexOf('POST /push/devices/dev-new/test')]);
        expect(dialog('.dashboard-dialog-title').text()).toBe('push_test_confirm_title');
        expect(browserCard().hasClass('push-browser-on')).toBe(true);

        dialogButton('no').trigger('click');
        await settle();
        expect(dialog('.dashboard-dialog-title').text()).toBe('push_test_help_title');
        expect(dialog('.dashboard-dialog-message').text()).toContain('push_test_help');
    });

    it('shows no help when the user saw the test notification', async () => {
        pushClient.registerPushClient(fakeClient());
        serve({
            'GET /push/devices': { devices: [] },
            'GET /push/apps': { apps: [] },
            'GET /push/preferences': { puter: true },
            'POST /push/devices/dev-new/test': { sent: true },
        });
        await open();

        $('.push-turn-on').trigger('click');
        await settle();
        dialogButton('yes').trigger('click');
        await settle();

        expect(dialog('.dashboard-dialog-title')).toHaveLength(0);
    });

    it('reports a test push that could not be sent', async () => {
        pushClient.registerPushClient(fakeClient());
        serve({
            'GET /push/devices': { devices: [] },
            'GET /push/apps': { apps: [] },
            'GET /push/preferences': { puter: true },
            'POST /push/devices/dev-new/test': () => reply(502, { code: 'push_test_failed' }),
        });
        await open();

        $('.push-turn-on').trigger('click');
        await settle();

        expect(dialog('.dashboard-dialog-message').text()).toBe('push_test_failed');
    });

    it('sends no test push when the browser refuses permission', async () => {
        const client = fakeClient();
        client.enable.mockRejectedValue(new Error('denied'));
        pushClient.registerPushClient(client);
        await open();
        client.status.mockResolvedValue({ permission: 'denied', registered: false });

        $('.push-turn-on').trigger('click');
        await settle();

        expect(calls().some(c => c.endsWith('/test'))).toBe(false);
        expect(browserCard().hasClass('push-browser-blocked')).toBe(true);
        expect($('.dashboard-dialog-overlay')).toHaveLength(0);
    });

    it('keeps the newest state when an older status read finishes last', async () => {
        const client = fakeClient();
        pushClient.registerPushClient(client);
        await open();
        let finishSlow;
        client.status
            .mockImplementationOnce(() => new Promise(resolve => {
                finishSlow = resolve;
            }))
            .mockResolvedValueOnce({ permission: 'granted', registered: true, deviceUid: 'dev-1' });

        tab.onActivate($('.win'));
        tab.onActivate($('.win'));
        await settle();
        expect(browserCard().hasClass('push-browser-on')).toBe(true);
        finishSlow({ permission: 'default', registered: false });
        await settle();

        expect(browserCard().hasClass('push-browser-on')).toBe(true);
    });

    it('turns on once however often the button is pressed while enabling', async () => {
        const client = fakeClient();
        pushClient.registerPushClient(client);
        let finishEnable;
        client.enable.mockImplementation(() => new Promise(resolve => {
            finishEnable = resolve;
        }));
        serve({
            'GET /push/devices': { devices: [] },
            'GET /push/apps': { apps: [] },
            'GET /push/preferences': { puter: true },
            'POST /push/devices/dev-new/test': () => reply(200, { sent: true }),
        });
        await open();

        $('.push-turn-on').trigger('click');
        await settle();
        expect($('.push-turn-on').prop('disabled')).toBe(true);
        // A redraw while enabling keeps the button out.
        await tab.onActivate($('.win'));
        await settle();
        expect($('.push-turn-on').prop('disabled')).toBe(true);
        $('.push-turn-on').trigger('click');
        $('.push-turn-on').prop('disabled', false).trigger('click');
        await settle();
        expect(client.enable).toHaveBeenCalledTimes(1);

        client.status.mockResolvedValue({ permission: 'granted', registered: true, deviceUid: 'dev-new' });
        finishEnable({ deviceUid: 'dev-new' });
        await settle();
        expect(browserCard().hasClass('push-browser-on')).toBe(true);
        expect($('.push-turn-off').prop('disabled')).toBe(false);
    });

    it('lets no status read begun before Turn on draw the card while enabling', async () => {
        const client = fakeClient();
        pushClient.registerPushClient(client);
        await open();
        let finishSlow;
        client.status.mockImplementationOnce(() => new Promise(resolve => {
            finishSlow = resolve;
        }));
        let finishEnable;
        client.enable.mockImplementation(() => new Promise(resolve => {
            finishEnable = resolve;
        }));
        tab.onActivate($('.win'));
        await settle();

        $('.push-turn-on').trigger('click');
        await settle();
        finishSlow({ permission: 'default', registered: false });
        await settle();
        expect($('.push-turn-on').prop('disabled')).toBe(true);

        client.status.mockResolvedValue({ permission: 'granted', registered: true, deviceUid: 'dev-new' });
        finishEnable({ deviceUid: 'dev-new' });
        await settle();
        expect(browserCard().hasClass('push-browser-on')).toBe(true);
    });

    it('turns off once however often the button is pressed while disabling', async () => {
        const client = fakeClient({ permission: 'granted', registered: true, deviceUid: 'dev-1' });
        pushClient.registerPushClient(client);
        let finishDisable;
        client.disable.mockImplementation(() => new Promise(resolve => {
            finishDisable = resolve;
        }));
        await open();

        $('.push-turn-off').trigger('click');
        await settle();
        await tab.onActivate($('.win'));
        await settle();
        expect($('.push-turn-off').prop('disabled')).toBe(true);
        $('.push-turn-off').prop('disabled', false).trigger('click');
        await settle();
        expect(client.disable).toHaveBeenCalledTimes(1);

        client.status.mockResolvedValue({ permission: 'granted', registered: false });
        finishDisable();
        await settle();
        expect(browserCard().hasClass('push-browser-off')).toBe(true);
        expect($('.push-turn-on').prop('disabled')).toBe(false);
    });

    it('turns off through the client', async () => {
        const client = fakeClient({ permission: 'granted', registered: true, deviceUid: 'dev-1' });
        pushClient.registerPushClient(client);
        await open();
        client.status.mockResolvedValue({ permission: 'granted', registered: false });

        $('.push-turn-off').trigger('click');
        await settle();

        expect(client.disable).toHaveBeenCalledTimes(1);
        expect(browserCard().hasClass('push-browser-off')).toBe(true);
    });
});

describe('Puter notifications', () => {
    it('shows the saved preference and saves a change', async () => {
        const save = vi.fn(() => reply(200, { puter: true }));
        serve({
            'GET /push/devices': { devices: [] },
            'GET /push/apps': { apps: [] },
            'GET /push/preferences': { puter: false },
            'POST /push/preferences': save,
        });
        await open();
        const $toggle = $('.push-puter-toggle');
        expect($toggle.prop('checked')).toBe(false);
        expect($toggle.prop('disabled')).toBe(false);

        $toggle.prop('checked', true).trigger('change');
        await settle();

        expect(JSON.parse(save.mock.calls[0][0].body)).toEqual({ puter: true });
    });

    it('shows the switch off and disabled with a message when the preference can’t be read', async () => {
        serve({
            'GET /push/devices': { devices: [] },
            'GET /push/apps': { apps: [] },
            'GET /push/preferences': () => reply(500, {}),
        });
        await open();

        const $toggle = $('.push-puter-toggle');
        expect($toggle.prop('checked')).toBe(false);
        expect($toggle.prop('disabled')).toBe(true);
        expect($('.push-puter-card').text()).toContain('push_load_failed');
    });

    it('puts the switch back when the save fails', async () => {
        serve({
            'GET /push/devices': { devices: [] },
            'GET /push/apps': { apps: [] },
            'GET /push/preferences': { puter: true },
            'POST /push/preferences': () => reply(500, {}),
        });
        await open();

        $('.push-puter-toggle').prop('checked', false).trigger('change');
        await settle();

        expect($('.push-puter-toggle').prop('checked')).toBe(true);
    });
});

describe('without a push service', () => {
    it('says push is unavailable on this server instead of failing', async () => {
        serve({});
        await open();

        expect($('.push-devices-list').text()).toBe('push_server_unavailable');
        expect($('.push-apps-list').text()).toBe('push_server_unavailable');
        expect($('.push-puter-toggle').prop('disabled')).toBe(true);
        expect($('.push-puter-card').text()).toContain('push_server_unavailable');
    });
});

describe('your devices', () => {
    it('says so when there are none', async () => {
        await open();
        expect($('.push-devices-list').text()).toBe('push_devices_empty');
    });

    it('lists each device with its name, platform, last seen time and this-browser badge', async () => {
        serve({
            'GET /push/devices': {
                devices: [
                    device({ uid: 'a', current: true }),
                    device({ uid: 'b', label: null, platform: 'android', user_agent: 'Mozilla/5.0 (Linux; Android 14) Chrome/120.0 Mobile' }),
                    device({ uid: 'c', label: null, platform: 'ios' }),
                ],
            },
            'GET /push/apps': { apps: [] },
            'GET /push/preferences': { puter: true },
        });
        await open();

        const $cards = $('.push-device-card');
        expect($cards).toHaveLength(3);
        expect($cards.eq(0).find('strong').text()).toContain('Work laptop');
        expect($cards.eq(0).find('.dashboard-settings-badge').text()).toBe('push_this_browser');
        expect($cards.eq(0).find('.dashboard-settings-card-info > span').text()).toContain('push_platform_web');
        expect($cards.eq(0).find('.dashboard-settings-card-info > span').text()).toContain('push_device_last_seen');
        expect($cards.eq(1).find('strong').text()).toBe('Chrome on Android');
        expect($cards.eq(1).find('.dashboard-settings-badge')).toHaveLength(0);
        expect($cards.eq(2).find('strong').text()).toBe('push_device_unknown');
    });

    it('removes a device once the user confirms', async () => {
        const remove = vi.fn(() => reply(200, { removed: true }));
        serve({
            'GET /push/devices': { devices: [device({ uid: 'a' }), device({ uid: 'b', label: 'Phone' })] },
            'GET /push/apps': { apps: [] },
            'GET /push/preferences': { puter: true },
            'DELETE /push/devices/b': remove,
        });
        await open();

        $('.push-remove-device[data-uid="b"]').trigger('click');
        await settle();
        expect(dialog('.dashboard-dialog-message').text()).toContain('Phone');
        dialogButton('push_device_remove').trigger('click');
        await settle();

        expect(remove).toHaveBeenCalledTimes(1);
        expect($('.push-device-card')).toHaveLength(1);
        expect($('.push-remove-device').attr('data-uid')).toBe('a');
    });

    it('removes this browser through the client, which also forgets its registration', async () => {
        const client = fakeClient({ permission: 'granted', registered: true, deviceUid: 'a' });
        pushClient.registerPushClient(client);
        const remove = vi.fn(() => reply(404, { code: 'device_not_found', message: 'Device not found' }));
        let listed = [device({ uid: 'a', current: true }), device({ uid: 'b', label: 'Phone' })];
        serve({
            'GET /push/devices': () => reply(200, { devices: listed }),
            'GET /push/apps': { apps: [] },
            'GET /push/preferences': { puter: true },
            'DELETE /push/devices/a': remove,
        });
        await open();
        client.disable.mockImplementation(async () => {
            listed = listed.filter(d => d.uid !== 'a');
            client.status.mockResolvedValue({ permission: 'granted', registered: false });
        });

        $('.push-remove-device[data-uid="a"]').trigger('click');
        await settle();
        dialogButton('push_device_remove').trigger('click');
        await settle();

        expect(client.disable).toHaveBeenCalledTimes(1);
        expect(remove).toHaveBeenCalledTimes(1);
        expect(browserCard().hasClass('push-browser-off')).toBe(true);
        expect($('.push-device-card')).toHaveLength(1);
        expect($('.push-remove-device').attr('data-uid')).toBe('b');
    });

    it('still removes this browser on the server when it has no local record', async () => {
        const client = fakeClient({ permission: 'granted', registered: false });
        pushClient.registerPushClient(client);
        let listed = [device({ uid: 'a', current: true })];
        const remove = vi.fn(() => {
            listed = [];
            return reply(200, { removed: true });
        });
        serve({
            'GET /push/devices': () => reply(200, { devices: listed }),
            'GET /push/apps': { apps: [] },
            'GET /push/preferences': { puter: true },
            'DELETE /push/devices/a': remove,
        });
        await open();

        $('.push-remove-device[data-uid="a"]').trigger('click');
        await settle();
        dialogButton('push_device_remove').trigger('click');
        await settle();

        expect(client.disable).toHaveBeenCalledTimes(1);
        expect(remove).toHaveBeenCalledTimes(1);
        expect($('.push-device-card')).toHaveLength(0);
    });

    it('removes another device with the server alone', async () => {
        const client = fakeClient({ permission: 'granted', registered: true, deviceUid: 'a' });
        pushClient.registerPushClient(client);
        const remove = vi.fn(() => reply(200, { removed: true }));
        serve({
            'GET /push/devices': { devices: [device({ uid: 'a', current: true }), device({ uid: 'b', label: 'Phone' })] },
            'GET /push/apps': { apps: [] },
            'GET /push/preferences': { puter: true },
            'DELETE /push/devices/b': remove,
        });
        await open();

        $('.push-remove-device[data-uid="b"]').trigger('click');
        await settle();
        dialogButton('push_device_remove').trigger('click');
        await settle();

        expect(remove).toHaveBeenCalledTimes(1);
        expect(client.disable).not.toHaveBeenCalled();
        expect(browserCard().hasClass('push-browser-on')).toBe(true);
        expect($('.push-remove-device').attr('data-uid')).toBe('a');
    });

    it('keeps this browser and says so when the client cannot reach a push service', async () => {
        const client = fakeClient({ permission: 'granted', registered: true, deviceUid: 'a' });
        client.disable.mockRejectedValue(Object.assign(new Error('unavailable'), { code: 'push_unavailable' }));
        pushClient.registerPushClient(client);
        serve({
            'GET /push/devices': { devices: [device({ uid: 'a', current: true })] },
            'GET /push/apps': { apps: [] },
            'GET /push/preferences': { puter: true },
        });
        await open();

        $('.push-remove-device[data-uid="a"]').trigger('click');
        await settle();
        dialogButton('push_device_remove').trigger('click');
        await settle();

        expect($('.push-device-card')).toHaveLength(1);
        expect(dialog('.dashboard-dialog-message').text()).toContain('push_device_remove_failed');
    });

    it('drops a device the server no longer has', async () => {
        serve({
            'GET /push/devices': { devices: [device({ uid: 'a' })] },
            'GET /push/apps': { apps: [] },
            'GET /push/preferences': { puter: true },
            'DELETE /push/devices/a': () => reply(404, { code: 'device_not_found' }),
        });
        await open();

        $('.push-remove-device[data-uid="a"]').trigger('click');
        await settle();
        dialogButton('push_device_remove').trigger('click');
        await settle();

        expect($('.push-device-card')).toHaveLength(0);
    });

    it('keeps the device and says so when no push service answers', async () => {
        serve({
            'GET /push/devices': { devices: [device({ uid: 'a' })] },
            'GET /push/apps': { apps: [] },
            'GET /push/preferences': { puter: true },
        });
        await open();

        $('.push-remove-device[data-uid="a"]').trigger('click');
        await settle();
        dialogButton('push_device_remove').trigger('click');
        await settle();

        expect($('.push-device-card')).toHaveLength(1);
        expect(dialog('.dashboard-dialog-message').text()).toContain('push_device_remove_failed');
    });

    it('keeps the device when the user cancels', async () => {
        serve({
            'GET /push/devices': { devices: [device()] },
            'GET /push/apps': { apps: [] },
            'GET /push/preferences': { puter: true },
        });
        await open();

        $('.push-remove-device').trigger('click');
        await settle();
        dialogButton('cancel').trigger('click');
        await settle();

        expect(calls().some(c => c.startsWith('DELETE'))).toBe(false);
        expect($('.push-device-card')).toHaveLength(1);
    });

    it('shows a device label containing markup as text', async () => {
        serve({
            'GET /push/devices': { devices: [device({ label: '<img src=x onerror=alert(1)>' })] },
            'GET /push/apps': { apps: [] },
            'GET /push/preferences': { puter: true },
        });
        await open();

        expect($('.push-device-card img')).toHaveLength(0);
        expect($('.push-device-card strong').text()).toContain('<img src=x onerror=alert(1)>');

        $('.push-remove-device').trigger('click');
        await settle();
        expect(dialog('.dashboard-dialog-message img')).toHaveLength(0);
        expect(dialog('.dashboard-dialog-message').text()).toContain('<img src=x onerror=alert(1)>');
    });
});

describe('apps that can send pushes', () => {
    it('says so when there are none', async () => {
        await open();
        expect($('.push-apps-list').text()).toBe('push_apps_empty');
    });

    it('turns an app off by revoking its push permission', async () => {
        const revoke = vi.fn(() => reply(200, {}));
        serve({
            'GET /push/devices': { devices: [] },
            'GET /push/apps': { apps: [{ uid: 'app-1', name: 'chat', title: 'Chat', icon: 'https://api.puter.test/app-icon/app-1/64' }] },
            'GET /push/preferences': { puter: true },
            'POST /auth/revoke-user-app': revoke,
        });
        await open();
        expect($('.push-app-card strong').text()).toBe('Chat');
        expect($('.push-app-card img').attr('src')).toBe('https://api.puter.test/app-icon/app-1/64');

        $('.push-revoke-app').trigger('click');
        await settle();

        expect(JSON.parse(revoke.mock.calls[0][0].body)).toEqual({ app_uid: 'app-1', permission: 'notifications:push' });
        expect($('.push-app-card')).toHaveLength(0);
        expect($('.push-apps-list').text()).toBe('push_apps_empty');
    });

    it('shows the default icon for an app icon that is not https', async () => {
        window.icons = { 'app.svg': '/images/app.svg' };
        serve({
            'GET /push/devices': { devices: [] },
            'GET /push/apps': { apps: [{ uid: 'app-1', name: 'chat', title: 'Chat', icon: 'http://elsewhere.test/icon.png' }] },
            'GET /push/preferences': { puter: true },
        });
        await open();

        expect($('.push-app-card img').attr('src')).toBe('/images/app.svg');
        delete window.icons;
    });

    it('shows an app name and icon containing markup as text', async () => {
        serve({
            'GET /push/devices': { devices: [] },
            'GET /push/apps': { apps: [{ uid: 'app-1', name: 'x', title: '<b onclick=alert(1)>Chat</b>', icon: '" onerror="alert(1)' }] },
            'GET /push/preferences': { puter: true },
        });
        await open();

        expect($('.push-app-card b')).toHaveLength(0);
        expect($('.push-app-card strong').text()).toBe('<b onclick=alert(1)>Chat</b>');
        expect($('.push-app-card img').attr('onerror')).toBeUndefined();
        expect($('.push-app-card img').attr('src')).toBe('" onerror="alert(1)');
    });
});
