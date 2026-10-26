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

import {
    getPuterPushPreference,
    listPushApps,
    listPushDevices,
    removePushDevice,
    revokePushApp,
    sendTestPush,
    setPuterPushPreference,
} from '../../helpers/notificationApi.js';
import { getPushClient, PUSH_CLIENT_REGISTERED_EVENT } from '../../helpers/pushClient.js';
import { formatBrowserOs, parseUserAgent } from '../../helpers/userAgent.js';
import { formatAbsoluteTime, formatRelativeTime } from './notificationCenter.js';
import UIDashboardDialog from './UIDashboardDialog.js';

const SECTION = '.dashboard-section-notifications';

const svg = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const ICONS = {
    bell: svg('<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>'),
    laptop: svg('<rect x="3" y="4" width="18" height="12" rx="2"/><line x1="2" y1="20" x2="22" y2="20"/>'),
    phone: svg('<rect x="6" y="2" width="12" height="20" rx="2.5"/><line x1="10" y1="18.5" x2="14" y2="18.5"/>'),
    puter: svg('<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 12h8M12 8v8"/>'),
};

const PLATFORM_KEYS = { web: 'push_platform_web', ios: 'push_platform_ios', android: 'push_platform_android' };

/** @param {{ pushEnabled?: boolean }|undefined} params - `window.gui_params` */
export const notificationsTabEnabled = (params) => params?.pushEnabled === true;

/** @typedef {'checking'|'unavailable'|'blocked'|'on'|'off'} BrowserPushState */

/** @param {import('../../helpers/pushClient.js').PushClient|null} client @returns {Promise<BrowserPushState>} */
export const browserPushState = async (client) => {
    if ( ! client ) return 'unavailable';
    try {
        const status = await client.status();
        if ( status?.permission === 'denied' ) return 'blocked';
        return status?.registered ? 'on' : 'off';
    } catch ( e ) {
        console.warn('[push] client status failed', e);
        return 'unavailable';
    }
};

const card = ({ icon, title, badge, detail, detailTitle, action, extraClass = '' }) => {
    let h = `<div class="dashboard-card dashboard-settings-card ${extraClass}">`;
    h += '<div class="dashboard-settings-card-content">';
    h += `<div class="dashboard-settings-card-icon">${icon}</div>`;
    h += '<div class="dashboard-settings-card-info">';
    h += `<strong>${title}${badge ? ` <span class="dashboard-settings-badge">${badge}</span>` : ''}</strong>`;
    if ( detail ) h += `<span${detailTitle ? ` title="${detailTitle}"` : ''}>${detail}</span>`;
    h += '</div></div>';
    h += action ?? '';
    h += '</div>';
    return h;
};

const BROWSER_DETAIL_KEYS = {
    checking: 'push_browser_checking',
    unavailable: 'push_browser_unavailable',
    blocked: 'push_browser_blocked',
    on: 'push_browser_on',
    off: 'push_browser_off',
};

/** @param {BrowserPushState} state */
export const browserCardHtml = (state) => {
    let action = '';
    if ( state === 'on' ) action = `<button type="button" class="button push-turn-off">${i18n('push_turn_off')}</button>`;
    if ( state === 'off' ) action = `<button type="button" class="button push-turn-on">${i18n('push_turn_on')}</button>`;
    return card({
        icon: ICONS.bell,
        title: i18n('push_this_browser'),
        detail: i18n(BROWSER_DETAIL_KEYS[state] ?? BROWSER_DETAIL_KEYS.unavailable),
        action,
        extraClass: `push-browser-card push-browser-${state}`,
    });
};

/** @param {import('../../helpers/notificationApi.js').PushDevice} device */
const deviceName = (device) => device.label
    || formatBrowserOs(parseUserAgent(device.user_agent))
    || i18n('push_device_unknown', [], false);

/** @param {import('../../helpers/notificationApi.js').PushDevice} device @param {number} now - Epoch ms */
export const deviceCardHtml = (device, now) => {
    const seenAt = Number(device.last_seen_at) * 1000;
    const locale = window.locale ?? 'en';
    const platform = PLATFORM_KEYS[device.platform] ? i18n(PLATFORM_KEYS[device.platform]) : '';
    const seen = Number.isFinite(seenAt) && seenAt > 0
        ? i18n('push_device_last_seen', { time: formatRelativeTime(seenAt, now, locale) })
        : '';
    return card({
        icon: device.platform === 'web' ? ICONS.laptop : ICONS.phone,
        title: html_encode(deviceName(device)),
        badge: device.current ? i18n('push_this_browser') : '',
        detail: [platform, seen].filter(Boolean).join(' · '),
        detailTitle: seen ? html_encode(formatAbsoluteTime(seenAt, locale)) : '',
        action: `<button type="button" class="button push-remove-device" data-uid="${html_encode(device.uid)}">${i18n('push_device_remove')}</button>`,
        extraClass: 'push-device-card',
    });
};

/** @param {import('../../helpers/notificationApi.js').PushApp} app */
export const appCardHtml = (app) => {
    const fallback = window.icons?.['app.svg'] ?? '';
    const src = typeof app.icon === 'string' && app.icon ? app.icon : fallback;
    return card({
        icon: `<img src="${html_encode(src)}" alt="">`,
        title: html_encode(app.title || app.name || ''),
        action: `<button type="button" class="button push-revoke-app" data-app-uid="${html_encode(app.uid)}">${i18n('push_turn_off')}</button>`,
        extraClass: 'push-app-card',
    });
};

const emptyHtml = (key) => `<p class="dashboard-settings-empty">${i18n(key)}</p>`;

const showError = (key, $el_window) => UIDashboardDialog({
    message: i18n(key),
    tone: 'error',
    $container: $el_window,
});

const TabNotifications = {
    id: 'notifications',
    get label () {
        return i18n('notifications');
    },
    icon: ICONS.bell.replace('stroke-width="2"', 'stroke-width="1.5"'),

    html () {
        let h = '<div class="dashboard-tab-content">';
        h += '<div class="dashboard-section-header">';
        h += `<h2>${i18n('notifications')}</h2>`;
        h += `<p>${i18n('push_settings_subtitle')}</p>`;
        h += '</div>';

        h += '<div class="dashboard-settings-grid push-browser-slot">';
        h += browserCardHtml('checking');
        h += card({
            icon: ICONS.puter,
            title: i18n('push_puter_notifications'),
            detail: i18n('push_puter_notifications_hint'),
            action: '<label class="dashboard-switch">'
                + `<input type="checkbox" class="push-puter-toggle" checked disabled aria-label="${html_encode(i18n('push_puter_notifications', [], false))}">`
                + '<span class="dashboard-switch-slider"></span></label>',
        });
        h += '</div>';

        h += `<h3 class="dashboard-settings-group-title">${i18n('push_devices')}</h3>`;
        h += '<div class="dashboard-settings-grid push-devices-list"></div>';

        h += `<h3 class="dashboard-settings-group-title">${i18n('push_apps')}</h3>`;
        h += '<div class="dashboard-settings-grid push-apps-list"></div>';

        h += '</div>';
        return h;
    },

    init ($el_window) {
        const $section = $el_window.find(SECTION);
        let devices = [];
        let apps = [];

        const renderBrowser = (state) => {
            $section.find('.push-browser-card').replaceWith(browserCardHtml(state));
        };
        const refreshBrowser = async () => {
            renderBrowser(await browserPushState(getPushClient()));
        };

        const renderDevices = () => {
            const now = Date.now();
            $section.find('.push-devices-list').html(devices.length
                ? devices.map(device => deviceCardHtml(device, now)).join('')
                : emptyHtml('push_devices_empty'));
        };
        const refreshDevices = async () => {
            try {
                devices = await listPushDevices();
                renderDevices();
            } catch ( e ) {
                console.warn('[push] device list failed', e);
                $section.find('.push-devices-list').html(emptyHtml('push_load_failed'));
            }
        };

        const renderApps = () => {
            $section.find('.push-apps-list').html(apps.length
                ? apps.map(appCardHtml).join('')
                : emptyHtml('push_apps_empty'));
        };
        const refreshApps = async () => {
            try {
                apps = await listPushApps();
                renderApps();
            } catch ( e ) {
                console.warn('[push] app list failed', e);
                $section.find('.push-apps-list').html(emptyHtml('push_load_failed'));
            }
        };

        const refreshPreference = async () => {
            const $toggle = $section.find('.push-puter-toggle');
            try {
                $toggle.prop('checked', await getPuterPushPreference()).prop('disabled', false);
            } catch ( e ) {
                console.warn('[push] preference read failed', e);
            }
        };

        this.refresh = () => Promise.all([refreshBrowser(), refreshDevices(), refreshApps(), refreshPreference()]);

        window.addEventListener(PUSH_CLIENT_REGISTERED_EVENT, () => {
            if ( $section[0]?.isConnected && $section.hasClass('active') ) refreshBrowser();
        });

        const askIfSeen = async () => {
            const seen = await UIDashboardDialog({
                title: i18n('push_test_confirm_title', [], false),
                message: i18n('push_test_confirm_message'),
                buttons: [
                    { label: i18n('no', [], false), value: 'no', type: 'quiet' },
                    { label: i18n('yes', [], false), value: 'yes', type: 'primary' },
                ],
                $container: $el_window,
            });
            if ( seen !== 'no' ) return;
            await UIDashboardDialog({
                title: i18n('push_test_help_title', [], false),
                message: i18n('push_test_help'),
                $container: $el_window,
            });
        };

        $section.on('click', '.push-turn-on', async function () {
            const client = getPushClient();
            if ( ! client ) return;
            $(this).prop('disabled', true);
            let deviceUid;
            try {
                ({ deviceUid } = await client.enable());
            } catch ( e ) {
                console.warn('[push] enable failed', e);
                const state = await browserPushState(client);
                renderBrowser(state);
                if ( state !== 'blocked' ) showError('push_enable_failed', $el_window);
                return;
            }
            await Promise.all([refreshBrowser(), refreshDevices()]);
            try {
                await sendTestPush(deviceUid);
            } catch ( e ) {
                console.warn('[push] test push failed', e);
                showError('push_test_failed', $el_window);
                await Promise.all([refreshBrowser(), refreshDevices()]);
                return;
            }
            await askIfSeen();
        });

        $section.on('click', '.push-turn-off', async function () {
            const client = getPushClient();
            if ( ! client ) return;
            $(this).prop('disabled', true);
            try {
                await client.disable();
            } catch ( e ) {
                console.warn('[push] disable failed', e);
                showError('push_disable_failed', $el_window);
            }
            await Promise.all([refreshBrowser(), refreshDevices()]);
        });

        $section.on('change', '.push-puter-toggle', async function () {
            const $toggle = $(this);
            const enabled = $toggle.is(':checked');
            $toggle.prop('disabled', true);
            try {
                await setPuterPushPreference(enabled);
            } catch ( e ) {
                console.warn('[push] preference save failed', e);
                $toggle.prop('checked', ! enabled);
                showError('push_save_failed', $el_window);
            } finally {
                $toggle.prop('disabled', false);
            }
        });

        $section.on('click', '.push-remove-device', async function () {
            const uid = $(this).attr('data-uid');
            const device = devices.find(d => d.uid === uid);
            if ( ! device ) return;
            const confirmed = await UIDashboardDialog({
                title: i18n('push_device_remove_title', [], false),
                message: i18n('push_device_remove_message', { name: deviceName(device) }),
                tone: 'danger',
                buttons: [
                    { label: i18n('cancel', [], false), value: false, type: 'quiet' },
                    { label: i18n('push_device_remove', [], false), value: true, type: 'danger' },
                ],
                $container: $el_window,
                returnFocusTo: this,
            });
            if ( confirmed !== true ) return;
            try {
                await removePushDevice(uid);
            } catch ( e ) {
                if ( e?.status !== 404 ) {
                    console.warn('[push] device removal failed', e);
                    showError('push_device_remove_failed', $el_window);
                    return;
                }
            }
            devices = devices.filter(d => d.uid !== uid);
            renderDevices();
            if ( device.current ) refreshBrowser();
        });

        $section.on('click', '.push-revoke-app', async function () {
            const appUid = $(this).attr('data-app-uid');
            $(this).prop('disabled', true);
            try {
                await revokePushApp(appUid);
            } catch ( e ) {
                console.warn('[push] app revoke failed', e);
                $(this).prop('disabled', false);
                showError('push_app_turn_off_failed', $el_window);
                return;
            }
            apps = apps.filter(app => app.uid !== appUid);
            renderApps();
        });
    },

    onActivate () {
        return this.refresh?.();
    },
};

export default TabNotifications;
